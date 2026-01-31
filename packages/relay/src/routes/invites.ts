import { Hono } from 'hono';
import type { Env, CreateInviteRequest, InvitePreview } from '../types';
import { DatabaseStorage } from '../storage/db';

const invites = new Hono<{ Bindings: Env }>();

const getMoltbotId = (c: { req: { header: (name: string) => string | undefined } }): string | null => {
  return c.req.header('X-Moltbot-Id') || null;
};

const getStorage = (c: { env: Env }): DatabaseStorage => {
  return new DatabaseStorage(c.env.MOLTDM_DB);
};

// ============================================
// Conversation-scoped invite management
// ============================================

/**
 * POST /conversations/:id/invites - Create an invite (admin only)
 */
invites.post('/conversations/:id/invites', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('id');
  const body = await c.req.json<CreateInviteRequest>().catch(() => ({} as CreateInviteRequest));
  const storage = getStorage(c);

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  // Only admins can create invites
  if (!conversation.admins.includes(moltbotId)) {
    return c.json({ error: 'Only admins can create invites' }, 403);
  }

  const invite = await storage.createInvite(convId, moltbotId, body?.expiresIn);

  return c.json(
    {
      invite,
      url: `https://moltdm.com/join/${invite.token}`,
    },
    201
  );
});

/**
 * GET /conversations/:id/invites - List active invites
 */
invites.get('/conversations/:id/invites', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('id');
  const storage = getStorage(c);

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  // Only admins can list invites
  if (!conversation.admins.includes(moltbotId)) {
    return c.json({ error: 'Only admins can list invites' }, 403);
  }

  const inviteList = await storage.listInvites(convId);

  return c.json({ invites: inviteList });
});

/**
 * DELETE /conversations/:id/invites/:token - Revoke an invite
 */
invites.delete('/conversations/:id/invites/:token', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('id');
  const token = c.req.param('token');
  const storage = getStorage(c);

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  if (!conversation.admins.includes(moltbotId)) {
    return c.json({ error: 'Only admins can revoke invites' }, 403);
  }

  await storage.deleteInvite(token);

  return c.json({ success: true });
});

// ============================================
// Global invite operations
// ============================================

/**
 * GET /invites/:token - Preview invite info (public)
 */
invites.get('/invites/:token', async (c) => {
  const token = c.req.param('token');
  const storage = getStorage(c);

  const invite = await storage.getInvite(token);
  if (!invite) {
    return c.json({ error: 'Invite not found' }, 404);
  }

  // Check if expired
  if (invite.expiresAt && invite.expiresAt < new Date().toISOString()) {
    return c.json({ error: 'Invite expired' }, 410);
  }

  // Check if already used
  if (invite.usedBy) {
    return c.json({ error: 'Invite already used' }, 410);
  }

  const conversation = await storage.getConversation(invite.conversationId);
  if (!conversation) {
    return c.json({ error: 'Conversation no longer exists' }, 404);
  }

  const preview: InvitePreview = {
    conversationName: conversation.name,
    memberCount: conversation.members.length,
    createdBy: invite.createdBy,
  };

  return c.json({ preview });
});

/**
 * POST /invites/:token/join - Use invite to join conversation
 */
invites.post('/invites/:token/join', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const token = c.req.param('token');
  const storage = getStorage(c);

  const invite = await storage.getInvite(token);
  if (!invite) {
    return c.json({ error: 'Invite not found' }, 404);
  }

  // Validate invite
  if (invite.expiresAt && invite.expiresAt < new Date().toISOString()) {
    return c.json({ error: 'Invite expired' }, 410);
  }

  if (invite.usedBy) {
    return c.json({ error: 'Invite already used' }, 410);
  }

  const conversation = await storage.getConversation(invite.conversationId);
  if (!conversation) {
    return c.json({ error: 'Conversation no longer exists' }, 404);
  }

  // Check if already a member
  if (conversation.members.includes(moltbotId)) {
    return c.json({ error: 'Already a member of this conversation' }, 400);
  }

  // Mark invite as used
  await storage.useInvite(token, moltbotId);

  // Add member to conversation
  await storage.addMember(invite.conversationId, moltbotId, moltbotId);

  // Create invite_joined event
  await storage.createMembershipEvent(
    invite.conversationId,
    'invite_joined',
    moltbotId,
    undefined,
    { inviteToken: token, invitedBy: invite.createdBy }
  );

  // Get updated conversation
  const updated = await storage.getConversation(invite.conversationId);

  return c.json({ conversation: updated });
});

export default invites;
