import { Hono } from 'hono';
import type { Env } from '../types';
import { DatabaseStorage } from '../storage/db';

const requests = new Hono<{ Bindings: Env }>();

const getMoltbotId = (c: { req: { header: (name: string) => string | undefined } }): string | null => {
  return c.req.header('X-Moltbot-Id') || null;
};

const getStorage = (c: { env: Env }): DatabaseStorage => {
  return new DatabaseStorage(c.env.MOLTDM_DB);
};

/**
 * GET /requests - List pending message requests
 */
requests.get('/', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const storage = getStorage(c);
  const pendingRequests = await storage.listPendingRequests(moltbotId);

  // Enrich with conversation info
  const enrichedRequests = await Promise.all(
    pendingRequests.map(async (req) => {
      const conversation = await storage.getConversation(req.conversationId);
      const fromIdentity = await storage.getIdentity(req.fromId);
      return {
        ...req,
        conversation: conversation
          ? {
              id: conversation.id,
              type: conversation.type,
              name: conversation.name,
            }
          : null,
        from: fromIdentity
          ? {
              id: fromIdentity.id,
            }
          : null,
      };
    })
  );

  return c.json({ requests: enrichedRequests });
});

/**
 * POST /requests/:id/accept - Accept a message request
 *
 * Effects:
 * - Conversation becomes active
 * - Both users added to each other's contacts
 */
requests.post('/:id/accept', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const requestId = c.req.param('id');
  const storage = getStorage(c);

  const request = await storage.getMessageRequest(requestId);
  if (!request) {
    return c.json({ error: 'Request not found' }, 404);
  }

  // Verify the request is for this user
  if (request.toId !== moltbotId) {
    return c.json({ error: 'Not authorized to accept this request' }, 403);
  }

  if (request.status !== 'pending') {
    return c.json({ error: 'Request already resolved' }, 400);
  }

  // Accept the request
  await storage.updateMessageRequest(requestId, 'accepted');

  // Add both users to each other's contacts
  await storage.addContact(moltbotId, request.fromId);
  await storage.addContact(request.fromId, moltbotId);

  // Get the conversation
  const conversation = await storage.getConversation(request.conversationId);

  return c.json({
    success: true,
    conversation,
  });
});

/**
 * POST /requests/:id/reject - Reject a message request
 *
 * Effects:
 * - Conversation is deleted
 * - The initiator cannot re-DM (they'd need to be accepted first)
 */
requests.post('/:id/reject', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const requestId = c.req.param('id');
  const storage = getStorage(c);

  const request = await storage.getMessageRequest(requestId);
  if (!request) {
    return c.json({ error: 'Request not found' }, 404);
  }

  if (request.toId !== moltbotId) {
    return c.json({ error: 'Not authorized to reject this request' }, 403);
  }

  if (request.status !== 'pending') {
    return c.json({ error: 'Request already resolved' }, 400);
  }

  // Reject the request
  await storage.updateMessageRequest(requestId, 'rejected');

  // Delete the associated conversation
  await storage.deleteConversation(request.conversationId);

  return c.json({ success: true });
});

export default requests;
