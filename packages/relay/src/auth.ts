/**
 * Authentication middleware for MoltDM
 *
 * Implements Ed25519 signature verification for all authenticated requests.
 *
 * Request must include headers:
 * - X-Moltbot-Id: The moltbot's ID
 * - X-Timestamp: Unix timestamp in milliseconds (must be within 5 minutes)
 * - X-Signature: Base64-encoded Ed25519 signature of: timestamp + method + path + body
 */

import type { Context, Next } from 'hono';
import type { Env } from './types';
import { DatabaseStorage } from './storage/db';

// Maximum age of a request (5 minutes) to prevent replay attacks
const MAX_REQUEST_AGE_MS = 5 * 60 * 1000;

/**
 * Convert base64 string to Uint8Array
 */
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Import Ed25519 public key for verification
 */
async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  const publicKeyBytes = base64ToBytes(publicKeyBase64);

  return crypto.subtle.importKey(
    'raw',
    publicKeyBytes,
    {
      name: 'Ed25519',
    },
    false,
    ['verify']
  );
}

/**
 * Verify Ed25519 signature
 */
async function verifyEd25519Signature(
  publicKeyBase64: string,
  signatureBase64: string,
  message: string
): Promise<boolean> {
  try {
    const publicKey = await importPublicKey(publicKeyBase64);
    const signature = base64ToBytes(signatureBase64);
    const encoder = new TextEncoder();
    const messageBytes = encoder.encode(message);

    return crypto.subtle.verify(
      'Ed25519',
      publicKey,
      signature,
      messageBytes
    );
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Create the message that should be signed
 * Format: timestamp + method + path + bodyHash
 */
async function createSignedMessage(
  timestamp: string,
  method: string,
  path: string,
  body: string
): Promise<string> {
  // Hash the body to keep message size consistent
  let bodyHash = '';
  if (body) {
    const encoder = new TextEncoder();
    const bodyBytes = encoder.encode(body);
    const hashBuffer = await crypto.subtle.digest('SHA-256', bodyBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    bodyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  return `${timestamp}:${method}:${path}:${bodyHash}`;
}

/**
 * Authentication middleware factory
 *
 * @param options.requireSignature - If true, rejects requests without valid signature
 *                                   If false, allows unsigned requests (for backwards compatibility)
 */
export function createAuthMiddleware(options: { requireSignature?: boolean } = {}) {
  const { requireSignature = false } = options;

  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const moltbotId = c.req.header('X-Moltbot-Id');

    if (!moltbotId) {
      return c.json({ error: 'X-Moltbot-Id header required' }, 401);
    }

    // Get identity from database
    const storage = new DatabaseStorage(c.env.MOLTDM_DB);
    const identity = await storage.getIdentity(moltbotId);

    if (!identity) {
      return c.json({ error: 'Invalid moltbot ID' }, 401);
    }

    // Check for signature headers
    const signature = c.req.header('X-Signature');
    const timestamp = c.req.header('X-Timestamp');

    // If signature is provided, verify it
    if (signature && timestamp) {
      // Validate timestamp to prevent replay attacks
      const requestTime = parseInt(timestamp, 10);
      const now = Date.now();

      if (isNaN(requestTime)) {
        return c.json({ error: 'Invalid timestamp' }, 401);
      }

      if (Math.abs(now - requestTime) > MAX_REQUEST_AGE_MS) {
        return c.json({ error: 'Request timestamp expired' }, 401);
      }

      // Get request body for signature verification
      let body = '';
      if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
        body = await c.req.text();
        // Re-create body stream for downstream handlers
        // Store parsed body in context for later use
        if (body) {
          try {
            c.set('parsedBody', JSON.parse(body));
          } catch {
            // Body is not JSON, that's okay
          }
        }
      }

      // Create the message that should have been signed
      // Use raw URL path to preserve URL encoding (important for emoji in paths)
      const rawUrl = c.req.raw.url;
      const urlObj = new URL(rawUrl);
      const rawPath = urlObj.pathname;

      const message = await createSignedMessage(
        timestamp,
        c.req.method,
        rawPath,
        body
      );

      // Verify signature
      const isValid = await verifyEd25519Signature(
        identity.publicKey,
        signature,
        message
      );

      if (!isValid) {
        return c.json({ error: 'Invalid signature' }, 401);
      }

      // Mark request as verified
      c.set('signatureVerified', true);
    } else if (requireSignature) {
      // Signature required but not provided
      return c.json({
        error: 'Signature required',
        hint: 'Include X-Signature and X-Timestamp headers'
      }, 401);
    }

    // Store identity in context for use by handlers
    c.set('identity', identity);
    c.set('moltbotId', moltbotId);

    await next();
  };
}

/**
 * Strict auth middleware - requires valid signature
 */
export const strictAuth = createAuthMiddleware({ requireSignature: true });

/**
 * Lenient auth middleware - verifies signature if present, but doesn't require it
 * Use this during transition period
 */
export const lenientAuth = createAuthMiddleware({ requireSignature: false });
