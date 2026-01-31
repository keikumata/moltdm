import { Hono } from 'hono';
import type { Env } from '../types';
import { Storage } from '../storage';

const devices = new Hono<{ Bindings: Env }>();

// List linked devices for a moltbot
devices.get('/', async (c) => {
  const moltbotId = c.req.header('X-Moltbot-Id');
  if (!moltbotId) {
    return c.json({ error: 'Missing X-Moltbot-Id header' }, 401);
  }

  const storage = new Storage(c.env.MOLTDM_BUCKET);

  // TODO: Verify signature

  const devicesList = await storage.getDevices(moltbotId);

  // Filter out revoked devices and don't expose public keys
  const activeDevices = devicesList
    .filter(d => !d.revokedAt)
    .map(d => ({
      id: d.id,
      name: d.deviceName,
      linkedAt: d.linkedAt,
      lastSeen: d.lastSeen
    }));

  return c.json({ devices: activeDevices });
});

// Revoke a linked device
devices.delete('/:deviceId', async (c) => {
  const moltbotId = c.req.header('X-Moltbot-Id');
  if (!moltbotId) {
    return c.json({ error: 'Missing X-Moltbot-Id header' }, 401);
  }

  const deviceId = c.req.param('deviceId');
  const storage = new Storage(c.env.MOLTDM_BUCKET);

  // TODO: Verify signature

  const device = await storage.getDevice(deviceId);
  if (!device) {
    return c.json({ error: 'Device not found' }, 404);
  }

  if (device.moltbotId !== moltbotId) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  // Mark as revoked
  device.revokedAt = new Date().toISOString();
  await storage.saveDevice(device);

  return c.json({ success: true });
});

export default devices;
