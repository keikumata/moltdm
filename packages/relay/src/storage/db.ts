/**
 * D1 Database Storage for MoltDM
 *
 * Replaces R2-based storage with proper SQL queries for scalability.
 * All message queries now use indexed SQL instead of listing/filtering objects.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  Conversation,
  Message,
  Reaction,
  MembershipEvent,
  MembershipEventType,
  MessageRequest,
  Block,
  Invite,
  MoltbotIdentity,
  LinkedDevice,
  PairingRequest,
  ReactionSummary,
} from '../types';

// ULID-like ID generator (time-sortable)
function generateUlid(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}${random}`;
}

export class DatabaseStorage {
  constructor(private db: D1Database) {}

  // ============================================
  // Identity Operations
  // ============================================

  async getIdentity(moltbotId: string): Promise<MoltbotIdentity | null> {
    const result = await this.db
      .prepare('SELECT * FROM identities WHERE id = ?')
      .bind(moltbotId)
      .first();

    if (!result) return null;

    return {
      id: result.id as string,
      publicKey: result.public_key as string,
      signedPreKey: result.signed_pre_key as string,
      preKeySignature: result.pre_key_signature as string,
      oneTimePreKeys: JSON.parse(result.one_time_pre_keys as string),
      createdAt: result.created_at as string,
      updatedAt: result.updated_at as string,
    };
  }

  async createIdentity(
    publicKey: string,
    signedPreKey: string,
    preKeySignature: string,
    oneTimePreKeys: string[] = []
  ): Promise<MoltbotIdentity> {
    const id = `moltbot_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO identities (id, public_key, signed_pre_key, pre_key_signature, one_time_pre_keys, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, publicKey, signedPreKey, preKeySignature, JSON.stringify(oneTimePreKeys), now, now)
      .run();

    return {
      id,
      publicKey,
      signedPreKey,
      preKeySignature,
      oneTimePreKeys,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateIdentityPreKeys(moltbotId: string, oneTimePreKeys: string[]): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare('UPDATE identities SET one_time_pre_keys = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(oneTimePreKeys), now, moltbotId)
      .run();
  }

  async consumeOneTimePreKey(moltbotId: string): Promise<string | null> {
    const identity = await this.getIdentity(moltbotId);
    if (!identity || identity.oneTimePreKeys.length === 0) return null;

    const preKey = identity.oneTimePreKeys.shift()!;
    await this.updateIdentityPreKeys(moltbotId, identity.oneTimePreKeys);
    return preKey;
  }

  // ============================================
  // Conversation Operations
  // ============================================

  async getConversation(convId: string): Promise<Conversation | null> {
    const conv = await this.db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .bind(convId)
      .first();

    if (!conv) return null;

    // Get members and admins
    const members = await this.db
      .prepare('SELECT moltbot_id, is_admin FROM conversation_members WHERE conversation_id = ?')
      .bind(convId)
      .all();

    const memberIds = members.results.map((m) => m.moltbot_id as string);
    const adminIds = members.results.filter((m) => m.is_admin).map((m) => m.moltbot_id as string);

    return {
      id: conv.id as string,
      type: conv.type as 'dm' | 'group',
      name: conv.name as string | undefined,
      createdBy: conv.created_by as string,
      admins: adminIds,
      members: memberIds,
      senderKeyVersion: conv.sender_key_version as number,
      disappearingTimer: conv.disappearing_timer as number | undefined,
      disappearingSetBy: conv.disappearing_set_by as string | undefined,
      createdAt: conv.created_at as string,
      updatedAt: conv.updated_at as string,
    };
  }

  async createConversation(
    createdBy: string,
    memberIds: string[],
    type: 'dm' | 'group',
    name?: string
  ): Promise<Conversation> {
    const id = `conv_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    const now = new Date().toISOString();
    const allMembers = [...new Set([createdBy, ...memberIds])];

    // Insert conversation
    await this.db
      .prepare(
        `INSERT INTO conversations (id, type, name, created_by, sender_key_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`
      )
      .bind(id, type, name || null, createdBy, now, now)
      .run();

    // Insert members (creator is always admin)
    const memberInserts = allMembers.map((memberId) =>
      this.db
        .prepare(
          `INSERT INTO conversation_members (conversation_id, moltbot_id, is_admin, joined_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(id, memberId, memberId === createdBy ? 1 : 0, now)
    );
    await this.db.batch(memberInserts);

    // Create membership event
    await this.createMembershipEvent(id, 'created', createdBy, undefined, { members: allMembers });

    return {
      id,
      type,
      name,
      createdBy,
      admins: [createdBy],
      members: allMembers,
      senderKeyVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateConversation(convId: string, updates: Partial<Conversation>): Promise<void> {
    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const values: (string | number | null)[] = [now];

    if (updates.name !== undefined) {
      sets.push('name = ?');
      values.push(updates.name || null);
    }
    if (updates.senderKeyVersion !== undefined) {
      sets.push('sender_key_version = ?');
      values.push(updates.senderKeyVersion);
    }
    if (updates.disappearingTimer !== undefined) {
      sets.push('disappearing_timer = ?');
      values.push(updates.disappearingTimer || null);
    }
    if (updates.disappearingSetBy !== undefined) {
      sets.push('disappearing_set_by = ?');
      values.push(updates.disappearingSetBy || null);
    }

    values.push(convId);

    await this.db
      .prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  }

  async deleteConversation(convId: string): Promise<void> {
    // CASCADE will handle members, messages, reactions, events, invites
    await this.db.prepare('DELETE FROM conversations WHERE id = ?').bind(convId).run();
  }

  async listConversations(moltbotId: string): Promise<Conversation[]> {
    const convIds = await this.db
      .prepare(
        `SELECT conversation_id FROM conversation_members
         WHERE moltbot_id = ?`
      )
      .bind(moltbotId)
      .all();

    if (convIds.results.length === 0) return [];

    const conversations: Conversation[] = [];
    for (const row of convIds.results) {
      const conv = await this.getConversation(row.conversation_id as string);
      if (conv) conversations.push(conv);
    }

    // Sort by updatedAt descending
    return conversations.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  async addMember(convId: string, memberId: string, actorId: string): Promise<void> {
    const now = new Date().toISOString();

    // Check if already a member
    const existing = await this.db
      .prepare(
        'SELECT 1 FROM conversation_members WHERE conversation_id = ? AND moltbot_id = ?'
      )
      .bind(convId, memberId)
      .first();

    if (existing) return;

    // Add member
    await this.db
      .prepare(
        `INSERT INTO conversation_members (conversation_id, moltbot_id, is_admin, joined_at)
         VALUES (?, ?, 0, ?)`
      )
      .bind(convId, memberId, now)
      .run();

    // Increment sender key version
    await this.db
      .prepare(
        'UPDATE conversations SET sender_key_version = sender_key_version + 1, updated_at = ? WHERE id = ?'
      )
      .bind(now, convId)
      .run();

    const conv = await this.getConversation(convId);
    await this.createMembershipEvent(convId, 'member_added', actorId, memberId, {
      newKeyVersion: conv?.senderKeyVersion,
    });
  }

  async removeMember(convId: string, memberId: string, actorId: string): Promise<void> {
    const now = new Date().toISOString();
    const isLeaving = memberId === actorId;

    // Remove member
    await this.db
      .prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND moltbot_id = ?')
      .bind(convId, memberId)
      .run();

    // Increment sender key version
    await this.db
      .prepare(
        'UPDATE conversations SET sender_key_version = sender_key_version + 1, updated_at = ? WHERE id = ?'
      )
      .bind(now, convId)
      .run();

    // Clear read state
    await this.db
      .prepare('DELETE FROM read_state WHERE moltbot_id = ? AND conversation_id = ?')
      .bind(memberId, convId)
      .run();

    const conv = await this.getConversation(convId);
    await this.createMembershipEvent(
      convId,
      isLeaving ? 'member_left' : 'member_removed',
      actorId,
      memberId,
      { newKeyVersion: conv?.senderKeyVersion }
    );
  }

  async promoteAdmin(convId: string, memberId: string, actorId: string): Promise<void> {
    await this.db
      .prepare(
        'UPDATE conversation_members SET is_admin = 1 WHERE conversation_id = ? AND moltbot_id = ?'
      )
      .bind(convId, memberId)
      .run();

    await this.createMembershipEvent(convId, 'admin_added', actorId, memberId);
  }

  async demoteAdmin(convId: string, memberId: string, actorId: string): Promise<void> {
    await this.db
      .prepare(
        'UPDATE conversation_members SET is_admin = 0 WHERE conversation_id = ? AND moltbot_id = ?'
      )
      .bind(convId, memberId)
      .run();

    await this.createMembershipEvent(convId, 'admin_removed', actorId, memberId);
  }

  async setDisappearingTimer(
    convId: string,
    timer: number | null,
    actorId: string
  ): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `UPDATE conversations
         SET disappearing_timer = ?, disappearing_set_by = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(timer, timer ? actorId : null, now, convId)
      .run();

    await this.createMembershipEvent(convId, 'disappearing_set', actorId, undefined, { timer });
  }

  // ============================================
  // Message Operations
  // ============================================

  async getMessage(convId: string, messageId: string): Promise<Message | null> {
    const msg = await this.db
      .prepare('SELECT * FROM messages WHERE id = ? AND conversation_id = ?')
      .bind(messageId, convId)
      .first();

    if (!msg) return null;

    return this.rowToMessage(msg);
  }

  async createMessage(
    convId: string,
    fromId: string,
    ciphertext: string,
    senderKeyVersion: number,
    messageIndex: number,
    replyTo?: string
  ): Promise<Message> {
    const id = `msg_${generateUlid()}`;
    const now = new Date().toISOString();

    // Get conversation for disappearing timer
    const conv = await this.getConversation(convId);
    let expiresAt: string | null = null;
    if (conv?.disappearingTimer) {
      expiresAt = new Date(Date.now() + conv.disappearingTimer * 1000).toISOString();
    }

    await this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, from_id, ciphertext, sender_key_version, message_index, reply_to, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, convId, fromId, ciphertext, senderKeyVersion, messageIndex, replyTo || null, expiresAt, now)
      .run();

    // Update conversation timestamp
    await this.db
      .prepare('UPDATE conversations SET updated_at = ? WHERE id = ?')
      .bind(now, convId)
      .run();

    return {
      id,
      conversationId: convId,
      fromId,
      ciphertext,
      senderKeyVersion,
      messageIndex,
      replyTo,
      expiresAt: expiresAt || undefined,
      createdAt: now,
    };
  }

  async deleteMessage(convId: string, messageId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM messages WHERE id = ? AND conversation_id = ?')
      .bind(messageId, convId)
      .run();
  }

  async listMessages(
    convId: string,
    options: { since?: string; limit?: number; before?: string } = {}
  ): Promise<Message[]> {
    const { since, limit = 50, before } = options;
    const now = new Date().toISOString();

    let query = `
      SELECT * FROM messages
      WHERE conversation_id = ?
        AND (expires_at IS NULL OR expires_at > ?)
    `;
    const params: (string | number)[] = [convId, now];

    if (since) {
      query += ' AND created_at > ?';
      params.push(since);
    }
    if (before) {
      query += ' AND created_at < ?';
      params.push(before);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const results = await this.db
      .prepare(query)
      .bind(...params)
      .all();

    // Return in ascending order (oldest first)
    return results.results.map((row) => this.rowToMessage(row)).reverse();
  }

  async deleteExpiredMessages(): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.db
      .prepare('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?')
      .bind(now)
      .run();

    return result.meta.changes || 0;
  }

  private rowToMessage(row: Record<string, unknown>): Message {
    return {
      id: row.id as string,
      conversationId: row.conversation_id as string,
      fromId: row.from_id as string,
      ciphertext: row.ciphertext as string,
      senderKeyVersion: row.sender_key_version as number,
      messageIndex: row.message_index as number,
      replyTo: row.reply_to as string | undefined,
      expiresAt: row.expires_at as string | undefined,
      createdAt: row.created_at as string,
    };
  }

  // ============================================
  // Reaction Operations
  // ============================================

  async createReaction(
    convId: string,
    messageId: string,
    fromId: string,
    emoji: string
  ): Promise<Reaction> {
    const id = `react_${generateUlid()}`;
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT OR REPLACE INTO reactions (id, message_id, conversation_id, from_id, emoji, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(id, messageId, convId, fromId, emoji, now)
      .run();

    return {
      id,
      messageId,
      conversationId: convId,
      fromId,
      emoji,
      createdAt: now,
    };
  }

  async deleteReaction(convId: string, messageId: string, emoji: string, fromId: string): Promise<void> {
    await this.db
      .prepare(
        'DELETE FROM reactions WHERE message_id = ? AND from_id = ? AND emoji = ?'
      )
      .bind(messageId, fromId, emoji)
      .run();
  }

  async getMessageReactions(messageId: string): Promise<ReactionSummary[]> {
    const results = await this.db
      .prepare(
        `SELECT emoji, COUNT(*) as count, GROUP_CONCAT(from_id) as reactors
         FROM reactions WHERE message_id = ?
         GROUP BY emoji`
      )
      .bind(messageId)
      .all();

    return results.results.map((row) => ({
      emoji: row.emoji as string,
      count: row.count as number,
      reactors: (row.reactors as string).split(','),
    }));
  }

  // ============================================
  // Membership Event Operations
  // ============================================

  async createMembershipEvent(
    convId: string,
    type: MembershipEventType,
    actorId: string,
    targetId?: string,
    metadata?: Record<string, unknown>
  ): Promise<MembershipEvent> {
    const id = `evt_${generateUlid()}`;
    const now = new Date().toISOString();
    const newKeyVersion = metadata?.newKeyVersion as number | undefined;

    await this.db
      .prepare(
        `INSERT INTO membership_events (id, conversation_id, type, actor_id, target_id, new_key_version, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        convId,
        type,
        actorId,
        targetId || null,
        newKeyVersion || null,
        metadata ? JSON.stringify(metadata) : null,
        now
      )
      .run();

    return {
      id,
      conversationId: convId,
      type,
      actorId,
      targetId,
      newKeyVersion,
      metadata,
      timestamp: now,
    };
  }

  async listEvents(convId: string, since?: string): Promise<MembershipEvent[]> {
    let query = 'SELECT * FROM membership_events WHERE conversation_id = ?';
    const params: string[] = [convId];

    if (since) {
      query += ' AND timestamp > ?';
      params.push(since);
    }

    query += ' ORDER BY timestamp ASC';

    const results = await this.db
      .prepare(query)
      .bind(...params)
      .all();

    return results.results.map((row) => ({
      id: row.id as string,
      conversationId: row.conversation_id as string,
      type: row.type as MembershipEventType,
      actorId: row.actor_id as string,
      targetId: row.target_id as string | undefined,
      newKeyVersion: row.new_key_version as number | undefined,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
      timestamp: row.timestamp as string,
    }));
  }

  // ============================================
  // Message Request Operations
  // ============================================

  async getMessageRequest(requestId: string): Promise<MessageRequest | null> {
    const req = await this.db
      .prepare('SELECT * FROM message_requests WHERE id = ?')
      .bind(requestId)
      .first();

    if (!req) return null;

    return {
      id: req.id as string,
      conversationId: req.conversation_id as string,
      fromId: req.from_id as string,
      toId: req.to_id as string,
      status: req.status as 'pending' | 'accepted' | 'rejected',
      createdAt: req.created_at as string,
      resolvedAt: req.resolved_at as string | undefined,
    };
  }

  async createMessageRequest(
    convId: string,
    fromId: string,
    toId: string
  ): Promise<MessageRequest> {
    const id = `req_${generateUlid()}`;
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT INTO message_requests (id, conversation_id, from_id, to_id, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`
      )
      .bind(id, convId, fromId, toId, now)
      .run();

    return {
      id,
      conversationId: convId,
      fromId,
      toId,
      status: 'pending',
      createdAt: now,
    };
  }

  async updateMessageRequest(
    requestId: string,
    status: 'accepted' | 'rejected'
  ): Promise<MessageRequest | null> {
    const now = new Date().toISOString();

    await this.db
      .prepare('UPDATE message_requests SET status = ?, resolved_at = ? WHERE id = ?')
      .bind(status, now, requestId)
      .run();

    return this.getMessageRequest(requestId);
  }

  async listPendingRequests(moltbotId: string): Promise<MessageRequest[]> {
    const results = await this.db
      .prepare(
        `SELECT * FROM message_requests
         WHERE to_id = ? AND status = 'pending'
         ORDER BY created_at DESC`
      )
      .bind(moltbotId)
      .all();

    return results.results.map((row) => ({
      id: row.id as string,
      conversationId: row.conversation_id as string,
      fromId: row.from_id as string,
      toId: row.to_id as string,
      status: row.status as 'pending' | 'accepted' | 'rejected',
      createdAt: row.created_at as string,
      resolvedAt: row.resolved_at as string | undefined,
    }));
  }

  // ============================================
  // Block Operations
  // ============================================

  async createBlock(blockerId: string, blockedId: string): Promise<Block> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at)
         VALUES (?, ?, ?)`
      )
      .bind(blockerId, blockedId, now)
      .run();

    return { blockerId, blockedId, createdAt: now };
  }

  async deleteBlock(blockerId: string, blockedId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
      .bind(blockerId, blockedId)
      .run();
  }

  async isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    const result = await this.db
      .prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?')
      .bind(blockerId, blockedId)
      .first();

    return !!result;
  }

  async listBlocked(blockerId: string): Promise<string[]> {
    const results = await this.db
      .prepare('SELECT blocked_id FROM blocks WHERE blocker_id = ?')
      .bind(blockerId)
      .all();

    return results.results.map((row) => row.blocked_id as string);
  }

  // ============================================
  // Contact Operations
  // ============================================

  async addContact(moltbotId: string, contactId: string): Promise<void> {
    const now = new Date().toISOString();

    await this.db
      .prepare(
        `INSERT OR IGNORE INTO contacts (moltbot_id, contact_id, created_at)
         VALUES (?, ?, ?)`
      )
      .bind(moltbotId, contactId, now)
      .run();
  }

  async isContact(moltbotId: string, contactId: string): Promise<boolean> {
    const result = await this.db
      .prepare('SELECT 1 FROM contacts WHERE moltbot_id = ? AND contact_id = ?')
      .bind(moltbotId, contactId)
      .first();

    return !!result;
  }

  async getContacts(moltbotId: string): Promise<string[]> {
    const results = await this.db
      .prepare('SELECT contact_id FROM contacts WHERE moltbot_id = ?')
      .bind(moltbotId)
      .all();

    return results.results.map((row) => row.contact_id as string);
  }

  // ============================================
  // Invite Operations
  // ============================================

  async getInvite(token: string): Promise<Invite | null> {
    const inv = await this.db
      .prepare('SELECT * FROM invites WHERE token = ?')
      .bind(token)
      .first();

    if (!inv) return null;

    return {
      token: inv.token as string,
      conversationId: inv.conversation_id as string,
      createdBy: inv.created_by as string,
      usedBy: inv.used_by as string | undefined,
      expiresAt: inv.expires_at as string | undefined,
      createdAt: inv.created_at as string,
    };
  }

  async createInvite(convId: string, createdBy: string, expiresIn?: number): Promise<Invite> {
    const token = `inv_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
    const now = new Date().toISOString();
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    await this.db
      .prepare(
        `INSERT INTO invites (token, conversation_id, created_by, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(token, convId, createdBy, expiresAt, now)
      .run();

    return {
      token,
      conversationId: convId,
      createdBy,
      expiresAt: expiresAt || undefined,
      createdAt: now,
    };
  }

  async useInvite(token: string, usedBy: string): Promise<Invite | null> {
    await this.db
      .prepare('UPDATE invites SET used_by = ? WHERE token = ?')
      .bind(usedBy, token)
      .run();

    return this.getInvite(token);
  }

  async deleteInvite(token: string): Promise<void> {
    await this.db.prepare('DELETE FROM invites WHERE token = ?').bind(token).run();
  }

  async listInvites(convId: string): Promise<Invite[]> {
    const now = new Date().toISOString();

    const results = await this.db
      .prepare(
        `SELECT * FROM invites
         WHERE conversation_id = ?
           AND used_by IS NULL
           AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY created_at DESC`
      )
      .bind(convId, now)
      .all();

    return results.results.map((row) => ({
      token: row.token as string,
      conversationId: row.conversation_id as string,
      createdBy: row.created_by as string,
      usedBy: row.used_by as string | undefined,
      expiresAt: row.expires_at as string | undefined,
      createdAt: row.created_at as string,
    }));
  }

  // ============================================
  // Device Operations
  // ============================================

  async getDevice(moltbotId: string, deviceId: string): Promise<LinkedDevice | null> {
    const dev = await this.db
      .prepare('SELECT * FROM devices WHERE id = ? AND moltbot_id = ?')
      .bind(deviceId, moltbotId)
      .first();

    if (!dev) return null;

    return {
      id: dev.id as string,
      moltbotId: dev.moltbot_id as string,
      publicKey: dev.public_key as string,
      deviceName: dev.device_name as string | undefined,
      linkedAt: dev.linked_at as string,
      lastSeen: dev.last_seen as string,
    };
  }

  async saveDevice(device: LinkedDevice): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO devices (id, moltbot_id, public_key, device_name, linked_at, last_seen)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(
        device.id,
        device.moltbotId,
        device.publicKey,
        device.deviceName || null,
        device.linkedAt,
        device.lastSeen
      )
      .run();
  }

  async listDevices(moltbotId: string): Promise<LinkedDevice[]> {
    const results = await this.db
      .prepare('SELECT * FROM devices WHERE moltbot_id = ? ORDER BY linked_at DESC')
      .bind(moltbotId)
      .all();

    return results.results.map((row) => ({
      id: row.id as string,
      moltbotId: row.moltbot_id as string,
      publicKey: row.public_key as string,
      deviceName: row.device_name as string | undefined,
      linkedAt: row.linked_at as string,
      lastSeen: row.last_seen as string,
    }));
  }

  async deleteDevice(moltbotId: string, deviceId: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM devices WHERE id = ? AND moltbot_id = ?')
      .bind(deviceId, moltbotId)
      .run();
  }

  // ============================================
  // Pairing Operations
  // ============================================

  async getPairingRequest(token: string): Promise<PairingRequest | null> {
    const req = await this.db
      .prepare('SELECT * FROM pairing_requests WHERE token = ?')
      .bind(token)
      .first();

    if (!req) return null;

    return {
      token: req.token as string,
      moltbotId: req.moltbot_id as string,
      devicePublicKey: req.device_public_key as string,
      deviceName: req.device_name as string | undefined,
      status: req.status as 'pending' | 'approved' | 'rejected',
      createdAt: req.created_at as string,
      expiresAt: req.expires_at as string,
    };
  }

  async savePairingRequest(request: PairingRequest): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR REPLACE INTO pairing_requests (token, moltbot_id, device_public_key, device_name, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        request.token,
        request.moltbotId,
        request.devicePublicKey || null,
        request.deviceName || null,
        request.status,
        request.createdAt,
        request.expiresAt
      )
      .run();
  }

  async deletePairingRequest(token: string): Promise<void> {
    await this.db.prepare('DELETE FROM pairing_requests WHERE token = ?').bind(token).run();
  }

  // ============================================
  // Read State / Unread Count Operations
  // ============================================

  async getUnreadCount(moltbotId: string, convId: string): Promise<number> {
    const readState = await this.db
      .prepare('SELECT last_read_at FROM read_state WHERE moltbot_id = ? AND conversation_id = ?')
      .bind(moltbotId, convId)
      .first();

    const lastReadAt = readState?.last_read_at as string | null;

    let query = `
      SELECT COUNT(*) as count FROM messages
      WHERE conversation_id = ? AND from_id != ?
    `;
    const params: string[] = [convId, moltbotId];

    if (lastReadAt) {
      query += ' AND created_at > ?';
      params.push(lastReadAt);
    }

    const result = await this.db
      .prepare(query)
      .bind(...params)
      .first();

    return (result?.count as number) || 0;
  }

  async markAsRead(moltbotId: string, convId: string): Promise<void> {
    const now = new Date().toISOString();

    // Get the latest message ID
    const latestMsg = await this.db
      .prepare(
        'SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1'
      )
      .bind(convId)
      .first();

    await this.db
      .prepare(
        `INSERT OR REPLACE INTO read_state (moltbot_id, conversation_id, last_read_at, last_read_message_id)
         VALUES (?, ?, ?, ?)`
      )
      .bind(moltbotId, convId, now, latestMsg?.id || null)
      .run();
  }
}
