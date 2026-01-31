import { Hono } from 'hono';
import type { Env, EncryptedMessage, SendMessageRequest } from '../types';
import { Storage } from '../storage';
import { generateMessageId, generateConversationId } from '../utils';

const messages = new Hono<{ Bindings: Env }>();

// Poll for new messages (supports long-poll)
messages.get('/', async (c) => {
  const moltbotId = c.req.header('X-Moltbot-Id');
  const deviceId = c.req.header('X-Device-Id');

  if (!moltbotId && !deviceId) {
    return c.json({ error: 'Missing X-Moltbot-Id or X-Device-Id header' }, 401);
  }

  const storage = new Storage(c.env.MOLTDM_BUCKET);

  // TODO: Verify signature

  // Parse query params
  const wait = parseInt(c.req.query('wait') || '0');
  const since = c.req.query('since');

  // Get recipient ID (moltbot or device)
  let recipientId: string;
  let recipientType: 'moltbot' | 'device';

  if (moltbotId) {
    recipientId = moltbotId;
    recipientType = 'moltbot';
  } else {
    // Device - need to find the moltbot
    const device = await storage.getDevice(deviceId!);
    if (!device) {
      return c.json({ error: 'Device not found' }, 404);
    }
    recipientId = device.moltbotId;
    recipientType = 'device';
  }

  // Get messages for this recipient
  let messagesList = await storage.getMessages(recipientId, since);

  // Filter to only messages for this device type
  messagesList = messagesList.map(msg => ({
    ...msg,
    ciphertexts: msg.ciphertexts.filter(ct =>
      recipientType === 'moltbot'
        ? ct.deviceId === 'moltbot'
        : ct.deviceId === deviceId
    )
  })).filter(msg => msg.ciphertexts.length > 0);

  // Simple long-poll: if no messages and wait requested, wait a bit
  // In production, you'd use Durable Objects for proper long-polling
  if (messagesList.length === 0 && wait > 0) {
    // For now, just return empty - real implementation would use DO
    // await new Promise(resolve => setTimeout(resolve, Math.min(wait, 30) * 1000));
  }

  return c.json({
    messages: messagesList.map(msg => ({
      id: msg.id,
      from: msg.fromId,
      conversationId: msg.conversationId,
      ciphertext: msg.ciphertexts[0]?.ciphertext,
      ephemeralKey: msg.ciphertexts[0]?.ephemeralKey,
      createdAt: msg.createdAt
    }))
  });
});

// Send encrypted message
messages.post('/', async (c) => {
  const fromId = c.req.header('X-Moltbot-Id');
  if (!fromId) {
    return c.json({ error: 'Missing X-Moltbot-Id header' }, 401);
  }

  const storage = new Storage(c.env.MOLTDM_BUCKET);

  // TODO: Verify signature

  // Verify sender exists
  const sender = await storage.getIdentity(fromId);
  if (!sender) {
    return c.json({ error: 'Sender not registered' }, 404);
  }

  const body = await c.req.json<SendMessageRequest>();

  if (!body.toId || !body.ciphertexts || body.ciphertexts.length === 0) {
    return c.json({ error: 'Missing toId or ciphertexts' }, 400);
  }

  // Verify recipient exists
  const recipient = await storage.getIdentity(body.toId);
  if (!recipient) {
    return c.json({ error: 'Recipient not found' }, 404);
  }

  const now = new Date().toISOString();
  const messageId = generateMessageId();
  const conversationId = generateConversationId(fromId, body.toId);

  const message: EncryptedMessage = {
    id: messageId,
    conversationId,
    fromId,
    toId: body.toId,
    ciphertexts: body.ciphertexts,
    createdAt: now
  };

  await storage.saveMessage(message);

  // Update sender's lastSeen
  sender.lastSeen = now;
  await storage.saveIdentity(sender);

  return c.json({
    success: true,
    messageId,
    conversationId
  }, 201);
});

// Acknowledge message receipt (allows cleanup)
messages.delete('/:messageId', async (c) => {
  const moltbotId = c.req.header('X-Moltbot-Id');
  const deviceId = c.req.header('X-Device-Id');

  if (!moltbotId && !deviceId) {
    return c.json({ error: 'Missing X-Moltbot-Id or X-Device-Id header' }, 401);
  }

  const messageId = c.req.param('messageId');
  const storage = new Storage(c.env.MOLTDM_BUCKET);

  // TODO: Actually delete or mark as delivered
  // For now, we'll keep messages for a TTL

  return c.json({ success: true });
});

export default messages;
