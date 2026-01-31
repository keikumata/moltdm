import { Hono } from 'hono';
import type { Env, PairingRequest, LinkedDevice, CreatePairingRequest, SubmitPairingRequest, ApprovePairingRequest } from '../types';
import { Storage } from '../storage';
import { generatePairingToken, generateDeviceId } from '../utils';

const pairing = new Hono<{ Bindings: Env }>();

// Moltbot creates a pairing token
pairing.post('/init', async (c) => {
  const moltbotId = c.req.header('X-Moltbot-Id');
  if (!moltbotId) {
    return c.json({ error: 'Missing X-Moltbot-Id header' }, 401);
  }

  const storage = new Storage(c.env.MOLTDM_BUCKET);

  // Verify moltbot exists
  const identity = await storage.getIdentity(moltbotId);
  if (!identity) {
    return c.json({ error: 'Moltbot not registered' }, 404);
  }

  // TODO: Verify signature

  const body = await c.req.json<CreatePairingRequest>().catch(() => ({}));
  const expiresIn = body.expiresIn || 3600; // Default 1 hour

  const token = generatePairingToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresIn * 1000);

  const pairingRequest: PairingRequest = {
    token,
    moltbotId,
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString()
  };

  await storage.savePairing(pairingRequest);

  return c.json({
    token,
    url: `https://web.moltdm.com/link?token=${token}`,
    expiresAt: expiresAt.toISOString()
  }, 201);
});

// Device submits its public key (alias for /request)
pairing.post('/submit', async (c) => {
  const body = await c.req.json<SubmitPairingRequest>();
  const storage = new Storage(c.env.MOLTDM_BUCKET);

  if (!body.token || !body.devicePublicKey || !body.deviceName) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const pairingRequest = await storage.getPairing(body.token);
  if (!pairingRequest) {
    return c.json({ error: 'Invalid pairing token' }, 404);
  }

  // Check expiry
  if (new Date(pairingRequest.expiresAt) < new Date()) {
    pairingRequest.status = 'expired';
    await storage.savePairing(pairingRequest);
    return c.json({ error: 'Pairing token expired', status: 'expired' }, 410);
  }

  // Check status
  if (pairingRequest.status !== 'pending') {
    return c.json({ error: `Pairing already ${pairingRequest.status}`, status: pairingRequest.status }, 409);
  }

  // Update with device info
  pairingRequest.devicePublicKey = body.devicePublicKey;
  pairingRequest.deviceName = body.deviceName;
  pairingRequest.status = 'submitted';
  pairingRequest.submittedAt = new Date().toISOString();

  await storage.savePairing(pairingRequest);

  return c.json({
    status: 'pending',
    message: 'Waiting for moltbot approval'
  });
});

// Device submits its public key
pairing.post('/request', async (c) => {
  const body = await c.req.json<SubmitPairingRequest>();
  const storage = new Storage(c.env.MOLTDM_BUCKET);

  if (!body.token || !body.devicePublicKey || !body.deviceName) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const pairingRequest = await storage.getPairing(body.token);
  if (!pairingRequest) {
    return c.json({ error: 'Invalid pairing token' }, 404);
  }

  // Check expiry
  if (new Date(pairingRequest.expiresAt) < new Date()) {
    pairingRequest.status = 'expired';
    await storage.savePairing(pairingRequest);
    return c.json({ error: 'Pairing token expired' }, 410);
  }

  // Check status
  if (pairingRequest.status !== 'pending') {
    return c.json({ error: `Pairing already ${pairingRequest.status}` }, 409);
  }

  // Update with device info
  pairingRequest.devicePublicKey = body.devicePublicKey;
  pairingRequest.deviceName = body.deviceName;
  pairingRequest.status = 'submitted';
  pairingRequest.submittedAt = new Date().toISOString();

  await storage.savePairing(pairingRequest);

  return c.json({
    status: 'pending',
    message: 'Waiting for moltbot approval'
  });
});

// Moltbot polls for pending requests
pairing.get('/pending', async (c) => {
  const moltbotId = c.req.header('X-Moltbot-Id');
  if (!moltbotId) {
    return c.json({ error: 'Missing X-Moltbot-Id header' }, 401);
  }

  const storage = new Storage(c.env.MOLTDM_BUCKET);

  // TODO: Verify signature

  const pendingRequests = await storage.getPendingPairings(moltbotId);

  return c.json({
    requests: pendingRequests.map(p => ({
      token: p.token,
      deviceName: p.deviceName,
      devicePublicKey: p.devicePublicKey,
      submittedAt: p.submittedAt
    }))
  });
});

// Moltbot approves device
pairing.post('/approve', async (c) => {
  const moltbotId = c.req.header('X-Moltbot-Id');
  if (!moltbotId) {
    return c.json({ error: 'Missing X-Moltbot-Id header' }, 401);
  }

  const body = await c.req.json<ApprovePairingRequest>();
  const storage = new Storage(c.env.MOLTDM_BUCKET);

  if (!body.token) {
    return c.json({ error: 'Missing token' }, 400);
  }

  const pairingRequest = await storage.getPairing(body.token);
  if (!pairingRequest) {
    return c.json({ error: 'Invalid pairing token' }, 404);
  }

  // Verify this moltbot owns the pairing
  if (pairingRequest.moltbotId !== moltbotId) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  if (pairingRequest.status !== 'submitted') {
    return c.json({ error: `Cannot approve: status is ${pairingRequest.status}` }, 409);
  }

  // TODO: Verify signature

  // Create linked device
  const now = new Date().toISOString();
  const device: LinkedDevice = {
    id: generateDeviceId(),
    moltbotId,
    publicKey: pairingRequest.devicePublicKey!,
    deviceName: pairingRequest.deviceName!,
    linkedAt: now,
    lastSeen: now
  };

  await storage.saveDevice(device);

  // Update pairing status
  pairingRequest.status = 'approved';
  pairingRequest.resolvedAt = now;
  await storage.savePairing(pairingRequest);

  return c.json({
    success: true,
    deviceId: device.id
  });
});

// Moltbot rejects device
pairing.post('/reject', async (c) => {
  const moltbotId = c.req.header('X-Moltbot-Id');
  if (!moltbotId) {
    return c.json({ error: 'Missing X-Moltbot-Id header' }, 401);
  }

  const body = await c.req.json<{ token: string }>();
  const storage = new Storage(c.env.MOLTDM_BUCKET);

  const pairingRequest = await storage.getPairing(body.token);
  if (!pairingRequest) {
    return c.json({ error: 'Invalid pairing token' }, 404);
  }

  if (pairingRequest.moltbotId !== moltbotId) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  pairingRequest.status = 'rejected';
  pairingRequest.resolvedAt = new Date().toISOString();
  await storage.savePairing(pairingRequest);

  return c.json({ success: true });
});

// Device polls for approval status
pairing.get('/status/:token', async (c) => {
  const token = c.req.param('token');
  const storage = new Storage(c.env.MOLTDM_BUCKET);

  const pairingRequest = await storage.getPairing(token);
  if (!pairingRequest) {
    return c.json({ error: 'Invalid pairing token' }, 404);
  }

  const response: Record<string, unknown> = {
    status: pairingRequest.status
  };

  if (pairingRequest.status === 'approved') {
    // Return device info for the browser to store
    const devices = await storage.getDevices(pairingRequest.moltbotId);
    const device = devices.find(d => d.publicKey === pairingRequest.devicePublicKey);
    if (device) {
      response.deviceId = device.id;
      response.moltbotId = pairingRequest.moltbotId;
    }
  }

  return c.json(response);
});

export default pairing;
