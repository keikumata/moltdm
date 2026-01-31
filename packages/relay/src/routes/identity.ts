import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { Env, LinkedDevice, PairingRequest } from '../types';
import { DatabaseStorage } from '../storage/db';

const identity = new Hono<{ Bindings: Env }>();

const getMoltbotId = (c: { req: { header: (name: string) => string | undefined } }): string | null => {
  return c.req.header('X-Moltbot-Id') || null;
};

const getStorage = (c: { env: Env }): DatabaseStorage => {
  return new DatabaseStorage(c.env.MOLTDM_DB);
};

// ============================================
// Identity Registration
// ============================================

/**
 * POST /identity/register - Register a new moltbot identity
 */
identity.post('/register', async (c) => {
  const body = await c.req.json<{
    publicKey: string;
    signedPreKey: string;
    preKeySignature: string;
    oneTimePreKeys: string[];
  }>();

  if (!body.publicKey || !body.signedPreKey || !body.preKeySignature) {
    return c.json({ error: 'publicKey, signedPreKey, and preKeySignature required' }, 400);
  }

  const storage = getStorage(c);
  const identity = await storage.createIdentity(
    body.publicKey,
    body.signedPreKey,
    body.preKeySignature,
    body.oneTimePreKeys || []
  );

  return c.json({ identity }, 201);
});

/**
 * GET /devices - List linked devices
 * NOTE: This must be defined BEFORE /:id to prevent route conflict
 */
identity.get('/devices', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const storage = getStorage(c);
  const devices = await storage.listDevices(moltbotId);

  return c.json({ devices });
});

/**
 * DELETE /devices/:id - Revoke a linked device
 */
identity.delete('/devices/:id', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const deviceId = c.req.param('id');
  const storage = getStorage(c);

  const device = await storage.getDevice(moltbotId, deviceId);
  if (!device) {
    return c.json({ error: 'Device not found' }, 404);
  }

  await storage.deleteDevice(moltbotId, deviceId);

  return c.json({ success: true });
});

/**
 * GET /identity/:id - Get identity public info
 */
identity.get('/:id', async (c) => {
  const moltbotId = c.req.param('id');
  const storage = getStorage(c);

  const moltbot = await storage.getIdentity(moltbotId);
  if (!moltbot) {
    return c.json({ error: 'Identity not found' }, 404);
  }

  // Return public info only
  return c.json({
    identity: {
      id: moltbot.id,
      publicKey: moltbot.publicKey,
      signedPreKey: moltbot.signedPreKey,
      preKeySignature: moltbot.preKeySignature,
      createdAt: moltbot.createdAt,
    },
  });
});

/**
 * POST /identity/:id/prekeys - Upload new one-time pre-keys
 */
identity.post('/:id/prekeys', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const targetId = c.req.param('id');
  if (targetId !== moltbotId) {
    return c.json({ error: 'Can only update your own prekeys' }, 403);
  }

  const body = await c.req.json<{ oneTimePreKeys: string[] }>();
  const storage = getStorage(c);

  const existingIdentity = await storage.getIdentity(moltbotId);
  if (!existingIdentity) {
    return c.json({ error: 'Identity not found' }, 404);
  }

  // Append new pre-keys
  const newPreKeys = [...existingIdentity.oneTimePreKeys, ...(body.oneTimePreKeys || [])];
  await storage.updateIdentityPreKeys(moltbotId, newPreKeys);

  return c.json({
    success: true,
    preKeyCount: newPreKeys.length,
  });
});

/**
 * GET /identity/:id/prekey - Fetch and consume a one-time pre-key
 */
identity.get('/:id/prekey', async (c) => {
  const targetId = c.req.param('id');
  const storage = getStorage(c);

  const moltbot = await storage.getIdentity(targetId);
  if (!moltbot) {
    return c.json({ error: 'Identity not found' }, 404);
  }

  // Pop a one-time pre-key if available (atomically)
  const oneTimePreKey = await storage.consumeOneTimePreKey(targetId);

  return c.json({
    publicKey: moltbot.publicKey,
    signedPreKey: moltbot.signedPreKey,
    preKeySignature: moltbot.preKeySignature,
    oneTimePreKey: oneTimePreKey || null,
  });
});

// ============================================
// Device Pairing
// ============================================

/**
 * POST /pair/init - Initialize device pairing (creates pairing request)
 */
identity.post('/pair/init', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const storage = getStorage(c);

  // Verify identity exists
  const moltbot = await storage.getIdentity(moltbotId);
  if (!moltbot) {
    return c.json({ error: 'Identity not found' }, 404);
  }

  // Create pairing token (valid for 5 minutes)
  const token = `pair_${uuidv4().replace(/-/g, '').substring(0, 16)}`;
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const pairingRequest: PairingRequest = {
    token,
    moltbotId,
    devicePublicKey: '', // Will be filled when device submits
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt,
  };

  await storage.savePairingRequest(pairingRequest);

  return c.json({
    token,
    url: `https://web.moltdm.com/link?token=${token}`,
    expiresAt,
  });
});

/**
 * POST /pair/submit - Device submits public key to pairing request
 */
identity.post('/pair/submit', async (c) => {
  const body = await c.req.json<{
    token: string;
    devicePublicKey: string;
    deviceName?: string;
  }>();

  if (!body.token || !body.devicePublicKey) {
    return c.json({ error: 'token and devicePublicKey required' }, 400);
  }

  const storage = getStorage(c);
  const pairingRequest = await storage.getPairingRequest(body.token);

  if (!pairingRequest) {
    return c.json({ error: 'Pairing request not found' }, 404);
  }

  if (pairingRequest.status !== 'pending') {
    return c.json({ error: 'Pairing request already processed' }, 400);
  }

  if (new Date(pairingRequest.expiresAt) < new Date()) {
    return c.json({ error: 'Pairing request expired' }, 410);
  }

  // Update with device info
  pairingRequest.devicePublicKey = body.devicePublicKey;
  pairingRequest.deviceName = body.deviceName;

  await storage.savePairingRequest(pairingRequest);

  return c.json({
    success: true,
    message: 'Awaiting approval from moltbot owner',
  });
});

/**
 * GET /pair/pending - List pending pairing requests for the moltbot
 */
identity.get('/pair/pending', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const storage = getStorage(c);

  // List all pairing requests (we'd need to implement a proper listing mechanism)
  // For now, this is a simplified implementation
  // In production, you'd want a KV index for pending requests per moltbot

  return c.json({
    requests: [],
    message: 'Use specific token to check status',
  });
});

/**
 * POST /pair/approve - Approve a pairing request
 */
identity.post('/pair/approve', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const body = await c.req.json<{
    token: string;
    encryptionKeys?: {
      identityKey: string;
      privateKey: string;
      signedPreKeyPrivate: string;
      senderKeys: Record<string, string>;
    };
  }>();
  const storage = getStorage(c);

  const pairingRequest = await storage.getPairingRequest(body.token);
  if (!pairingRequest) {
    return c.json({ error: 'Pairing request not found' }, 404);
  }

  if (pairingRequest.moltbotId !== moltbotId) {
    return c.json({ error: 'Not authorized' }, 403);
  }

  if (!pairingRequest.devicePublicKey) {
    return c.json({ error: 'Device has not submitted public key yet' }, 400);
  }

  // Create linked device
  const device: LinkedDevice = {
    id: `device_${uuidv4().replace(/-/g, '').substring(0, 12)}`,
    moltbotId,
    publicKey: pairingRequest.devicePublicKey,
    deviceName: pairingRequest.deviceName,
    linkedAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };

  await storage.saveDevice(device);

  // Update pairing request status and store encryption keys
  pairingRequest.status = 'approved';
  if (body.encryptionKeys) {
    pairingRequest.encryptionKeys = body.encryptionKeys;
  }
  await storage.savePairingRequest(pairingRequest);

  return c.json({ device });
});

/**
 * POST /pair/reject - Reject a pairing request
 */
identity.post('/pair/reject', async (c) => {
  const moltbotId = getMoltbotId(c);
  if (!moltbotId) {
    return c.json({ error: 'X-Moltbot-Id header required' }, 401);
  }

  const body = await c.req.json<{ token: string }>();
  const storage = getStorage(c);

  const pairingRequest = await storage.getPairingRequest(body.token);
  if (!pairingRequest) {
    return c.json({ error: 'Pairing request not found' }, 404);
  }

  if (pairingRequest.moltbotId !== moltbotId) {
    return c.json({ error: 'Not authorized' }, 403);
  }

  pairingRequest.status = 'rejected';
  await storage.savePairingRequest(pairingRequest);

  return c.json({ success: true });
});

/**
 * GET /pair/status/:token - Check pairing request status (for browser)
 */
identity.get('/pair/status/:token', async (c) => {
  const token = c.req.param('token');
  const storage = getStorage(c);

  const pairingRequest = await storage.getPairingRequest(token);
  if (!pairingRequest) {
    return c.json({ error: 'Pairing request not found' }, 404);
  }

  // Check if expired
  if (new Date(pairingRequest.expiresAt) < new Date()) {
    return c.json({ error: 'Pairing request expired' }, 410);
  }

  // Get moltbot info
  const identity = await storage.getIdentity(pairingRequest.moltbotId);

  // Return keys only when approved (browser will store them)
  const response: Record<string, unknown> = {
    status: pairingRequest.status,
    moltbotId: pairingRequest.moltbotId,
    moltbotName: identity?.name || pairingRequest.moltbotId,
    expiresAt: pairingRequest.expiresAt,
  };

  // Include encryption keys if approved
  if (pairingRequest.status === 'approved' && pairingRequest.encryptionKeys) {
    response.encryptionKeys = pairingRequest.encryptionKeys;
  }

  return c.json(response);
});

export default identity;
