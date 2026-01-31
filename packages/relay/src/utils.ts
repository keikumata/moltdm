// Cryptographically secure random hex string
function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// Generate moltbot ID from public key using SHA-256
export async function generateMoltbotId(publicKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(publicKey);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.substring(0, 12);
}

// Generate cryptographically secure pairing token (32 bytes = 256 bits)
export function generatePairingToken(): string {
  return 'pair_' + randomHex(16); // 128 bits of randomness
}

// Generate device ID
export function generateDeviceId(): string {
  return 'dev_' + randomHex(16);
}

// Generate message ID with timestamp prefix for ordering
export function generateMessageId(): string {
  const timestamp = Date.now().toString(36); // Base36 timestamp
  const random = randomHex(8);
  return 'msg_' + timestamp + random;
}

// Generate random conversation ID (not deterministic - allows multiple DMs)
export function generateConversationId(): string {
  return 'conv_' + randomHex(12);
}

// Generate invite token
export function generateInviteToken(): string {
  return 'inv_' + randomHex(16);
}

// Generate reaction ID
export function generateReactionId(): string {
  return 'rxn_' + randomHex(12);
}

// Generate event ID
export function generateEventId(): string {
  return 'evt_' + randomHex(12);
}

// Generate request ID
export function generateRequestId(): string {
  return 'req_' + randomHex(12);
}

// Validate emoji (single grapheme, common emoji ranges)
export function isValidEmoji(emoji: string): boolean {
  if (!emoji || emoji.length === 0 || emoji.length > 10) {
    return false;
  }
  // Basic emoji validation - allows common emoji ranges
  const emojiRegex = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u;
  return emojiRegex.test(emoji);
}

// Validate moltbot ID format
export function isValidMoltbotId(id: string): boolean {
  return typeof id === 'string' && /^moltbot_[a-f0-9]{12}$/.test(id);
}

// Validate conversation ID format
export function isValidConversationId(id: string): boolean {
  return typeof id === 'string' && /^conv_[a-f0-9]{24}$/.test(id);
}

// Sanitize string input (remove control characters, limit length)
export function sanitizeString(str: string, maxLength: number = 1000): string {
  if (typeof str !== 'string') return '';
  // Remove control characters except newlines and tabs
  const sanitized = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return sanitized.substring(0, maxLength);
}

// Verify signature placeholder - IMPLEMENT WITH REAL CRYPTO BEFORE PRODUCTION
export async function verifySignature(
  moltbotId: string,
  publicKey: string,
  signature: string,
  data: string
): Promise<boolean> {
  // TODO: Implement Ed25519 signature verification
  // This is a critical security feature that MUST be implemented
  // before production use. Currently returns true for development.
  console.warn('WARNING: Signature verification not implemented!');
  return true;
}

// Constant-time string comparison to prevent timing attacks
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
