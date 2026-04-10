const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ─── JWT Secret Management ───
// Priority: 1) JWT_SECRET env var  2) .jwt-secret file  3) generate + save  4) dev fallback
function resolveJwtSecret() {
  // 1. Env var (production deployment)
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

  // 2. Persisted secret file (survives restarts without env var)
  const secretFile = path.join(__dirname, '..', '.jwt-secret');
  try {
    const saved = fs.readFileSync(secretFile, 'utf-8').trim();
    if (saved.length >= 32) return saved;
  } catch (e) {}

  // 3. In production, refuse to start without a proper secret
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] JWT_SECRET environment variable is required in production.');
    process.exit(1);
  }

  // 4. Development: generate and persist a random secret
  const generated = crypto.randomBytes(48).toString('base64');
  try {
    fs.writeFileSync(secretFile, generated, 'utf-8');
    console.log('[Auth] Generated and saved JWT secret to .jwt-secret');
  } catch (e) {
    console.warn('[Auth] Could not persist JWT secret — using ephemeral secret');
  }
  return generated;
}

const JWT_SECRET = resolveJwtSecret();

// ─── Middleware ───

// Required auth — rejects if no valid token, checks disabled status
const requireAuth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    // Check if user is disabled (skip in test mode for speed)
    if (process.env.NODE_ENV !== 'test') {
      const { getDb } = require('../db');
      const user = getDb().prepare('SELECT disabled FROM users WHERE id = ?').get(decoded.id);
      if (user?.disabled) {
        return res.status(403).json({ error: 'Account is disabled. Contact an administrator.' });
      }
    }

    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Optional auth — attaches user if token present, continues either way
const optionalAuth = (req, res, next) => {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const token = header.slice(7);
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (e) { /* ignore invalid tokens */ }
  }
  next();
};

module.exports = { requireAuth, optionalAuth, JWT_SECRET };
