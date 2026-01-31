import { x25519 } from '@noble/curves/ed25519';

// Types
export interface Message {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
  conversationId: string;
  direction: 'incoming' | 'outgoing';
}

export interface Conversation {
  id: string;
  participantId: string;
  lastMessage?: Message;
  unreadCount: number;
}

export interface MoltDMBrowserOptions {
  relayUrl?: string;
  storagePrefix?: string;
}

interface DeviceIdentity {
  deviceId: string;
  moltbotId: string;
  deviceName: string;
  publicKey: string;
  privateKey: string;
  linkedAt: string;
}

interface Session {
  recipientId: string;
  sharedSecret: string;
}

type MessageCallback = (messages: Message[]) => void;
type ConnectionCallback = (connected: boolean) => void;

// Utility functions
function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(str: string): Uint8Array {
  return new Uint8Array(atob(str).split('').map(c => c.charCodeAt(0)));
}

function generateDeviceName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Chrome')) return 'Chrome Browser';
  if (ua.includes('Firefox')) return 'Firefox Browser';
  if (ua.includes('Safari')) return 'Safari Browser';
  if (ua.includes('Edge')) return 'Edge Browser';
  return 'Web Browser';
}

// Main browser client class
export class MoltDMBrowser {
  private relayUrl: string;
  private storagePrefix: string;
  private identity: DeviceIdentity | null = null;
  private sessions: Map<string, Session> = new Map();
  private pollInterval: number | null = null;
  private messageCallbacks: Set<MessageCallback> = new Set();
  private connectionCallbacks: Set<ConnectionCallback> = new Set();
  private lastMessageId: string | null = null;

  constructor(options: MoltDMBrowserOptions = {}) {
    this.relayUrl = options.relayUrl || 'https://relay.moltdm.com';
    this.storagePrefix = options.storagePrefix || 'moltdm';
    this.loadIdentity();
    this.loadSessions();
  }

  // Check if device is linked
  get isLinked(): boolean {
    return this.identity !== null;
  }

  // Get linked moltbot ID
  get moltbotId(): string | null {
    return this.identity?.moltbotId || null;
  }

  // Get device ID
  get deviceId(): string | null {
    return this.identity?.deviceId || null;
  }

  private loadIdentity(): void {
    const stored = localStorage.getItem(`${this.storagePrefix}:identity`);
    if (stored) {
      this.identity = JSON.parse(stored);
    }
  }

  private saveIdentity(): void {
    if (this.identity) {
      localStorage.setItem(`${this.storagePrefix}:identity`, JSON.stringify(this.identity));
    }
  }

  private loadSessions(): void {
    const stored = localStorage.getItem(`${this.storagePrefix}:sessions`);
    if (stored) {
      const obj = JSON.parse(stored);
      this.sessions = new Map(Object.entries(obj));
    }
  }

  private saveSessions(): void {
    const obj = Object.fromEntries(this.sessions);
    localStorage.setItem(`${this.storagePrefix}:sessions`, JSON.stringify(obj));
  }

  // Start pairing process with a token
  async startPairing(token: string): Promise<{ status: 'pending' | 'approved' | 'rejected' | 'expired' }> {
    // Generate device keys
    const privateKey = x25519.utils.randomPrivateKey();
    const publicKey = x25519.getPublicKey(privateKey);

    const deviceName = generateDeviceName();

    // Submit pairing request
    const response = await fetch(`${this.relayUrl}/pair/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        deviceName,
        devicePublicKey: toBase64(publicKey)
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Pairing failed: ${error.error}`);
    }

    const result = await response.json();

    // Store pending pairing info
    localStorage.setItem(`${this.storagePrefix}:pending`, JSON.stringify({
      token,
      privateKey: toBase64(privateKey),
      publicKey: toBase64(publicKey),
      deviceName
    }));

    return { status: result.status };
  }

  // Check pairing status
  async checkPairingStatus(token: string): Promise<{
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    deviceId?: string;
    moltbotId?: string;
  }> {
    const response = await fetch(`${this.relayUrl}/pair/status/${token}`);

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Status check failed: ${error.error}`);
    }

    const result = await response.json();

    // If approved, save identity
    if (result.status === 'approved') {
      const pending = localStorage.getItem(`${this.storagePrefix}:pending`);
      if (pending) {
        const { privateKey, publicKey, deviceName } = JSON.parse(pending);
        this.identity = {
          deviceId: result.deviceId,
          moltbotId: result.moltbotId,
          deviceName,
          publicKey,
          privateKey,
          linkedAt: new Date().toISOString()
        };
        this.saveIdentity();
        localStorage.removeItem(`${this.storagePrefix}:pending`);
      }
    }

    return result;
  }

  // Poll for pairing approval
  async waitForApproval(token: string, timeoutMs: number = 300000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.checkPairingStatus(token);

      if (result.status === 'approved') {
        return true;
      }

      if (result.status === 'rejected' || result.status === 'expired') {
        return false;
      }

      // Wait 2 seconds before next check
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return false;
  }

  // Unlink device
  async unlink(): Promise<void> {
    if (!this.identity) return;

    try {
      await fetch(`${this.relayUrl}/devices/${this.identity.deviceId}`, {
        method: 'DELETE',
        headers: {
          'X-Moltbot-Id': this.identity.moltbotId,
          'X-Device-Id': this.identity.deviceId
        }
      });
    } catch {
      // Ignore errors - device might already be removed
    }

    localStorage.removeItem(`${this.storagePrefix}:identity`);
    localStorage.removeItem(`${this.storagePrefix}:sessions`);
    localStorage.removeItem(`${this.storagePrefix}:messages`);
    this.identity = null;
    this.sessions.clear();
    this.stopPolling();
  }

  // Fetch messages
  async fetchMessages(): Promise<Message[]> {
    if (!this.identity) {
      throw new Error('Device not linked');
    }

    const response = await fetch(`${this.relayUrl}/messages/device`, {
      headers: {
        'X-Moltbot-Id': this.identity.moltbotId,
        'X-Device-Id': this.identity.deviceId
      }
    });

    if (!response.ok) {
      this.notifyConnection(false);
      throw new Error('Failed to fetch messages');
    }

    this.notifyConnection(true);
    const data = await response.json();
    const messages: Message[] = [];

    for (const msg of data.messages) {
      // Try to get or derive session
      const partnerId = msg.direction === 'incoming' ? msg.from : msg.to;
      let session = this.sessions.get(partnerId);

      if (!session && msg.ephemeralKey) {
        session = await this.deriveSession(partnerId, msg.ephemeralKey);
        this.sessions.set(partnerId, session);
        this.saveSessions();
      }

      if (!session) {
        console.warn(`No session for ${partnerId}, skipping message`);
        continue;
      }

      try {
        const content = await this.decrypt(msg.ciphertext, session.sharedSecret);
        messages.push({
          id: msg.id,
          from: msg.from,
          to: msg.to,
          content,
          timestamp: msg.createdAt,
          conversationId: msg.conversationId,
          direction: msg.direction
        });
      } catch (e) {
        console.error(`Failed to decrypt message ${msg.id}:`, e);
      }
    }

    return messages;
  }

  private async deriveSession(partnerId: string, ephemeralKey: string): Promise<Session> {
    if (!this.identity) throw new Error('Not linked');

    // For browser, we need the moltbot's SPK private key shared during pairing
    // For now, use a simplified approach where the relay provides session keys
    // In full implementation, device would receive session key during pairing

    const ephemeralPublic = fromBase64(ephemeralKey);
    const ourPrivate = fromBase64(this.identity.privateKey);
    const sharedSecret = x25519.getSharedSecret(ourPrivate, ephemeralPublic);

    return {
      recipientId: partnerId,
      sharedSecret: toBase64(sharedSecret)
    };
  }

  private async decrypt(ciphertext: string, sharedSecret: string): Promise<string> {
    const key = fromBase64(sharedSecret).slice(0, 32);
    const combined = fromBase64(ciphertext);
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      encrypted
    );

    return new TextDecoder().decode(decrypted);
  }

  // Get conversations list
  async getConversations(): Promise<Conversation[]> {
    const messages = await this.fetchMessages();
    const convMap = new Map<string, Conversation>();

    for (const msg of messages) {
      const existing = convMap.get(msg.conversationId);
      if (!existing || new Date(msg.timestamp) > new Date(existing.lastMessage?.timestamp || 0)) {
        const participantId = msg.direction === 'incoming' ? msg.from : msg.to;
        convMap.set(msg.conversationId, {
          id: msg.conversationId,
          participantId,
          lastMessage: msg,
          unreadCount: 0 // TODO: Track read status
        });
      }
    }

    return Array.from(convMap.values())
      .sort((a, b) => {
        const aTime = new Date(a.lastMessage?.timestamp || 0).getTime();
        const bTime = new Date(b.lastMessage?.timestamp || 0).getTime();
        return bTime - aTime;
      });
  }

  // Subscribe to new messages
  onMessage(callback: MessageCallback): () => void {
    this.messageCallbacks.add(callback);
    return () => this.messageCallbacks.delete(callback);
  }

  // Subscribe to connection status
  onConnection(callback: ConnectionCallback): () => void {
    this.connectionCallbacks.add(callback);
    return () => this.connectionCallbacks.delete(callback);
  }

  private notifyMessages(messages: Message[]): void {
    for (const cb of this.messageCallbacks) {
      try {
        cb(messages);
      } catch (e) {
        console.error('Message callback error:', e);
      }
    }
  }

  private notifyConnection(connected: boolean): void {
    for (const cb of this.connectionCallbacks) {
      try {
        cb(connected);
      } catch (e) {
        console.error('Connection callback error:', e);
      }
    }
  }

  // Start polling for new messages
  startPolling(intervalMs: number = 5000): void {
    if (this.pollInterval) return;

    const poll = async () => {
      try {
        const messages = await this.fetchMessages();
        if (messages.length > 0) {
          const lastId = messages[messages.length - 1].id;
          if (lastId !== this.lastMessageId) {
            this.lastMessageId = lastId;
            this.notifyMessages(messages);
          }
        }
      } catch (e) {
        console.error('Poll error:', e);
      }
    };

    poll(); // Initial poll
    this.pollInterval = window.setInterval(poll, intervalMs);
  }

  // Stop polling
  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

export default MoltDMBrowser;
