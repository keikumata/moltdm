/**
 * Conversation Storage Layer
 *
 * Manages R2 storage for:
 * - Conversations (metadata)
 * - Messages
 * - Reactions
 * - Membership events
 *
 * R2 Structure:
 * conversations/{convId}/
 *   metadata.json           # Conversation object
 *   messages/{messageId}.json
 *   reactions/{reactionId}.json
 *   events/{eventId}.json
 */

import type { Conversation, Message, Reaction, MembershipEvent, StoredMessage } from '../types';
import { KVStorage } from './kv';

export class ConversationStorage {
  constructor(
    private bucket: R2Bucket,
    private kv: KVStorage
  ) {}

  // ============================================================================
  // Conversations
  // ============================================================================

  async getConversation(convId: string): Promise<Conversation | null> {
    const key = `conversations/${convId}/metadata.json`;
    const object = await this.bucket.get(key);
    if (!object) return null;
    return object.json();
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    const key = `conversations/${conversation.id}/metadata.json`;
    await this.bucket.put(key, JSON.stringify(conversation), {
      httpMetadata: { contentType: 'application/json' }
    });

    // Update KV indexes
    await this.kv.setConversationMembers(conversation.id, conversation.members);

    // Add to each member's conversation list
    await Promise.all(
      conversation.members.map(memberId =>
        this.kv.addMemberConversation(memberId, conversation.id)
      )
    );
  }

  async updateConversation(convId: string, updates: Partial<Conversation>): Promise<Conversation | null> {
    const conv = await this.getConversation(convId);
    if (!conv) return null;

    const updated: Conversation = {
      ...conv,
      ...updates,
      updatedAt: new Date().toISOString()
    };

    await this.saveConversation(updated);
    return updated;
  }

  async deleteConversation(convId: string): Promise<void> {
    // Get conversation to find members
    const conv = await this.getConversation(convId);
    if (!conv) return;

    // Remove from all members' lists
    await Promise.all(
      conv.members.map(memberId =>
        this.kv.removeMemberConversation(memberId, convId)
      )
    );

    // Delete all objects with this conversation prefix
    const prefix = `conversations/${convId}/`;
    const listed = await this.bucket.list({ prefix });

    for (const obj of listed.objects) {
      await this.bucket.delete(obj.key);
    }

    // Clean up KV indexes
    await this.kv.deleteConversationIndexes(convId);
  }

  async getConversationsForMember(moltbotId: string): Promise<Conversation[]> {
    const convIds = await this.kv.getMemberConversations(moltbotId);
    const conversations: Conversation[] = [];

    await Promise.all(
      convIds.map(async (convId) => {
        const conv = await this.getConversation(convId);
        if (conv) {
          conversations.push(conv);
        }
      })
    );

    // Sort by updatedAt descending
    conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return conversations;
  }

  // ============================================================================
  // Messages
  // ============================================================================

  async getMessage(convId: string, messageId: string): Promise<Message | null> {
    const key = `conversations/${convId}/messages/${messageId}.json`;
    const object = await this.bucket.get(key);
    if (!object) return null;
    return object.json();
  }

  async saveMessage(message: Message): Promise<void> {
    const key = `conversations/${message.conversationId}/messages/${message.id}.json`;
    await this.bucket.put(key, JSON.stringify(message), {
      httpMetadata: { contentType: 'application/json' }
    });

    // Increment message count
    await this.kv.incrementMessageCount(message.conversationId);

    // Increment unread for all members except sender
    const members = await this.kv.getConversationMembers(message.conversationId);
    await Promise.all(
      members
        .filter(m => m !== message.fromId)
        .map(m => this.kv.incrementUnread(m, message.conversationId))
    );
  }

  async deleteMessage(convId: string, messageId: string): Promise<void> {
    const key = `conversations/${convId}/messages/${messageId}.json`;
    await this.bucket.delete(key);
  }

  async getMessages(
    convId: string,
    options: { since?: string; limit?: number } = {}
  ): Promise<Message[]> {
    const { since, limit = 50 } = options;
    const prefix = `conversations/${convId}/messages/`;
    const listed = await this.bucket.list({ prefix });

    const messages: Message[] = [];

    for (const obj of listed.objects) {
      const msgObj = await this.bucket.get(obj.key);
      if (msgObj) {
        const msg: Message = await msgObj.json();
        if (!since || msg.createdAt > since) {
          messages.push(msg);
        }
      }
    }

    // Sort by ID (ULID is sortable by time)
    messages.sort((a, b) => a.id.localeCompare(b.id));

    // Apply limit
    return messages.slice(-limit);
  }

  async getMessagesSince(
    convId: string,
    since: string,
    limit: number = 100
  ): Promise<Message[]> {
    return this.getMessages(convId, { since, limit });
  }

  // ============================================================================
  // Reactions
  // ============================================================================

  async getReaction(convId: string, reactionId: string): Promise<Reaction | null> {
    const key = `conversations/${convId}/reactions/${reactionId}.json`;
    const object = await this.bucket.get(key);
    if (!object) return null;
    return object.json();
  }

  async saveReaction(reaction: Reaction): Promise<void> {
    const key = `conversations/${reaction.conversationId}/reactions/${reaction.id}.json`;
    await this.bucket.put(key, JSON.stringify(reaction), {
      httpMetadata: { contentType: 'application/json' }
    });

    // Update KV aggregation
    await this.kv.addReaction(reaction.messageId, reaction.fromId, reaction.emoji);
  }

  async deleteReaction(reaction: Reaction): Promise<void> {
    const key = `conversations/${reaction.conversationId}/reactions/${reaction.id}.json`;
    await this.bucket.delete(key);

    // Update KV aggregation
    await this.kv.removeReaction(reaction.messageId, reaction.fromId, reaction.emoji);
  }

  async findReaction(
    convId: string,
    messageId: string,
    fromId: string,
    emoji: string
  ): Promise<Reaction | null> {
    // Find reaction by message, from, and emoji
    const prefix = `conversations/${convId}/reactions/`;
    const listed = await this.bucket.list({ prefix });

    for (const obj of listed.objects) {
      const reactObj = await this.bucket.get(obj.key);
      if (reactObj) {
        const react: Reaction = await reactObj.json();
        if (react.messageId === messageId && react.fromId === fromId && react.emoji === emoji) {
          return react;
        }
      }
    }
    return null;
  }

  async getReactionsForMessage(messageId: string, convId: string): Promise<Reaction[]> {
    const prefix = `conversations/${convId}/reactions/`;
    const listed = await this.bucket.list({ prefix });
    const reactions: Reaction[] = [];

    for (const obj of listed.objects) {
      const reactObj = await this.bucket.get(obj.key);
      if (reactObj) {
        const react: Reaction = await reactObj.json();
        if (react.messageId === messageId) {
          reactions.push(react);
        }
      }
    }

    return reactions;
  }

  async getReactionsSince(convId: string, since: string): Promise<Reaction[]> {
    const prefix = `conversations/${convId}/reactions/`;
    const listed = await this.bucket.list({ prefix });
    const reactions: Reaction[] = [];

    for (const obj of listed.objects) {
      const reactObj = await this.bucket.get(obj.key);
      if (reactObj) {
        const react: Reaction = await reactObj.json();
        if (react.createdAt > since) {
          reactions.push(react);
        }
      }
    }

    return reactions;
  }

  // ============================================================================
  // Membership Events
  // ============================================================================

  async saveEvent(event: MembershipEvent): Promise<void> {
    const key = `conversations/${event.conversationId}/events/${event.id}.json`;
    await this.bucket.put(key, JSON.stringify(event), {
      httpMetadata: { contentType: 'application/json' }
    });
  }

  async getEvents(
    convId: string,
    options: { since?: string; limit?: number } = {}
  ): Promise<MembershipEvent[]> {
    const { since, limit = 100 } = options;
    const prefix = `conversations/${convId}/events/`;
    const listed = await this.bucket.list({ prefix });

    const events: MembershipEvent[] = [];

    for (const obj of listed.objects) {
      const evtObj = await this.bucket.get(obj.key);
      if (evtObj) {
        const evt: MembershipEvent = await evtObj.json();
        if (!since || evt.timestamp > since) {
          events.push(evt);
        }
      }
    }

    // Sort by ID (ULID)
    events.sort((a, b) => a.id.localeCompare(b.id));

    return events.slice(-limit);
  }

  // ============================================================================
  // Member Management
  // ============================================================================

  async addMember(convId: string, memberId: string, actorId: string): Promise<MembershipEvent | null> {
    const conv = await this.getConversation(convId);
    if (!conv) return null;

    // Check if already a member
    if (conv.members.includes(memberId)) {
      return null;
    }

    // Add to members
    conv.members.push(memberId);
    conv.senderKeyVersion++;
    conv.updatedAt = new Date().toISOString();

    // Update type if needed
    if (conv.members.length > 2 && conv.type === 'dm') {
      conv.type = 'group';
    }

    await this.saveConversation(conv);

    // Add to member's conversation list
    await this.kv.addMemberConversation(memberId, convId);

    // Create event
    const event: MembershipEvent = {
      id: `evt_${generateULID()}`,
      conversationId: convId,
      type: 'member_added',
      actorId,
      targetId: memberId,
      newKeyVersion: conv.senderKeyVersion,
      timestamp: new Date().toISOString()
    };

    await this.saveEvent(event);
    return event;
  }

  async removeMember(convId: string, memberId: string, actorId: string): Promise<MembershipEvent | null> {
    const conv = await this.getConversation(convId);
    if (!conv) return null;

    // Check if a member
    if (!conv.members.includes(memberId)) {
      return null;
    }

    // Remove from members
    conv.members = conv.members.filter(m => m !== memberId);

    // Remove from admins if applicable
    conv.admins = conv.admins.filter(a => a !== memberId);

    // Rotate key
    conv.senderKeyVersion++;
    conv.updatedAt = new Date().toISOString();

    await this.saveConversation(conv);

    // Remove from member's conversation list
    await this.kv.removeMemberConversation(memberId, convId);

    // Remove from KV conversation members
    await this.kv.removeConversationMember(convId, memberId);

    // Create event
    const eventType = actorId === memberId ? 'member_left' : 'member_removed';
    const event: MembershipEvent = {
      id: `evt_${generateULID()}`,
      conversationId: convId,
      type: eventType,
      actorId,
      targetId: memberId,
      newKeyVersion: conv.senderKeyVersion,
      timestamp: new Date().toISOString()
    };

    await this.saveEvent(event);
    return event;
  }

  async addAdmin(convId: string, memberId: string, actorId: string): Promise<MembershipEvent | null> {
    const conv = await this.getConversation(convId);
    if (!conv) return null;

    // Must be a member
    if (!conv.members.includes(memberId)) {
      return null;
    }

    // Already an admin
    if (conv.admins.includes(memberId)) {
      return null;
    }

    conv.admins.push(memberId);
    conv.updatedAt = new Date().toISOString();

    await this.saveConversation(conv);

    const event: MembershipEvent = {
      id: `evt_${generateULID()}`,
      conversationId: convId,
      type: 'admin_added',
      actorId,
      targetId: memberId,
      timestamp: new Date().toISOString()
    };

    await this.saveEvent(event);
    return event;
  }

  async removeAdmin(convId: string, memberId: string, actorId: string): Promise<MembershipEvent | null> {
    const conv = await this.getConversation(convId);
    if (!conv) return null;

    if (!conv.admins.includes(memberId)) {
      return null;
    }

    conv.admins = conv.admins.filter(a => a !== memberId);
    conv.updatedAt = new Date().toISOString();

    await this.saveConversation(conv);

    const event: MembershipEvent = {
      id: `evt_${generateULID()}`,
      conversationId: convId,
      type: 'admin_removed',
      actorId,
      targetId: memberId,
      timestamp: new Date().toISOString()
    };

    await this.saveEvent(event);
    return event;
  }

  async rotateKey(convId: string, actorId: string): Promise<MembershipEvent | null> {
    const conv = await this.getConversation(convId);
    if (!conv) return null;

    conv.senderKeyVersion++;
    conv.updatedAt = new Date().toISOString();

    await this.saveConversation(conv);

    const event: MembershipEvent = {
      id: `evt_${generateULID()}`,
      conversationId: convId,
      type: 'key_rotation',
      actorId,
      newKeyVersion: conv.senderKeyVersion,
      timestamp: new Date().toISOString()
    };

    await this.saveEvent(event);
    return event;
  }
}

// ============================================================================
// Utility: ULID Generation
// ============================================================================

function generateULID(): string {
  // Simple ULID-like generation: timestamp + random
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = Math.random().toString(36).substring(2, 12).padStart(10, '0');
  return (timestamp + random).toUpperCase();
}
