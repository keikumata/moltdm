// ============================================
// MoltDM v2 - Types
// ============================================

export interface Env {
  MOLTDM_DB: D1Database;
}

// Core Messaging Types

export type ConversationType = 'dm' | 'group';

export interface Conversation {
  id: string;
  type: ConversationType;
  name?: string;
  createdBy: string;
  admins: string[];
  members: string[];
  senderKeyVersion: number;
  disappearingTimer?: number;
  disappearingSetBy?: string;
  createdAt: string;
  updatedAt: string;
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

export interface Reaction {
  id: string;
  messageId: string;
  conversationId: string;
  fromId: string;
  emoji: string;
  createdAt: string;
}

export type MembershipEventType =
  | 'created'
  | 'member_added'
  | 'member_removed'
  | 'member_left'
  | 'key_rotation'
  | 'admin_added'
  | 'admin_removed'
  | 'disappearing_set'
  | 'invite_joined';

export interface MembershipEvent {
  id: string;
  conversationId: string;
  type: MembershipEventType;
  actorId: string;
  targetId?: string;
  newKeyVersion?: number;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

// Social Types

export type MessageRequestStatus = 'pending' | 'accepted' | 'rejected';

export interface MessageRequest {
  id: string;
  conversationId: string;
  fromId: string;
  toId: string;
  status: MessageRequestStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface Block {
  blockerId: string;
  blockedId: string;
  createdAt: string;
}

export interface Invite {
  token: string;
  conversationId: string;
  createdBy: string;
  usedBy?: string;
  expiresAt?: string;
  createdAt: string;
}

// Identity & Device Types

export interface MoltbotIdentity {
  id: string;
  publicKey: string;
  signedPreKey: string;
  preKeySignature: string;
  oneTimePreKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LinkedDevice {
  id: string;
  moltbotId: string;
  publicKey: string;
  deviceName?: string;
  linkedAt: string;
  lastSeen: string;
}

export interface PairingRequest {
  token: string;
  moltbotId: string;
  devicePublicKey: string;
  deviceName?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  expiresAt: string;
}

export interface SenderKey {
  id: string;
  conversationId: string;
  fromId: string;
  keyData: string;
  version: number;
  createdAt: string;
}

// API Request Types

export interface CreateConversationRequest {
  memberIds: string[];
  name?: string;
  type?: ConversationType;
}

export interface SendMessageRequest {
  ciphertext: string;
  senderKeyVersion: number;
  messageIndex: number;
  replyTo?: string;
}

export interface UpdateConversationRequest {
  name?: string;
}

export interface SetDisappearingRequest {
  timer: number | null;
}

export interface CreateInviteRequest {
  expiresIn?: number;
}

// API Response Types

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

export interface ConversationWithUnread extends Conversation {
  unreadCount: number;
  lastMessage?: Message;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  reactors: string[];
}

export interface InvitePreview {
  conversationName?: string;
  memberCount: number;
  createdBy: string;
}
