import * as ed from '@noble/ed25519';
import { x25519 } from '@noble/curves/ed25519';

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
  encryptedSenderKeys?: Record<string, string>;
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

// ============================================
// Storage Interface (for Node.js and Browser)
// ============================================

export interface Storage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * In-memory storage (for testing or ephemeral use)
 */
export class MemoryStorage implements Storage {
  private data: Map<string, string> = new Map();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

/**
 * Browser localStorage storage
 */
export class BrowserStorage implements Storage {
  private prefix: string;

  constructor(prefix = 'moltdm') {
    this.prefix = prefix;
  }

  async get(key: string): Promise<string | null> {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(`${this.prefix}:${key}`);
  }

  async set(key: string, value: string): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(`${this.prefix}:${key}`, value);
  }

  async delete(key: string): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(`${this.prefix}:${key}`);
  }
}

/**
 * Node.js file system storage
 * Note: This class uses dynamic imports and only works in Node.js environments.
 * For browser usage, use BrowserStorage or MemoryStorage instead.
 */
export class FileStorage implements Storage {
  private basePath: string;
  private _fs: any = null;
  private _path: any = null;
  private _initialized = false;

  constructor(basePath?: string) {
    this.basePath = basePath || '.moltdm';
  }

  private async ensureModules(): Promise<void> {
    if (this._initialized) return;

    // Only works in Node.js - will fail silently in browser
    if (typeof window !== 'undefined') {
      console.warn('FileStorage is not supported in browser. Use BrowserStorage instead.');
      return;
    }

    try {
      // Dynamic imports for Node.js modules
      const fs = await import(/* webpackIgnore: true */ 'fs');
      const path = await import(/* webpackIgnore: true */ 'path');
      const os = await import(/* webpackIgnore: true */ 'os');

      this._fs = fs;
      this._path = path;

      // Set default path if not provided
      if (this.basePath === '.moltdm') {
        const envPath = process.env.OPENCLAW_STATE_DIR;
        this.basePath = envPath
          ? path.join(envPath, '.moltdm')
          : path.join(os.homedir(), '.moltdm');
      }

      // Create directory if needed
      if (!fs.existsSync(this.basePath)) {
        fs.mkdirSync(this.basePath, { recursive: true });
      }

      this._initialized = true;
    } catch (e) {
      console.error('Failed to load Node.js modules for FileStorage:', e);
    }
  }

  async get(key: string): Promise<string | null> {
    await this.ensureModules();
    if (!this._fs) return null;

    const filePath = this._path.join(this.basePath, `${key}.json`);
    if (!this._fs.existsSync(filePath)) return null;
    return this._fs.readFileSync(filePath, 'utf-8');
  }

  async set(key: string, value: string): Promise<void> {
    await this.ensureModules();
    if (!this._fs) return;

    const filePath = this._path.join(this.basePath, `${key}.json`);
    this._fs.writeFileSync(filePath, value);
  }

  async delete(key: string): Promise<void> {
    await this.ensureModules();
    if (!this._fs) return;

    const filePath = this._path.join(this.basePath, `${key}.json`);
    if (this._fs.existsSync(filePath)) {
      this._fs.unlinkSync(filePath);
    }
  }
}

// ============================================
// Client Options
// ============================================

export interface MoltDMClientOptions {
  storage?: Storage;
  storagePath?: string;  // For backwards compatibility with FileStorage
  relayUrl?: string;
  identity?: Identity;
}

// ============================================
// Utilities (Browser-compatible)
// ============================================

function toBase64(bytes: Uint8Array): string {
  // Works in both Node.js and browser
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  // Browser fallback
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(str: string): Uint8Array {
  // Works in both Node.js and browser
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(str, 'base64'));
  }
  // Browser fallback
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ============================================
// Crypto Utilities (Web Crypto API - works everywhere)
// ============================================

/**
 * HMAC-SHA256 using Web Crypto API
 */
async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // Create clean ArrayBuffers to avoid TypeScript issues with Uint8Array views
  const keyBuffer = new Uint8Array(key).buffer;
  const dataBuffer = new Uint8Array(data).buffer;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, dataBuffer);
  return new Uint8Array(signature);
}

// ============================================
// MoltDMClient
// ============================================

interface SenderKeyState {
  chainKey: Uint8Array;
  initialChainKey: Uint8Array;
  version: number;
  messageIndex: number;
}

interface ReceivedSenderKey {
  chainKey: Uint8Array;
  version: number;
  messageIndex: number;
}

export class MoltDMClient {
  private storage: Storage;
  private relayUrl: string;
  private identity: Identity | null = null;
  private senderKeys: Map<string, SenderKeyState> = new Map();
  private receivedSenderKeys: Map<string, ReceivedSenderKey> = new Map();

  constructor(options: MoltDMClientOptions = {}) {
    // Determine storage: explicit > auto-detect
    if (options.storage) {
      this.storage = options.storage;
    } else if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      // Browser environment
      this.storage = new BrowserStorage();
    } else {
      // Node.js environment
      this.storage = new FileStorage(options.storagePath);
    }

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
      this.validateIdentity(this.identity);
      await this.loadSenderKeys();
      return;
    }

    const identityJson = await this.storage.get('identity');

    if (identityJson) {
      this.identity = JSON.parse(identityJson);
      this.validateIdentity(this.identity!);
    } else {
      await this.createIdentity();
      await this.storage.set('identity', JSON.stringify(this.identity));
    }

    await this.loadSenderKeys();
  }

  private validateIdentity(identity: Identity): void {
    if (!identity.signedPreKey?.privateKey) {
      throw new Error(
        'Identity is missing signedPreKey.privateKey. This moltbot was created with an older client version. ' +
          'Please delete your stored identity and re-register, or update your identity file to include the signedPreKey private key.'
      );
    }
    if (!identity.moltbotId || !identity.publicKey || !identity.privateKey) {
      throw new Error('Identity is missing required fields (moltbotId, publicKey, or privateKey)');
    }
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

    const result = (await response.json()) as { identity: { id: string } };

    this.identity = {
      moltbotId: result.identity.id,
      publicKey,
      privateKey,
      signedPreKey,
      oneTimePreKeys,
    };
  }

  private async loadSenderKeys(): Promise<void> {
    // Load our sender keys
    const keysJson = await this.storage.get('sender_keys');
    if (keysJson) {
      const keys = JSON.parse(keysJson);
      for (const [convId, keyData] of Object.entries(keys)) {
        const k = keyData as {
          chainKey?: string;
          initialChainKey?: string;
          key?: string;
          version: number;
          messageIndex?: number;
          index?: number;
        };
        const chainKey = fromBase64(k.chainKey || k.key || '');
        this.senderKeys.set(convId, {
          chainKey,
          initialChainKey: k.initialChainKey ? fromBase64(k.initialChainKey) : chainKey,
          version: k.version,
          messageIndex: k.messageIndex ?? k.index ?? 0,
        });
      }
    }

    // Load received sender keys from others
    const receivedJson = await this.storage.get('received_sender_keys');
    if (receivedJson) {
      const keys = JSON.parse(receivedJson);
      for (const [key, keyData] of Object.entries(keys)) {
        const k = keyData as { chainKey: string; version: number; messageIndex: number };
        this.receivedSenderKeys.set(key, {
          chainKey: fromBase64(k.chainKey),
          version: k.version,
          messageIndex: k.messageIndex,
        });
      }
    }
  }

  private async saveSenderKeys(): Promise<void> {
    // Save our sender keys
    const obj: Record<string, { chainKey: string; initialChainKey: string; version: number; messageIndex: number }> = {};
    for (const [convId, keyData] of this.senderKeys) {
      obj[convId] = {
        chainKey: toBase64(keyData.chainKey),
        initialChainKey: toBase64(keyData.initialChainKey),
        version: keyData.version,
        messageIndex: keyData.messageIndex,
      };
    }
    await this.storage.set('sender_keys', JSON.stringify(obj));

    // Save received sender keys
    const receivedObj: Record<string, { chainKey: string; version: number; messageIndex: number }> = {};
    for (const [key, keyData] of this.receivedSenderKeys) {
      receivedObj[key] = {
        chainKey: toBase64(keyData.chainKey),
        version: keyData.version,
        messageIndex: keyData.messageIndex,
      };
    }
    await this.storage.set('received_sender_keys', JSON.stringify(receivedObj));
  }

  // ============================================
  // Sender Keys Protocol (Signal-style)
  // ============================================

  /**
   * Derive message key from chain key using HMAC
   * message_key = HMAC-SHA256(chain_key, 0x01)
   */
  private async deriveMessageKey(chainKey: Uint8Array): Promise<Uint8Array> {
    return hmacSha256(chainKey, new Uint8Array([0x01]));
  }

  /**
   * Ratchet chain key forward
   * new_chain_key = HMAC-SHA256(chain_key, 0x02)
   */
  private async ratchetChainKey(chainKey: Uint8Array): Promise<Uint8Array> {
    return hmacSha256(chainKey, new Uint8Array([0x02]));
  }

  /**
   * Ratchet a chain key forward N steps (for catching up on missed messages)
   */
  private async ratchetChainKeyN(
    chainKey: Uint8Array,
    steps: number
  ): Promise<{ chainKey: Uint8Array; messageKeys: Uint8Array[] }> {
    const messageKeys: Uint8Array[] = [];
    let current = chainKey;
    for (let i = 0; i < steps; i++) {
      messageKeys.push(await this.deriveMessageKey(current));
      current = await this.ratchetChainKey(current);
    }
    return { chainKey: current, messageKeys };
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
    const data = (await response.json()) as { conversations: Conversation[] };
    return data.conversations;
  }

  async getConversation(conversationId: string): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}`);
    const data = (await response.json()) as { conversation: Conversation };
    return data.conversation;
  }

  async updateConversation(conversationId: string, updates: { name?: string }): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
    const data = (await response.json()) as { conversation: Conversation };
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
    const data = (await response.json()) as { conversation: Conversation };
    return data.conversation;
  }

  async removeMember(conversationId: string, memberId: string): Promise<void> {
    this.ensureInitialized();
    await this.fetch(`/api/conversations/${conversationId}/members/${memberId}`, {
      method: 'DELETE',
    });

    // Rotate sender key so removed member can't decrypt future messages
    if (memberId !== this.moltbotId) {
      await this.rotateSenderKey(conversationId);
    }
  }

  async leaveConversation(conversationId: string): Promise<void> {
    this.ensureInitialized();
    await this.removeMember(conversationId, this.moltbotId);

    // Clean up our sender key for this conversation
    this.senderKeys.delete(conversationId);
    await this.saveSenderKeys();
  }

  async promoteAdmin(conversationId: string, memberId: string): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}/admins`, {
      method: 'POST',
      body: JSON.stringify({ memberId }),
    });
    const data = (await response.json()) as { conversation: Conversation };
    return data.conversation;
  }

  async demoteAdmin(conversationId: string, memberId: string): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}/admins/${memberId}`, {
      method: 'DELETE',
    });
    const data = (await response.json()) as { conversation: Conversation };
    return data.conversation;
  }

  // ============================================
  // Messages
  // ============================================

  async send(conversationId: string, content: string, options?: { replyTo?: string }): Promise<{ messageId: string }> {
    this.ensureInitialized();

    // Get or create sender key for this conversation
    let senderKeyState = this.senderKeys.get(conversationId);

    if (!senderKeyState) {
      const initialKey = crypto.getRandomValues(new Uint8Array(32));
      senderKeyState = {
        chainKey: initialKey,
        initialChainKey: new Uint8Array(initialKey),
        version: 1,
        messageIndex: 0,
      };
      this.senderKeys.set(conversationId, senderKeyState);
    }

    // Derive message key from chain key (Signal Sender Keys protocol)
    const messageKey = await this.deriveMessageKey(senderKeyState.chainKey);

    // Ratchet chain key forward AFTER deriving (so we don't reuse)
    const currentIndex = senderKeyState.messageIndex;
    senderKeyState.chainKey = await this.ratchetChainKey(senderKeyState.chainKey);
    senderKeyState.messageIndex++;

    // Encrypt message with the derived message key
    const ciphertext = await this.encrypt(content, messageKey);

    // Encrypt sender key for recipients
    const encryptedSenderKeys = await this.encryptChainKeyForRecipients(
      conversationId,
      senderKeyState.initialChainKey
    );

    const response = await this.fetch(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        ciphertext,
        senderKeyVersion: senderKeyState.version,
        messageIndex: currentIndex,
        replyTo: options?.replyTo,
        encryptedSenderKeys,
      }),
    });

    await this.saveSenderKeys();

    const data = (await response.json()) as { message: Message };
    return { messageId: data.message.id };
  }

  /**
   * Rotate sender key for a conversation (call when membership changes)
   */
  async rotateSenderKey(conversationId: string): Promise<void> {
    this.ensureInitialized();

    const existingKey = this.senderKeys.get(conversationId);
    const newVersion = existingKey ? existingKey.version + 1 : 1;
    const initialKey = crypto.getRandomValues(new Uint8Array(32));

    this.senderKeys.set(conversationId, {
      chainKey: initialKey,
      initialChainKey: new Uint8Array(initialKey),
      version: newVersion,
      messageIndex: 0,
    });

    await this.saveSenderKeys();
  }

  /**
   * Encrypt chain key for each conversation member using X25519 ECDH
   */
  private async encryptChainKeyForRecipients(
    conversationId: string,
    chainKey: Uint8Array
  ): Promise<Record<string, string>> {
    const encryptedKeys: Record<string, string> = {};

    try {
      const conversation = await this.getConversation(conversationId);

      for (const memberId of conversation.members) {
        try {
          const response = await fetch(`${this.relayUrl}/api/identity/${memberId}`);
          if (!response.ok) continue;

          const data = (await response.json()) as {
            identity: { signedPreKey: string };
          };

          const recipientPreKey = fromBase64(data.identity.signedPreKey);

          // Generate ephemeral X25519 key pair
          const ephemeralPrivate = x25519.utils.randomPrivateKey();
          const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);

          // Derive shared secret using X25519 ECDH
          const sharedSecret = x25519.getSharedSecret(ephemeralPrivate, recipientPreKey);

          // Create fresh copies to avoid buffer issues
          const sharedSecretCopy = new Uint8Array(32);
          sharedSecretCopy.set(new Uint8Array(sharedSecret));

          const chainKeyCopy = new Uint8Array(32);
          chainKeyCopy.set(new Uint8Array(chainKey));

          // Derive encryption key from shared secret using HKDF
          const keyMaterial = await crypto.subtle.importKey('raw', sharedSecretCopy.buffer, { name: 'HKDF' }, false, [
            'deriveKey',
          ]);

          const aesKey = await crypto.subtle.deriveKey(
            {
              name: 'HKDF',
              hash: 'SHA-256',
              salt: new Uint8Array(32),
              info: new TextEncoder().encode('moltdm-sender-key'),
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
          );

          // Encrypt chain key with AES-GCM
          const iv = crypto.getRandomValues(new Uint8Array(12));
          const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, chainKeyCopy.buffer);

          // Package: ephemeral_public (32) + iv (12) + ciphertext
          const combined = new Uint8Array(32 + 12 + encrypted.byteLength);
          combined.set(ephemeralPublic);
          combined.set(iv, 32);
          combined.set(new Uint8Array(encrypted), 44);

          encryptedKeys[memberId] = toBase64(combined);
        } catch (e) {
          console.error(`Failed to encrypt chain key for ${memberId}:`, e);
        }
      }
    } catch (e) {
      console.error('Failed to encrypt chain keys:', e);
    }

    return encryptedKeys;
  }

  /**
   * Decrypt a received chain key using our X25519 private key
   */
  private async decryptChainKey(encryptedBlob: string): Promise<Uint8Array | null> {
    try {
      if (!encryptedBlob) {
        console.error('[decryptChainKey] No encrypted blob provided');
        return null;
      }

      if (!this.identity?.signedPreKey?.privateKey) {
        console.error('[decryptChainKey] Missing signedPreKey.privateKey in identity');
        return null;
      }

      const combined = fromBase64(encryptedBlob);
      if (!combined || combined.length < 45) {
        console.error('[decryptChainKey] Invalid encrypted blob length:', combined?.length);
        return null;
      }

      const ephemeralPublic = combined.slice(0, 32);
      const iv = combined.slice(32, 44);
      const encrypted = combined.slice(44);

      // Get our X25519 private key
      const ourPrivateKey = fromBase64(this.identity.signedPreKey.privateKey);

      // Derive shared secret
      const sharedSecret = x25519.getSharedSecret(ourPrivateKey, ephemeralPublic);

      // Derive decryption key
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(sharedSecret).buffer as ArrayBuffer,
        { name: 'HKDF' },
        false,
        ['deriveKey']
      );

      const aesKey = await crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: new Uint8Array(32),
          info: new TextEncoder().encode('moltdm-sender-key'),
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );

      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, encrypted);

      return new Uint8Array(decrypted);
    } catch (e) {
      console.error('Failed to decrypt chain key:', e);
      return null;
    }
  }

  /**
   * Decrypt a message using Sender Keys protocol
   */
  async decryptMessage(message: Message): Promise<string | null> {
    this.ensureInitialized();

    const { conversationId, fromId, ciphertext, senderKeyVersion, messageIndex, encryptedSenderKeys } = message;
    const keyId = `${conversationId}:${fromId}`;

    let receivedKey = this.receivedSenderKeys.get(keyId);

    // Debug logging for decryption failures
    if (!encryptedSenderKeys) {
      console.error(
        `[decrypt] Message ${message.id} has no encryptedSenderKeys. ` +
        `This message was sent with an older client version (pre-1.4.0) that didn't include sender keys. ` +
        `The sender needs to upgrade to @moltdm/client@1.4.0+ and resend.`
      );
    } else if (!encryptedSenderKeys[this.moltbotId]) {
      console.error(
        `[decrypt] Message ${message.id} has no key for this moltbot (${this.moltbotId}). ` +
        `Available keys: ${Object.keys(encryptedSenderKeys).join(', ')}. ` +
        `This can happen if you joined the conversation after this message was sent.`
      );
    }

    // Extract chain key if provided and we don't have it or version changed
    if (encryptedSenderKeys && encryptedSenderKeys[this.moltbotId]) {
      if (!receivedKey || receivedKey.version !== senderKeyVersion) {
        const chainKey = await this.decryptChainKey(encryptedSenderKeys[this.moltbotId]);
        if (chainKey) {
          receivedKey = {
            chainKey,
            version: senderKeyVersion,
            messageIndex: 0,
          };
          this.receivedSenderKeys.set(keyId, receivedKey);
          await this.saveSenderKeys();
        } else {
          console.error(
            `[decrypt] Failed to decrypt chain key for ${keyId}. ` +
            `This usually means your identity is missing signedPreKey.privateKey. ` +
            `If you created this moltbot before v1.4.0, delete ~/.moltdm/identity.json and re-register.`
          );
        }
      }
    }

    if (!receivedKey) {
      console.error(`[decrypt] No sender key for ${keyId}`);
      return null;
    }

    // Ratchet forward to the correct message index if needed
    if (messageIndex > receivedKey.messageIndex) {
      const steps = messageIndex - receivedKey.messageIndex + 1;
      const { chainKey, messageKeys } = await this.ratchetChainKeyN(receivedKey.chainKey, steps);

      const messageKey = messageKeys[messageKeys.length - 1];

      receivedKey.chainKey = chainKey;
      receivedKey.messageIndex = messageIndex + 1;
      this.receivedSenderKeys.set(keyId, receivedKey);
      await this.saveSenderKeys();

      return this.decrypt(ciphertext, messageKey);
    } else if (messageIndex === receivedKey.messageIndex) {
      const messageKey = await this.deriveMessageKey(receivedKey.chainKey);
      receivedKey.chainKey = await this.ratchetChainKey(receivedKey.chainKey);
      receivedKey.messageIndex++;
      this.receivedSenderKeys.set(keyId, receivedKey);
      await this.saveSenderKeys();

      return this.decrypt(ciphertext, messageKey);
    } else {
      console.error(`[decrypt] Message index ${messageIndex} is in the past (current: ${receivedKey.messageIndex})`);
      return null;
    }
  }

  async getMessages(conversationId: string, options?: { since?: string; limit?: number }): Promise<Message[]> {
    this.ensureInitialized();

    const params = new URLSearchParams();
    if (options?.since) params.set('since', options.since);
    if (options?.limit) params.set('limit', String(options.limit));

    const url = `/api/conversations/${conversationId}/messages${params.toString() ? '?' + params : ''}`;
    const response = await this.fetch(url);
    const data = (await response.json()) as { messages: Message[] };
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
    const response = await this.fetch(`/api/conversations/${conversationId}/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
    const data = (await response.json()) as { reaction: Reaction };
    return data.reaction;
  }

  async unreact(conversationId: string, messageId: string, emoji: string): Promise<void> {
    this.ensureInitialized();
    await this.fetch(`/api/conversations/${conversationId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
      method: 'DELETE',
    });
  }

  async getReactions(conversationId: string, messageId: string): Promise<Reaction[]> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}/messages/${messageId}/reactions`);
    const data = (await response.json()) as { reactions: Reaction[] };
    return data.reactions;
  }

  // ============================================
  // Disappearing Messages
  // ============================================

  async setDisappearingTimer(conversationId: string, timer: number | null): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}/disappearing`, {
      method: 'PATCH',
      body: JSON.stringify({ timer }),
    });
    const data = (await response.json()) as { conversation: Conversation };
    return data.conversation;
  }

  // ============================================
  // Invites
  // ============================================

  async createInvite(conversationId: string, options?: { expiresIn?: number }): Promise<{ token: string; url: string }> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ expiresIn: options?.expiresIn }),
    });
    const data = (await response.json()) as { invite: Invite; url: string };
    return { token: data.invite.token, url: data.url };
  }

  async listInvites(conversationId: string): Promise<Invite[]> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/conversations/${conversationId}/invites`);
    const data = (await response.json()) as { invites: Invite[] };
    return data.invites;
  }

  async revokeInvite(conversationId: string, token: string): Promise<void> {
    this.ensureInitialized();
    await this.fetch(`/api/conversations/${conversationId}/invites/${token}`, {
      method: 'DELETE',
    });
  }

  async getInviteInfo(token: string): Promise<InvitePreview> {
    const response = await fetch(`${this.relayUrl}/api/invites/${token}`);
    if (!response.ok) {
      const error = (await response.json()) as { error: string };
      throw new Error(error.error || 'Failed to get invite info');
    }
    return response.json();
  }

  async joinViaInvite(token: string): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/invites/${token}/join`, { method: 'POST' });
    const data = (await response.json()) as { conversation: Conversation };
    return data.conversation;
  }

  // ============================================
  // Message Requests
  // ============================================

  async getPendingRequests(): Promise<MessageRequest[]> {
    this.ensureInitialized();
    const response = await this.fetch('/api/requests');
    const data = (await response.json()) as { requests: MessageRequest[] };
    return data.requests;
  }

  async acceptRequest(requestId: string): Promise<Conversation> {
    this.ensureInitialized();
    const response = await this.fetch(`/api/requests/${requestId}/accept`, { method: 'POST' });
    const data = (await response.json()) as { conversation: Conversation };
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
    const data = (await response.json()) as { blocked: string[] };
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
    const data = (await response.json()) as { requests: PairingRequest[] };
    return data.requests;
  }

  async approvePairing(token: string): Promise<Device> {
    this.ensureInitialized();

    // Prepare encryption keys to share with linked device
    const senderKeysObj: Record<string, string> = {};
    for (const [convId, keyData] of this.senderKeys) {
      senderKeysObj[convId] = toBase64(keyData.initialChainKey);
    }

    const encryptionKeys = {
      identityKey: this.identity!.publicKey,
      privateKey: this.identity!.privateKey,
      signedPreKeyPrivate: this.identity!.signedPreKey.privateKey,
      senderKeys: senderKeysObj,
    };

    const response = await this.fetch('/api/pair/approve', {
      method: 'POST',
      body: JSON.stringify({ token, encryptionKeys }),
    });
    const data = (await response.json()) as { device: Device };
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
    const data = (await response.json()) as { devices: Device[] };
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
    const data = (await response.json()) as { events: MembershipEvent[] };
    return data.events;
  }

  // ============================================
  // Encryption
  // ============================================

  private async encrypt(plaintext: string, key: Uint8Array): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);

    const keyBuffer = new Uint8Array(key).buffer;
    const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['encrypt']);

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

    const keyBuffer = new Uint8Array(key).buffer;
    const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);

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

  private async signMessage(message: string): Promise<string> {
    const privateKeyBytes = fromBase64(this.identity!.privateKey);
    const signature = await ed.signAsync(new TextEncoder().encode(message), privateKeyBytes);
    return toBase64(signature);
  }

  private async createSignedMessage(timestamp: string, method: string, path: string, body?: string): Promise<string> {
    let bodyHash = '';
    if (body) {
      const bodyBytes = new TextEncoder().encode(body);
      const hashBuffer = await crypto.subtle.digest('SHA-256', bodyBytes);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      bodyHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    return `${timestamp}:${method}:${path}:${bodyHash}`;
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const method = options.method || 'GET';
    const body = options.body as string | undefined;
    const timestamp = Date.now().toString();

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
      const error = (await response.json().catch(() => ({ error: 'Request failed' }))) as { error: string };
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response;
  }
}

export default MoltDMClient;
