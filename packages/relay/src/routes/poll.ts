import { Hono } from 'hono';
import type { Env, PollResult } from '../types';
import { DatabaseStorage } from '../storage/db';

const poll = new Hono<{ Bindings: Env }>();

const getMoltbotId = (c: { req: { header: (name: string) => string | undefined } }): string | null => {
  return c.req.header('X-Moltbot-Id') || null;
};

const getStorage = (c: { env: Env }): DatabaseStorage => {
  return new DatabaseStorage(c.env.MOLTDM_DB);
};

/**
 * GET /poll - Poll for all updates
 *
 * Query params:
 * - since: ISO timestamp to get updates since
 *
 * Returns:
 * - New messages per conversation
 * - Membership events per conversation
 * - Unread counts
 * - Pending message requests
 */
poll.get('/', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const since = c.req.query('since');
  const storage = getStorage(c);

  // Get all conversations
  const conversations = await storage.listConversations(moltbotId);

  // Gather updates for each conversation
  const conversationUpdates = await Promise.all(
    conversations.map(async (conv) => {
      const [messages, events, unreadCount] = await Promise.all([
        storage.listMessages(conv.id, { since, limit: 100 }),
        storage.listEvents(conv.id, since),
        storage.getUnreadCount(moltbotId, conv.id),
      ]);

      // Filter out expired messages
      const now = new Date().toISOString();
      const validMessages = messages.filter((m) => !m.expiresAt || m.expiresAt > now);

      return {
        id: conv.id,
        messages: validMessages,
        events,
        unreadCount,
      };
    })
  );

  // Filter to only conversations with updates
  const conversationsWithUpdates = conversationUpdates.filter(
    (c) => c.messages.length > 0 || c.events.length > 0
  );

  // Get pending requests
  const requests = await storage.listPendingRequests(moltbotId);

  const result: PollResult = {
    conversations: conversationsWithUpdates,
    requests,
    lastPollTime: new Date().toISOString(),
  };

  return c.json(result);
});

/**
 * POST /poll/mark-read - Mark conversations as read
 */
poll.post('/mark-read', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const body = await c.req.json<{ conversationIds: string[] }>();
  const storage = getStorage(c);

  if (!body.conversationIds || !Array.isArray(body.conversationIds)) {
    return c.json({ error: 'conversationIds array required' }, 400);
  }

  await Promise.all(
    body.conversationIds.map((convId) => storage.markAsRead(moltbotId, convId))
  );

  return c.json({ success: true });
});

export default poll;
