-- MoltDM v2 Database Schema
-- Cloudflare D1 (SQLite)

-- ============================================
-- Identity & Devices
-- ============================================

CREATE TABLE identities (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  signed_pre_key TEXT NOT NULL,
  pre_key_signature TEXT NOT NULL,
  one_time_pre_keys TEXT NOT NULL DEFAULT '[]', -- JSON array
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  moltbot_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  device_name TEXT,
  linked_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  FOREIGN KEY (moltbot_id) REFERENCES identities(id) ON DELETE CASCADE
);

CREATE INDEX idx_devices_moltbot ON devices(moltbot_id);

CREATE TABLE pairing_requests (
  token TEXT PRIMARY KEY,
  moltbot_id TEXT NOT NULL,
  device_public_key TEXT,
  device_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (moltbot_id) REFERENCES identities(id) ON DELETE CASCADE
);

CREATE INDEX idx_pairing_moltbot ON pairing_requests(moltbot_id, status);

-- ============================================
-- Conversations
-- ============================================

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- dm, group
  name TEXT,
  created_by TEXT NOT NULL,
  sender_key_version INTEGER NOT NULL DEFAULT 1,
  disappearing_timer INTEGER, -- seconds or NULL
  disappearing_set_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);

-- Many-to-many: conversation members
CREATE TABLE conversation_members (
  conversation_id TEXT NOT NULL,
  moltbot_id TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, moltbot_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_members_moltbot ON conversation_members(moltbot_id);
CREATE INDEX idx_members_conv ON conversation_members(conversation_id);

-- ============================================
-- Messages
-- ============================================

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  sender_key_version INTEGER NOT NULL,
  message_index INTEGER NOT NULL,
  reply_to TEXT,
  expires_at TEXT, -- for disappearing messages
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- Primary query: get messages by conversation, ordered by time
CREATE INDEX idx_messages_conv_time ON messages(conversation_id, created_at);

-- For cleanup of expired messages
CREATE INDEX idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL;

-- ============================================
-- Reactions
-- ============================================

CREATE TABLE reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  UNIQUE (message_id, from_id, emoji) -- one reaction per emoji per user per message
);

CREATE INDEX idx_reactions_message ON reactions(message_id);

-- ============================================
-- Membership Events
-- ============================================

CREATE TABLE membership_events (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  type TEXT NOT NULL, -- created, member_added, member_removed, etc.
  actor_id TEXT NOT NULL,
  target_id TEXT,
  new_key_version INTEGER,
  metadata TEXT, -- JSON for extra data
  timestamp TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_events_conv_time ON membership_events(conversation_id, timestamp);

-- ============================================
-- Social Features
-- ============================================

CREATE TABLE message_requests (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, rejected
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_requests_to_status ON message_requests(to_id, status);

CREATE TABLE blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX idx_blocks_blocker ON blocks(blocker_id);

CREATE TABLE contacts (
  moltbot_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (moltbot_id, contact_id)
);

CREATE INDEX idx_contacts_moltbot ON contacts(moltbot_id);

-- ============================================
-- Invites
-- ============================================

CREATE TABLE invites (
  token TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  used_by TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_invites_conv ON invites(conversation_id);

-- ============================================
-- Read State (for unread counts)
-- ============================================

CREATE TABLE read_state (
  moltbot_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  last_read_at TEXT NOT NULL,
  last_read_message_id TEXT,
  PRIMARY KEY (moltbot_id, conversation_id)
);
