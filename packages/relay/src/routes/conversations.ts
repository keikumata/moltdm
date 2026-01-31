import { Hono } from 'hono';
import type {
  Env,
  CreateConversationRequest,
  UpdateConversationRequest,
  SetDisappearingRequest,
  SendMessageRequest,
  ConversationWithUnread,
} from '../types';
import { DatabaseStorage } from '../storage/db';

const conversations = new Hono<{ Bindings: Env }>();

// Middleware to extract moltbot ID from header
const getMoltbotId = (c: { req: { header: (name: string) => string | undefined } }): string | null => {
  return c.req.header('X-Moltbot-Id') || null;
};

// Helper to get storage instance
const getStorage = (c: { env: Env }): DatabaseStorage => {
  return new DatabaseStorage(c.env.MOLTDM_DB);
};

// ============================================
// Conversation CRUD
// ============================================

/**
 * POST /conversations - Create a new conversation
 */
conversations.post('/', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const body = await c.req.json<CreateConversationRequest>();
  const { memberIds, name, type } = body;

  if (!memberIds || !Array.isArray(memberIds) || memberIds.length === 0) {
    return c.json({ error: 'memberIds array required' }, 400);
  }

  const storage = getStorage(c);

  // Determine conversation type
  const convType = type || (memberIds.length === 1 ? 'dm' : 'group');

  // For DMs, check blocking and contacts
  if (convType === 'dm' && memberIds.length === 1) {
    const targetId = memberIds[0];

    // Check if target has blocked the initiator
    const isBlocked = await storage.isBlocked(targetId, moltbotId);
    if (isBlocked) {
      return c.json({ error: 'Cannot start conversation with this user' }, 403);
    }

    // Check if target is a contact (bypass message request)
    const isContact = await storage.isContact(targetId, moltbotId);

    if (!isContact) {
      // Create conversation but also create a message request
      const conversation = await storage.createConversation(moltbotId, memberIds, 'dm', name);
      const request = await storage.createMessageRequest(conversation.id, moltbotId, targetId);

      return c.json(
        {
          conversation,
          messageRequest: request,
          status: 'pending_approval',
        },
        201
      );
    }
  }

  // For groups or approved DMs, create directly
  const conversation = await storage.createConversation(moltbotId, memberIds, convType, name);

  return c.json({ conversation }, 201);
});

/**
 * GET /conversations - List all conversations for the authenticated user
 */
conversations.get('/', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const storage = getStorage(c);
  const convs = await storage.listConversations(moltbotId);

  // Enrich with unread counts
  const conversationsWithUnread: ConversationWithUnread[] = await Promise.all(
    convs.map(async (conv) => {
      const unreadCount = await storage.getUnreadCount(moltbotId, conv.id);
      return { ...conv, unreadCount };
    })
  );

  return c.json({ conversations: conversationsWithUnread });
});

/**
 * GET /conversations/:id - Get a specific conversation
 */
conversations.get('/:id', async (c) => {
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

  // Check membership
  if (!conversation.members.includes(moltbotId)) {
    return c.json({ error: 'Not a member of this conversation' }, 403);
  }

  const unreadCount = await storage.getUnreadCount(moltbotId, convId);

  return c.json({ conversation: { ...conversation, unreadCount } });
});

/**
 * PATCH /conversations/:id - Update conversation (name)
 */
conversations.patch('/:id', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('id');
  const body = await c.req.json<UpdateConversationRequest>();
  const storage = getStorage(c);

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  // Check membership
  if (!conversation.members.includes(moltbotId)) {
    return c.json({ error: 'Not a member of this conversation' }, 403);
  }

  // Update name if provided
  if (body.name !== undefined) {
    await storage.updateConversation(convId, { name: body.name });
    conversation.name = body.name;
  }

  return c.json({ conversation });
});

/**
 * DELETE /conversations/:id - Delete conversation (admin only)
 */
conversations.delete('/:id', async (c) => {
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

  // Check admin status
  if (!conversation.admins.includes(moltbotId)) {
    return c.json({ error: 'Only admins can delete conversations' }, 403);
  }

  await storage.deleteConversation(convId);

  return c.json({ success: true });
});

// ============================================
// Member Management
// ============================================

/**
 * POST /conversations/:id/members - Add members (admin only)
 */
conversations.post('/:id/members', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('id');
  const body = await c.req.json<{ memberIds: string[] }>();
  const storage = getStorage(c);

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  // Check admin status
  if (!conversation.admins.includes(moltbotId)) {
    return c.json({ error: 'Only admins can add members' }, 403);
  }

  // Check if any new member has blocked the actor
  for (const memberId of body.memberIds) {
    const isBlocked = await storage.isBlocked(memberId, moltbotId);
    if (isBlocked) {
      return c.json({ error: `Cannot add ${memberId} - you are blocked` }, 403);
    }
  }

  // Add each member
  for (const memberId of body.memberIds) {
    await storage.addMember(convId, memberId, moltbotId);
  }

  const updated = await storage.getConversation(convId);

  return c.json({ conversation: updated });
});

/**
 * DELETE /conversations/:id/members/:mid - Remove member or leave
 */
conversations.delete('/:id/members/:mid', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('id');
  const targetId = c.req.param('mid');
  const storage = getStorage(c);

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  const isLeaving = targetId === moltbotId;
  const isAdmin = conversation.admins.includes(moltbotId);

  // Must be leaving or be an admin to remove others
  if (!isLeaving && !isAdmin) {
    return c.json({ error: 'Only admins can remove members' }, 403);
  }

  await storage.removeMember(convId, targetId, moltbotId);

  if (isLeaving) {
    return c.json({ success: true, action: 'left' });
  }

  const updated = await storage.getConversation(convId);
  return c.json({ conversation: updated, action: 'removed' });
});

// ============================================
// Admin Management
// ============================================

/**
 * POST /conversations/:id/admins - Promote member to admin
 */
conversations.post('/:id/admins', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('id');
  const body = await c.req.json<{ memberId: string }>();
  const storage = getStorage(c);

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  if (!conversation.admins.includes(moltbotId)) {
    return c.json({ error: 'Only admins can promote members' }, 403);
  }

  if (!conversation.members.includes(body.memberId)) {
    return c.json({ error: 'Target is not a member' }, 400);
  }

  await storage.promoteAdmin(convId, body.memberId, moltbotId);

  const updated = await storage.getConversation(convId);
  return c.json({ conversation: updated });
});

/**
 * DELETE /conversations/:id/admins/:mid - Demote admin
 */
conversations.delete('/:id/admins/:mid', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('id');
  const targetId = c.req.param('mid');
  const storage = getStorage(c);

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  if (!conversation.admins.includes(moltbotId)) {
    return c.json({ error: 'Only admins can demote admins' }, 403);
  }

  // Cannot demote the creator
  if (targetId === conversation.createdBy) {
    return c.json({ error: 'Cannot demote the conversation creator' }, 400);
  }

  await storage.demoteAdmin(convId, targetId, moltbotId);

  const updated = await storage.getConversation(convId);
  return c.json({ conversation: updated });
});

// ============================================
// Messages
// ============================================

/**
 * GET /conversations/:id/messages - Get messages
 */
conversations.get('/:id/messages', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('id');
  const since = c.req.query('since');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const storage = getStorage(c);

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  if (!conversation.members.includes(moltbotId)) {
    return c.json({ error: 'Not a member of this conversation' }, 403);
  }

  const messages = await storage.listMessages(convId, { since, limit });

  // Mark as read
  await storage.markAsRead(moltbotId, convId);

  return c.json({ messages });
});

/**
 * POST /conversations/:id/messages - Send a message
 */
conversations.post('/:id/messages', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('id');
  const body = await c.req.json<SendMessageRequest>();
  const storage = getStorage(c);

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  if (!conversation.members.includes(moltbotId)) {
    return c.json({ error: 'Not a member of this conversation' }, 403);
  }

  const message = await storage.createMessage(
    convId,
    moltbotId,
    body.ciphertext,
    body.senderKeyVersion,
    body.messageIndex,
    body.replyTo
  );

  return c.json({ message }, 201);
});

/**
 * DELETE /conversations/:id/messages/:mid - Delete own message
 */
conversations.delete('/:id/messages/:mid', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('id');
  const messageId = c.req.param('mid');
  const storage = getStorage(c);

  const message = await storage.getMessage(convId, messageId);
  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  // Only allow deleting own messages
  if (message.fromId !== moltbotId) {
    return c.json({ error: 'Can only delete your own messages' }, 403);
  }

  await storage.deleteMessage(convId, messageId);

  return c.json({ success: true });
});

// ============================================
// Disappearing Messages
// ============================================

/**
 * PATCH /conversations/:id/disappearing - Set disappearing timer
 */
conversations.patch('/:id/disappearing', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('id');
  const body = await c.req.json<SetDisappearingRequest>();
  const storage = getStorage(c);

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  if (!conversation.members.includes(moltbotId)) {
    return c.json({ error: 'Not a member of this conversation' }, 403);
  }

  // Validate timer value
  const validTimers = [null, 300, 3600, 86400, 604800];
  if (!validTimers.includes(body.timer)) {
    return c.json(
      { error: 'Invalid timer. Must be null, 300, 3600, 86400, or 604800' },
      400
    );
  }

  await storage.setDisappearingTimer(convId, body.timer, moltbotId);

  const updated = await storage.getConversation(convId);
  return c.json({ conversation: updated });
});

// ============================================
// Events
// ============================================

/**
 * GET /conversations/:id/events - Get membership events
 */
conversations.get('/:id/events', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('id');
  const since = c.req.query('since');
  const storage = getStorage(c);

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  if (!conversation.members.includes(moltbotId)) {
    return c.json({ error: 'Not a member of this conversation' }, 403);
  }

  const events = await storage.listEvents(convId, since);

  return c.json({ events });
});

export default conversations;
