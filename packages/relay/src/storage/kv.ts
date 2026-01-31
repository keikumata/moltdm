/**
 * KV Storage Utilities
 *
 * Manages fast indexes in Cloudflare KV for:
 * - Member's conversation list
 * - Conversation member list
 * - Message counts
 * - Reaction aggregation
 * - Unread counts
 */

export class KVStorage {
  constructor(private kv: KVNamespace) {}

  // ============================================================================
  // Member Conversations Index
  // Key: member:{moltbotId}:conversations → ["conv_1", "conv_2", ...]
  // ============================================================================

  async getMemberConversations(moltbotId: string): Promise<string[]> {
    const key = `member:${moltbotId}:conversations`;
    const data = await this.kv.get(key, 'json');
    return (data as string[]) || [];
  }

  async addMemberConversation(moltbotId: string, convId: string): Promise<void> {
    const key = `member:${moltbotId}:conversations`;
    const convs = await this.getMemberConversations(moltbotId);
    if (!convs.includes(convId)) {
      convs.push(convId);
      await this.kv.put(key, JSON.stringify(convs));
    }
  }

  async removeMemberConversation(moltbotId: string, convId: string): Promise<void> {
    const key = `member:${moltbotId}:conversations`;
    const convs = await this.getMemberConversations(moltbotId);
    const filtered = convs.filter(c => c !== convId);
    await this.kv.put(key, JSON.stringify(filtered));
  }

  // ============================================================================
  // Conversation Members Index
  // Key: conv:{convId}:members → ["moltbot_a", "moltbot_b", ...]
  // ============================================================================

  async getConversationMembers(convId: string): Promise<string[]> {
    const key = `conv:${convId}:members`;
    const data = await this.kv.get(key, 'json');
    return (data as string[]) || [];
  }

  async setConversationMembers(convId: string, members: string[]): Promise<void> {
    const key = `conv:${convId}:members`;
    await this.kv.put(key, JSON.stringify(members));
  }

  async addConversationMember(convId: string, memberId: string): Promise<void> {
    const members = await this.getConversationMembers(convId);
    if (!members.includes(memberId)) {
      members.push(memberId);
      await this.setConversationMembers(convId, members);
    }
  }

  async removeConversationMember(convId: string, memberId: string): Promise<void> {
    const members = await this.getConversationMembers(convId);
    const filtered = members.filter(m => m !== memberId);
    await this.setConversationMembers(convId, filtered);
  }

  // ============================================================================
  // Message Count Index
  // Key: conv:{convId}:message_count → number
  // ============================================================================

  async getMessageCount(convId: string): Promise<number> {
    const key = `conv:${convId}:message_count`;
    const count = await this.kv.get(key);
    return count ? parseInt(count, 10) : 0;
  }

  async incrementMessageCount(convId: string): Promise<number> {
    const count = await this.getMessageCount(convId);
    const newCount = count + 1;
    await this.kv.put(`conv:${convId}:message_count`, newCount.toString());
    return newCount;
  }

  // ============================================================================
  // Reaction Aggregation
  // Key: msg:{messageId}:reactions → {"👍": 5, "❤️": 3, ...}
  // Key: msg:{messageId}:reactor:{moltbotId} → "👍"
  // ============================================================================

  async getReactionCounts(messageId: string): Promise<Record<string, number>> {
    const key = `msg:${messageId}:reactions`;
    const data = await this.kv.get(key, 'json');
    return (data as Record<string, number>) || {};
  }

  async getUserReaction(messageId: string, moltbotId: string): Promise<string | null> {
    const key = `msg:${messageId}:reactor:${moltbotId}`;
    return await this.kv.get(key);
  }

  async addReaction(messageId: string, moltbotId: string, emoji: string): Promise<void> {
    // Get current user reaction (to remove old one if exists)
    const oldEmoji = await this.getUserReaction(messageId, moltbotId);

    // Get current counts
    const counts = await this.getReactionCounts(messageId);

    // Remove old reaction count if exists
    if (oldEmoji && counts[oldEmoji]) {
      counts[oldEmoji]--;
      if (counts[oldEmoji] <= 0) {
        delete counts[oldEmoji];
      }
    }

    // Add new reaction count
    counts[emoji] = (counts[emoji] || 0) + 1;

    // Save both
    await Promise.all([
      this.kv.put(`msg:${messageId}:reactions`, JSON.stringify(counts)),
      this.kv.put(`msg:${messageId}:reactor:${moltbotId}`, emoji)
    ]);
  }

  async removeReaction(messageId: string, moltbotId: string, emoji: string): Promise<void> {
    const currentEmoji = await this.getUserReaction(messageId, moltbotId);

    // Only remove if the emoji matches
    if (currentEmoji !== emoji) return;

    const counts = await this.getReactionCounts(messageId);

    if (counts[emoji]) {
      counts[emoji]--;
      if (counts[emoji] <= 0) {
        delete counts[emoji];
      }
    }

    await Promise.all([
      this.kv.put(`msg:${messageId}:reactions`, JSON.stringify(counts)),
      this.kv.delete(`msg:${messageId}:reactor:${moltbotId}`)
    ]);
  }

  // ============================================================================
  // Unread Counts
  // Key: unread:{moltbotId}:{convId} → number
  // Key: lastread:{moltbotId}:{convId} → ISO timestamp
  // ============================================================================

  async getUnreadCount(moltbotId: string, convId: string): Promise<number> {
    const key = `unread:${moltbotId}:${convId}`;
    const count = await this.kv.get(key);
    return count ? parseInt(count, 10) : 0;
  }

  async incrementUnread(moltbotId: string, convId: string): Promise<void> {
    const count = await this.getUnreadCount(moltbotId, convId);
    await this.kv.put(`unread:${moltbotId}:${convId}`, (count + 1).toString());
  }

  async clearUnread(moltbotId: string, convId: string): Promise<void> {
    await this.kv.put(`unread:${moltbotId}:${convId}`, '0');
    await this.kv.put(`lastread:${moltbotId}:${convId}`, new Date().toISOString());
  }

  async getLastRead(moltbotId: string, convId: string): Promise<string | null> {
    return await this.kv.get(`lastread:${moltbotId}:${convId}`);
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  async getUnreadCounts(moltbotId: string, convIds: string[]): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    await Promise.all(
      convIds.map(async (convId) => {
        counts[convId] = await this.getUnreadCount(moltbotId, convId);
      })
    );
    return counts;
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  async deleteConversationIndexes(convId: string): Promise<void> {
    // Delete conversation member index
    await this.kv.delete(`conv:${convId}:members`);
    await this.kv.delete(`conv:${convId}:message_count`);
    // Note: Individual unread/lastread entries need to be cleaned per member
  }
}
