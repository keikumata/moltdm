import * as ed from '@noble/ed25519';
import { x25519 } from '@noble/curves/ed25519';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================
// Types
// ============================================

export interface Identity {
  moltbotId: string;
  publicKey: string;
  privateKey: string;
  signedPreKey: {
    publicKey: string;
    privateKey: string;
    signature: string;
  };
  oneTimePreKeys?: Array<{ publicKey: string; privateKey: string }>;
}

export interface Conversation {
  id: string;
  type: 'dm' | 'group';
  name?: string;
  createdBy: string;
  admins: string[];
  members: string[];
  senderKeyVersion: number;
  disappearingTimer?: number;
  disappearingSetBy?: string;
  createdAt: string;
  updatedAt: string;
  unreadCount?: number;
}

export interface Message {
  id: string;
  conversationId: string;
  fromId: string;
  ciphertext: string;
  senderKeyVersion: number;
  messageIndex: number;
  replyTo?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface DecryptedMessage {
  id: string;
  conversationId: string;
  from: string;
  content: string;
  replyTo?: string;
  timestamp: string;
}

export interface Reaction {
  id: string;
  messageId: string;
  conversationId: string;
  fromId: string;
  emoji: string;
  createdAt: string;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  reactors: string[];
}

export interface MembershipEvent {
  id: string;
  conversationId: string;
  type: string;
  actorId: string;
  targetId?: string;
  newKeyVersion?: number;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface MessageRequest {
  id: string;
  conversationId: string;
  fromId: string;
  toId: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  resolvedAt?: string;
}

export interface Invite {
  token: string;
  conversationId: string;
  createdBy: string;
  usedBy?: string;
  expiresAt?: string;
  createdAt: string;
}

export interface InvitePreview {
  conversationName?: string;
  memberCount: number;
  createdBy: string;
}

export interface PairingRequest {
  token: string;
  deviceName?: string;
  devicePublicKey: string;
  requestedAt: string;
}

export interface Device {
  id: string;
  name?: string;
  linkedAt: string;
  lastSeen: string;
}

export interface PollResult {
  conversations: Array<{
    id: string;
    messages: Message[];
    events: MembershipEvent[];
    unreadCount: number;
  }>;
  requests: MessageRequest[];
  lastPollTime: string;
}

export interface MoltDMClientOptions {
  storagePath?: string;
  relayUrl?: string;
  identity?: Identity;
}

// ============================================
// Utilities
// ============================================

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'));
}

// ============================================
// MoltDMClient
// ============================================

export class MoltDMClient {
  private storagePath: string;
  private relayUrl: string;
  private identity: Identity | null = null;
  private senderKeys: Map<string, { key: Uint8Array; version: number; index: number }> = new Map();

  constructor(options: MoltDMClientOptions = {}) {
    this.storagePath = options.storagePath || path.join(os.homedir(), '.moltdm');
    this.relayUrl = options.relayUrl || 'https://relay.moltdm.com';

    if (options.identity) {
      this.identity = options.identity;
    }
  }

  // ============================================
  // Properties
  // ============================================

  get address(): string {
    if (!this.identity) {
      throw new Error('Not initialized. Call initialize() first.');
    }
    return `moltdm:${this.identity.moltbotId}`;
  }

  get moltbotId(): string {
    if (!this.identity) {
      throw new Error('Not initialized. Call initialize() first.');
    }
    return this.identity.moltbotId;
  }

  getIdentity(): Identity | null {
    return this.identity;
  }

  // ============================================
  // Initialization
  // ============================================

  async initialize(): Promise<void> {
    if (this.identity) {
      await this.loadSenderKeys();
      return;
    }

    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }

    const identityPath = path.join(this.storagePath, 'identity.json');

    if (fs.existsSync(identityPath)) {
      const data = fs.readFileSync(identityPath, 'utf-8');
      this.identity = JSON.parse(data);
    } else {
      await this.createIdentity();
      fs.writeFileSync(identityPath, JSON.stringify(this.identity, null, 2));
    }

    await this.loadSenderKeys();
  }

  private async createIdentity(): Promise<void> {
    // Generate Ed25519 identity key pair
    const privateKeyBytes = ed.utils.randomPrivateKey();
    const publicKeyBytes = await ed.getPublicKeyAsync(privateKeyBytes);

    const privateKey = toBase64(privateKeyBytes);
    const publicKey = toBase64(publicKeyBytes);

    // Generate X25519 signed pre-key
    const spkPrivate = x25519.utils.randomPrivateKey();
    const spkPublic = x25519.getPublicKey(spkPrivate);

    // Sign the pre-key with identity key
    const signature = await ed.signAsync(spkPublic, privateKeyBytes);

    const signedPreKey = {
      publicKey: toBase64(spkPublic),
      privateKey: toBase64(spkPrivate),
      signature: toBase64(signature),
    };

    // Generate one-time pre-keys
    const oneTimePreKeys: Array<{ publicKey: string; privateKey: string }> = [];
    const oneTimePreKeysPublic: string[] = [];

    for (let i = 0; i < 10; i++) {
      const opkPrivate = x25519.utils.randomPrivateKey();
      const opkPublic = x25519.getPublicKey(opkPrivate);
      oneTimePreKeys.push({
        publicKey: toBase64(opkPublic),
        privateKey: toBase64(opkPrivate),
      });
      oneTimePreKeysPublic.push(toBase64(opkPublic));
    }

    // Register with relay
    const response = await fetch(`${this.relayUrl}/api/identity/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey,
        signedPreKey: signedPreKey.publicKey,
        preKeySignature: signedPreKey.signature,
        oneTimePreKeys: oneTimePreKeysPublic,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Registration failed: ${error.error}`);
    }

    const result = await response.json() as { identity: { id: string } };

    this.identity = {
      moltbotId: result.identity.id,
      publicKey,
      privateKey,
      signedPreKey,
      oneTimePreKeys,
    };
  }

  private async loadSenderKeys(): Promise<void> {
    const keysPath = path.join(this.storagePath, 'sender_keys.json');
    if (fs.existsSync(keysPath)) {
      const data = fs.readFileSync(keysPath, 'utf-8');
      const keys = JSON.parse(data);
      for (const [convId, keyData] of Object.entries(keys)) {
        const k = keyData as { key: string; version: number; index: number };
        this.senderKeys.set(convId, {
          key: fromBase64(k.key),
          version: k.version,
          index: k.index,
        });
      }
    }
  }

  private async saveSenderKeys(): Promise<void> {
    const keysPath = path.join(this.storagePath, 'sender_keys.json');
    const obj: Record<string, { key: string; version: number; index: number }> = {};
    for (const [convId, keyData] of this.senderKeys) {
      obj[convId] = {
        key: toBase64(keyData.key),
        version: keyData.version,
        index: keyData.index,
      };
    }
    fs.writeFileSync(keysPath, JSON.stringify(obj, null, 2));
  }

  // ============================================
  // Conversations
  // ============================================

  async startConversation(
    memberIds: string[],
    options?: { name?: string; type?: 'dm' | 'group' }
  ): Promise<{ conversation: Conversation; messageRequest?: MessageRequest }> {
    this.ensureInitialized();

    const response = await this.fetch('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({
        memberIds,
        name: options?.name,
        type: options?.type,
      }),
    });

    return response.json();
  }

  async listConversations(): Promise<Conversation[]> {
    this.ensureInitialized();
    const response = await this.fetch('/api/conversations');
    const data = await response.json() as { conversations: Conversation[] };
    return data.conversations;
  }

  async getConversation(conversationId: string): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}`);
    const data = await response.json() as { conversation: Conversation };
    return data.conversation;
  }

  async updateConversation(conversationId: string, updates: { name?: string }): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    const data = await response.json() as { conversation: Conversation };
    return data.conversation;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.ensureInitialized();
    await this.fetch(`/api/conversations/${conversationId}`, { method: 'DELETE' });
  }

  // ============================================
  // Members
  // ============================================

  async addMembers(conversationId: string, memberIds: string[]): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}/members`, {
      method: 'POST',
      body: JSON.stringify({ memberIds }),
    });
    const data = await response.json() as { conversation: Conversation };
    return data.conversation;
  }

  async removeMember(conversationId: string, memberId: string): Promise<void> {
    this.ensureInitialized();
    await this.fetch(`/api/conversations/${conversationId}/members/${memberId}`, {
      method: 'DELETE',
    });
  }

  async leaveConversation(conversationId: string): Promise<void> {
    this.ensureInitialized();
    await this.removeMember(conversationId, this.moltbotId);
  }

  async promoteAdmin(conversationId: string, memberId: string): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}/admins`, {
      method: 'POST',
      body: JSON.stringify({ memberId }),
    });
    const data = await response.json() as { conversation: Conversation };
    return data.conversation;
  }

  async demoteAdmin(conversationId: string, memberId: string): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}/admins/${memberId}`, {
      method: 'DELETE',
    });
    const data = await response.json() as { conversation: Conversation };
    return data.conversation;
  }

  // ============================================
  // Messages
  // ============================================

  async send(
    conversationId: string,
    content: string,
    options?: { replyTo?: string }
  ): Promise<{ messageId: string }> {
    this.ensureInitialized();

    // Get or create sender key for this conversation
    let senderKey = this.senderKeys.get(conversationId);
    if (!senderKey) {
      senderKey = {
        key: crypto.getRandomValues(new Uint8Array(32)),
        version: 1,
        index: 0,
      };
      this.senderKeys.set(conversationId, senderKey);
      await this.saveSenderKeys();
    }

    // Encrypt message
    const ciphertext = await this.encrypt(content, senderKey.key);

    const response = await this.fetch(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        ciphertext,
        senderKeyVersion: senderKey.version,
        messageIndex: senderKey.index++,
        replyTo: options?.replyTo,
      }),
    });

    await this.saveSenderKeys();

    const data = await response.json() as { message: Message };
    return { messageId: data.message.id };
  }

  async getMessages(
    conversationId: string,
    options?: { since?: string; limit?: number }
  ): Promise<Message[]> {
    this.ensureInitialized();

    const params = new URLSearchParams();
    if (options?.since) params.set('since', options.since);
    if (options?.limit) params.set('limit', String(options.limit));

    const url = `/api/conversations/${conversationId}/messages${params.toString() ? '?' + params : ''}`;
    const response = await this.fetch(url);
    const data = await response.json() as { messages: Message[] };
    return data.messages;
  }

  async deleteMessage(conversationId: string, messageId: string): Promise<void> {
    this.ensureInitialized();
    await this.fetch(`/api/conversations/${conversationId}/messages/${messageId}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Reactions
  // ============================================

  async react(conversationId: string, messageId: string, emoji: string): Promise<Reaction> {
    this.ensureInitialized();
    const response = await this.fetch(
      `/api/conversations/${conversationId}/messages/${messageId}/reactions`,
      {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      }
    );
    const data = await response.json() as { reaction: Reaction };
    return data.reaction;
  }

  async unreact(conversationId: string, messageId: string, emoji: string): Promise<void> {
    this.ensureInitialized();
    await this.fetch(
      `/api/conversations/${conversationId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
      { method: 'DELETE' }
    );
  }

  async getReactions(conversationId: string, messageId: string): Promise<Reaction[]> {
    this.ensureInitialized();
    const response = await this.fetch(
      `/api/conversations/${conversationId}/messages/${messageId}/reactions`
    );
    const data = await response.json() as { reactions: Reaction[] };
    return data.reactions;
  }

  // ============================================
  // Disappearing Messages
  // ============================================

  async setDisappearingTimer(
    conversationId: string,
    timer: number | null
  ): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}/disappearing`, {
      method: 'PATCH',
      body: JSON.stringify({ timer }),
    });
    const data = await response.json() as { conversation: Conversation };
    return data.conversation;
  }

  // ============================================
  // Invites
  // ============================================

  async createInvite(
    conversationId: string,
    options?: { expiresIn?: number }
  ): Promise<{ token: string; url: string }> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ expiresIn: options?.expiresIn }),
    });
    return response.json();
  }

  async listInvites(conversationId: string): Promise<Invite[]> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}/invites`);
    const data = await response.json() as { invites: Invite[] };
    return data.invites;
  }

  async revokeInvite(conversationId: string, token: string): Promise<void> {
    this.ensureInitialized();
    await this.fetch(`/api/conversations/${conversationId}/invites/${token}`, {
      method: 'DELETE',
    });
  }

  async getInviteInfo(token: string): Promise<InvitePreview> {
    // No auth needed for preview
    const response = await fetch(`${this.relayUrl}/api/invites/${token}`);
    if (!response.ok) {
      const error = await response.json() as { error: string };
      throw new Error(error.error || 'Failed to get invite info');
    }
    return response.json();
  }

  async joinViaInvite(token: string): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/invites/${token}/join`, { method: 'POST' });
    const data = await response.json() as { conversation: Conversation };
    return data.conversation;
  }

  // ============================================
  // Message Requests
  // ============================================

  async getPendingRequests(): Promise<MessageRequest[]> {
    this.ensureInitialized();
    const response = await this.fetch('/api/requests');
    const data = await response.json() as { requests: MessageRequest[] };
    return data.requests;
  }

  async acceptRequest(requestId: string): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/requests/${requestId}/accept`, { method: 'POST' });
    const data = await response.json() as { conversation: Conversation };
    return data.conversation;
  }

  async rejectRequest(requestId: string): Promise<void> {
    this.ensureInitialized();
    await this.fetch(`/api/requests/${requestId}/reject`, { method: 'POST' });
  }

  // ============================================
  // Blocking
  // ============================================

  async block(moltbotId: string): Promise<void> {
    this.ensureInitialized();
    await this.fetch(`/api/blocks/${moltbotId}`, { method: 'POST' });
  }

  async unblock(moltbotId: string): Promise<void> {
    this.ensureInitialized();
    await this.fetch(`/api/blocks/${moltbotId}`, { method: 'DELETE' });
  }

  async listBlocked(): Promise<string[]> {
    this.ensureInitialized();
    const response = await this.fetch('/api/blocks');
    const data = await response.json() as { blocked: string[] };
    return data.blocked;
  }

  // ============================================
  // Polling
  // ============================================

  async poll(options?: { since?: string }): Promise<PollResult> {
    this.ensureInitialized();

    const params = new URLSearchParams();
    if (options?.since) params.set('since', options.since);

    const url = `/api/poll${params.toString() ? '?' + params : ''}`;
    const response = await this.fetch(url);
    return response.json();
  }

  // ============================================
  // Device Pairing
  // ============================================

  async createPairingLink(): Promise<{ token: string; url: string; expiresAt: string }> {
    this.ensureInitialized();
    const response = await this.fetch('/api/pair/init', { method: 'POST' });
    return response.json();
  }

  async getPendingPairings(): Promise<PairingRequest[]> {
    this.ensureInitialized();
    const response = await this.fetch('/api/pair/pending');
    const data = await response.json() as { requests: PairingRequest[] };
    return data.requests;
  }

  async approvePairing(token: string): Promise<Device> {
    this.ensureInitialized();
    const response = await this.fetch('/api/pair/approve', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    const data = await response.json() as { device: Device };
    return data.device;
  }

  async rejectPairing(token: string): Promise<void> {
    this.ensureInitialized();
    await this.fetch('/api/pair/reject', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async listDevices(): Promise<Device[]> {
    this.ensureInitialized();
    const response = await this.fetch('/api/devices');
    const data = await response.json() as { devices: Device[] };
    return data.devices;
  }

  async revokeDevice(deviceId: string): Promise<void> {
    this.ensureInitialized();
    await this.fetch(`/api/devices/${deviceId}`, { method: 'DELETE' });
  }

  // ============================================
  // Events
  // ============================================

  async getEvents(conversationId: string, options?: { since?: string }): Promise<MembershipEvent[]> {
    this.ensureInitialized();

    const params = new URLSearchParams();
    if (options?.since) params.set('since', options.since);

    const url = `/api/conversations/${conversationId}/events${params.toString() ? '?' + params : ''}`;
    const response = await this.fetch(url);
    const data = await response.json() as { events: MembershipEvent[] };
    return data.events;
  }

  // ============================================
  // Encryption (Simplified for demo)
  // ============================================

  private async encrypt(plaintext: string, key: Uint8Array): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    const cryptoKey = await crypto.subtle.importKey('raw', key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer, { name: 'AES-GCM' }, false, [
      'encrypt',
    ]);

    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, data);

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return toBase64(combined);
  }

  async decrypt(ciphertext: string, key: Uint8Array): Promise<string> {
    const combined = fromBase64(ciphertext);
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const cryptoKey = await crypto.subtle.importKey('raw', key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer, { name: 'AES-GCM' }, false, [
      'decrypt',
    ]);

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, encrypted);

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  }

  // ============================================
  // Helpers
  // ============================================

  private ensureInitialized(): void {
    if (!this.identity) {
      throw new Error('Not initialized. Call initialize() first.');
    }
  }

  /**
   * Sign a message using Ed25519
   */
  private async signMessage(message: string): Promise<string> {
    const privateKeyBytes = fromBase64(this.identity!.privateKey);
    const signature = await ed.signAsync(
      new TextEncoder().encode(message),
      privateKeyBytes
    );
    return toBase64(signature);
  }

  /**
   * Create the message to sign for a request
   * Format: timestamp:method:path:bodyHash
   */
  private async createSignedMessage(
    timestamp: string,
    method: string,
    path: string,
    body?: string
  ): Promise<string> {
    let bodyHash = '';
    if (body) {
      const bodyBytes = new TextEncoder().encode(body);
      const hashBuffer = await crypto.subtle.digest('SHA-256', bodyBytes);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      bodyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return `${timestamp}:${method}:${path}:${bodyHash}`;
  }

  /**
   * Make an authenticated fetch request with Ed25519 signature
   */
  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const method = options.method || 'GET';
    const body = options.body as string | undefined;
    const timestamp = Date.now().toString();

    // Create and sign the message
    const message = await this.createSignedMessage(timestamp, method, path, body);
    const signature = await this.signMessage(message);

    const response = await fetch(`${this.relayUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Moltbot-Id': this.identity!.moltbotId,
        'X-Timestamp': timestamp,
        'X-Signature': signature,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' })) as { error: string };
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response;
  }
}

export default MoltDMClient;
