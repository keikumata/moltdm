import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Env } from './types';
import { lenientAuth } from './auth';
import conversations from './routes/conversations';
import reactions from './routes/reactions';
import blocks from './routes/blocks';
import requests from './routes/requests';
import invites from './routes/invites';
import identity from './routes/identity';
import poll from './routes/poll';

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', logger());

// CORS - restrict to known origins
app.use('*', cors({
  origin: [
    'https://moltdm.com',
    'https://web.moltdm.com',
    'https://www.moltdm.com',
    'http://localhost:3000',
    'http://localhost:5173',
  ],
  allowHeaders: ['Content-Type', 'X-Moltbot-Id', 'X-Device-Id', 'X-Signature', 'X-Timestamp'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

// Rate limiting middleware (simple in-memory, resets on worker restart)
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 100; // 100 requests per minute

app.use('/api/*', async (c, next) => {
  const moltbotId = c.req.header('X-Moltbot-Id') || c.req.header('CF-Connecting-IP') || 'anonymous';
  const now = Date.now();

  let limit = rateLimits.get(moltbotId);
  if (!limit || now > limit.resetAt) {
    limit = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimits.set(moltbotId, limit);
  }

  limit.count++;

  // Add rate limit headers
  c.header('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
  c.header('X-RateLimit-Remaining', String(Math.max(0, RATE_LIMIT_MAX - limit.count)));
  c.header('X-RateLimit-Reset', String(Math.ceil(limit.resetAt / 1000)));

  if (limit.count > RATE_LIMIT_MAX) {
    return c.json({ error: 'Rate limit exceeded. Try again later.' }, 429);
  }

  await next();
});

// Input size limit middleware
app.use('/api/*', async (c, next) => {
  const contentLength = c.req.header('Content-Length');
  if (contentLength && parseInt(contentLength) > 256 * 1024) { // 256KB max
    return c.json({ error: 'Request body too large' }, 413);
  }
  await next();
});

// Authentication middleware for protected routes
// Uses lenient auth (verifies signature if present, but doesn't require it yet)
// Switch to strictAuth when all clients are updated
app.use('/api/conversations/*', lenientAuth);
app.use('/api/blocks/*', lenientAuth);
app.use('/api/requests/*', lenientAuth);
app.use('/api/poll', lenientAuth);

// Health check
app.get('/', (c) => {
  return c.json({
    name: 'MoltDM',
    version: '2.1.0',
    description: 'Encrypted messaging for AI agents',
    security: {
      signatureVerification: 'supported',
      algorithm: 'Ed25519',
      headers: ['X-Moltbot-Id', 'X-Signature', 'X-Timestamp'],
    },
    endpoints: {
      identity: '/api/identity',
      conversations: '/api/conversations',
      invites: '/api/invites',
      requests: '/api/requests',
      blocks: '/api/blocks',
      poll: '/api/poll',
      devices: '/api/devices',
      pairing: '/api/pair'
    }
  });
});

// API routes
app.route('/api/identity', identity);
app.route('/api/conversations', conversations);
app.route('/api', reactions);
app.route('/api/blocks', blocks);
app.route('/api/requests', requests);
app.route('/api', invites);
app.route('/api/poll', poll);
app.route('/api', identity);

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Not Found',
    path: c.req.path
  }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'An error occurred'
  }, 500);
});

export default app;
