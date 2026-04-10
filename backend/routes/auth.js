const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getDb } = require('../db');
const { requireAuth, JWT_SECRET } = require('../lib/authMiddleware');
const audit = require('../lib/audit');

const router = express.Router();

/**
 * Validate password strength.
 * Returns null if valid, error message string if invalid.
 */
function validatePassword(password) {
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  return null;
}

/**
 * Get password strength score (0-4) for frontend indicator.
 */
function getPasswordStrength(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

const AVATARS_DIR = path.join(__dirname, '..', 'uploads', 'avatars');
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Only image files allowed'));
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, password, display_name } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // First user becomes admin
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const role = userCount.count === 0 ? 'admin' : 'member';

    const password_hash = await bcrypt.hash(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)'
    ).run(username, password_hash, display_name || username, role);

    const token = jwt.sign({ id: result.lastInsertRowid, username, role }, JWT_SECRET, { expiresIn: '7d' });

    audit.log({ userId: result.lastInsertRowid, username, action: 'user.register', resourceType: 'user', resourceId: result.lastInsertRowid, ip: req.ip });

    res.status(201).json({
      success: true,
      token,
      user: { id: result.lastInsertRowid, username, display_name: display_name || username, role }
    });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (user.disabled) {
      return res.status(403).json({ error: 'Account is disabled. Contact an administrator.' });
    }

    // Track last login
    db.prepare('UPDATE users SET last_login = datetime(?) WHERE id = ?').run(new Date().toISOString(), user.id);

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    audit.log({ userId: user.id, username: user.username, action: 'user.login', resourceType: 'user', resourceId: user.id, ip: req.ip });

    res.json({
      success: true,
      token,
      user: { id: user.id, username: user.username, display_name: user.display_name, avatar: user.avatar || null, role: user.role }
    });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/auth/me — get current user from token
router.get('/me', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, username, display_name, avatar, role, created_at, storage_quota_bytes, storage_used_bytes FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(user);
});

// PUT /api/auth/profile — update own profile (bio, display_name)
router.put('/profile', requireAuth, (req, res) => {
  try {
    const { display_name, bio } = req.body;
    const db = getDb();

    if (display_name !== undefined) db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display_name, req.user.id);
    if (bio !== undefined) db.prepare('UPDATE users SET bio = ? WHERE id = ?').run(bio, req.user.id);

    const user = db.prepare('SELECT id, username, display_name, bio, avatar, role, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json(user);
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/auth/avatar — upload profile picture
router.post('/avatar', requireAuth, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });

    const db = getDb();
    const filename = `avatar_${req.user.id}_${crypto.randomBytes(4).toString('hex')}.webp`;
    const filepath = path.join(AVATARS_DIR, filename);

    // Resize to 256x256 square and convert to WebP
    await sharp(req.file.buffer)
      .resize(256, 256, { fit: 'cover' })
      .webp({ quality: 85 })
      .toFile(filepath);

    // Delete old avatar if exists
    const oldUser = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.user.id);
    if (oldUser?.avatar) {
      const oldPath = path.join(AVATARS_DIR, path.basename(oldUser.avatar));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const avatarUrl = `avatars/${filename}`;
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarUrl, req.user.id);

    res.json({ success: true, avatar: avatarUrl });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/auth/password-strength — check password strength (no auth needed)
router.post('/password-strength', (req, res) => {
  const { password } = req.body;
  const error = validatePassword(password);
  const strength = getPasswordStrength(password);
  const labels = ['Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
  res.json({ valid: !error, error, strength, label: labels[strength] });
});

// PUT /api/auth/change-password — change own password
router.put('/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    const passwordError = validatePassword(new_password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const db = getDb();
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(new_password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);

    audit.fromReq(req, 'user.password_change', 'user', req.user.id);

    res.json({ success: true });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/auth/users/:username — public profile
router.get('/users/:username', (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.bio, u.avatar, u.role, u.created_at,
        (SELECT COUNT(*) FROM images WHERE user_id = u.id AND visibility = 'public') as public_count,
        (SELECT COUNT(*) FROM images WHERE user_id = u.id) as total_count,
        (SELECT COUNT(*) FROM favorites f INNER JOIN images i ON f.image_id = i.id WHERE i.user_id = u.id) as total_favorites_received
      FROM users u WHERE u.username = ?
    `).get(req.params.username);

    if (!user || user.disabled) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/auth/users/:username/images — user's public images
router.get('/users/:username/images', (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const total = db.prepare("SELECT COUNT(*) as count FROM images WHERE user_id = ? AND visibility = 'public'").get(user.id);
    const images = db.prepare(`
      SELECT id, filename, original_name, filepath, thumbnail_path, preview_path, title, width, height, file_size, format,
        has_metadata, prompt, model, sampler, created_at, media_type, duration, visibility,
        (SELECT COUNT(*) FROM favorites WHERE image_id = images.id) as favorite_count
      FROM images WHERE user_id = ? AND visibility = 'public'
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(user.id, limit, offset);

    res.json({ total: total.count, limit, offset, images });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

module.exports = router;
