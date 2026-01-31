import { Hono } from 'hono';
import type { Env } from '../types';
import { DatabaseStorage } from '../storage/db';

const reactions = new Hono<{ Bindings: Env }>();

const getMoltbotId = (c: { req: { header: (name: string) => string | undefined } }): string | null => {
  return c.req.header('X-Moltbot-Id') || null;
};

const getStorage = (c: { env: Env }): DatabaseStorage => {
  return new DatabaseStorage(c.env.MOLTDM_DB);
};

/**
 * POST /conversations/:convId/messages/:msgId/reactions - Add a reaction
 */
reactions.post('/conversations/:convId/messages/:msgId/reactions', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('convId');
  const msgId = c.req.param('msgId');
  const body = await c.req.json<{ emoji: string }>();
  const storage = getStorage(c);

  if (!body.emoji || typeof body.emoji !== 'string') {
    return c.json({ error: 'emoji required' }, 400);
  }

  // Validate emoji (basic check - single grapheme cluster)
  if (body.emoji.length > 10) {
    return c.json({ error: 'Invalid emoji' }, 400);
  }

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  if (!conversation.members.includes(moltbotId)) {
    return c.json({ error: 'Not a member of this conversation' }, 403);
  }

  const message = await storage.getMessage(convId, msgId);
  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  const reaction = await storage.createReaction(convId, msgId, moltbotId, body.emoji);

  return c.json({ reaction }, 201);
});

/**
 * DELETE /conversations/:convId/messages/:msgId/reactions/:emoji - Remove a reaction
 */
reactions.delete('/conversations/:convId/messages/:msgId/reactions/:emoji', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('convId');
  const msgId = c.req.param('msgId');
  const emoji = decodeURIComponent(c.req.param('emoji'));
  const storage = getStorage(c);

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  if (!conversation.members.includes(moltbotId)) {
    return c.json({ error: 'Not a member of this conversation' }, 403);
  }

  await storage.deleteReaction(convId, msgId, emoji, moltbotId);

  return c.json({ success: true });
});

/**
 * GET /conversations/:convId/messages/:msgId/reactions - Get reactions for a message
 */
reactions.get('/conversations/:convId/messages/:msgId/reactions', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const convId = c.req.param('convId');
  const msgId = c.req.param('msgId');
  const storage = getStorage(c);

  const conversation = await storage.getConversation(convId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  if (!conversation.members.includes(moltbotId)) {
    return c.json({ error: 'Not a member of this conversation' }, 403);
  }

  const reactions = await storage.getMessageReactions(msgId);

  return c.json({ reactions });
});

export default reactions;
