/**
 * Legacy Storage - Identity, Devices, Pairing only
 * Messages now handled by ConversationStorage
 */

import type { MoltbotIdentity, LinkedDevice, PairingRequest } from './types';

export class Storage {
  constructor(private bucket: R2Bucket) {}

  // --- Identity ---

  async getIdentity(moltbotId: string): Promise<MoltbotIdentity | null> {
    const object = await this.bucket.get(`identities/${moltbotId}.json`);
    if (!object) return null;
    return object.json();
  }

  async saveIdentity(identity: MoltbotIdentity): Promise<void> {
    await this.bucket.put(
      `identities/${identity.id}.json`,
      JSON.stringify(identity),
      { httpMetadata: { contentType: 'application/json' } }
    );
  }

  // --- Devices ---

  async getDevice(deviceId: string): Promise<LinkedDevice | null> {
    const listed = await this.bucket.list({ prefix: 'devices/' });
    for (const obj of listed.objects) {
      const device = await this.bucket.get(obj.key);
      if (device) {
        const data: LinkedDevice = await device.json();
        if (data.id === deviceId) {
          return data;
        }
      }
    }
    return null;
  }

  async getDevices(moltbotId: string): Promise<LinkedDevice[]> {
    const listed = await this.bucket.list({ prefix: `devices/${moltbotId}/` });
    const devices: LinkedDevice[] = [];
    for (const obj of listed.objects) {
      const device = await this.bucket.get(obj.key);
      if (device) {
        devices.push(await device.json());
      }
    }
    return devices;
  }

  async saveDevice(device: LinkedDevice): Promise<void> {
    await this.bucket.put(
      `devices/${device.moltbotId}/${device.id}.json`,
      JSON.stringify(device),
      { httpMetadata: { contentType: 'application/json' } }
    );
  }

  // --- Pairing ---

  async getPairing(token: string): Promise<PairingRequest | null> {
    const object = await this.bucket.get(`pairing/${token}.json`);
    if (!object) return null;
    return object.json();
  }

  async savePairing(pairing: PairingRequest): Promise<void> {
    await this.bucket.put(
      `pairing/${pairing.token}.json`,
      JSON.stringify(pairing),
      { httpMetadata: { contentType: 'application/json' } }
    );
  }

  async getPendingPairings(moltbotId: string): Promise<PairingRequest[]> {
    const listed = await this.bucket.list({ prefix: 'pairing/' });
    const pending: PairingRequest[] = [];

    for (const obj of listed.objects) {
      const pairingObj = await this.bucket.get(obj.key);
      if (pairingObj) {
        const pairing: PairingRequest = await pairingObj.json();
        if (pairing.moltbotId === moltbotId && pairing.status === 'submitted') {
          if (new Date(pairing.expiresAt) > new Date()) {
            pending.push(pairing);
          }
        }
      }
    }

    return pending;
  }
}
