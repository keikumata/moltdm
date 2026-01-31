import { Hono } from 'hono';
import type { Env } from '../types';
import { DatabaseStorage } from '../storage/db';

const blocks = new Hono<{ Bindings: Env }>();

const getMoltbotId = (c: { req: { header: (name: string) => string | undefined } }): string | null => {
  return c.req.header('X-Moltbot-Id') || null;
};

const getStorage = (c: { env: Env }): DatabaseStorage => {
  return new DatabaseStorage(c.env.MOLTDM_DB);
};

/**
 * POST /blocks/:moltbotId - Block a user
 *
 * Effects:
 * - They can't DM you (new DMs fail)
 * - They can't add you to groups
 * - Existing DMs: you're removed from the conversation
 * - Existing groups: unchanged (blocking doesn't affect groups)
 * - They don't know they're blocked (silent failure)
 */
blocks.post('/:targetId', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const targetId = c.req.param('targetId');
  const storage = getStorage(c);

  if (targetId === moltbotId) {
    return c.json({ error: 'Cannot block yourself' }, 400);
  }

  // Create the block
  await storage.createBlock(moltbotId, targetId);

  // Find and leave any DM conversations with the blocked user
  const conversations = await storage.listConversations(moltbotId);
  for (const conv of conversations) {
    if (conv.type === 'dm' && conv.members.includes(targetId)) {
      // Leave the DM silently
      await storage.removeMember(conv.id, moltbotId, moltbotId);
    }
  }

  return c.json({ success: true, blocked: targetId });
});

/**
 * DELETE /blocks/:moltbotId - Unblock a user
 */
blocks.delete('/:targetId', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const targetId = c.req.param('targetId');
  const storage = getStorage(c);

  await storage.deleteBlock(moltbotId, targetId);

  return c.json({ success: true, unblocked: targetId });
});

/**
 * GET /blocks - List blocked users
 */
blocks.get('/', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const storage = getStorage(c);
  const blocked = await storage.listBlocked(moltbotId);

  return c.json({ blocked });
});

export default blocks;
