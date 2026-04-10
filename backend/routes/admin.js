const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { requireAuth } = require('../lib/authMiddleware');
const audit = require('../lib/audit');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const THUMBNAILS_DIR = path.join(UPLOADS_DIR, 'thumbnails');

// Admin-only middleware
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

router.use(requireAuth);
router.use(requireAdmin);

// GET /api/admin/stats — system overview
router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const users = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const images = db.prepare("SELECT COUNT(*) as count FROM images WHERE media_type = 'image' OR media_type IS NULL").get().count;
    const videos = db.prepare("SELECT COUNT(*) as count FROM images WHERE media_type = 'video'").get().count;
    const favorites = db.prepare('SELECT COUNT(*) as count FROM favorites').get().count;
    const storage = db.prepare('SELECT COALESCE(SUM(file_size), 0) as total FROM images').get().total;
    const dbOrphans = db.prepare('SELECT COUNT(*) as count FROM images WHERE user_id IS NULL').get().count;

    // Count orphan files on disk
    const dbFiles = new Set();
    const allRows = db.prepare('SELECT filepath, thumbnail_path, preview_path FROM images').all();
    for (const row of allRows) {
      if (row.filepath) dbFiles.add(row.filepath);
      if (row.thumbnail_path) dbFiles.add(row.thumbnail_path);
      if (row.preview_path) dbFiles.add(row.preview_path);
    }
    const allUsers = db.prepare('SELECT avatar FROM users WHERE avatar IS NOT NULL').all();
    for (const u of allUsers) { if (u.avatar) dbFiles.add(u.avatar); }

    let orphanFileCount = 0;
    const scanOrphans = (dir, prefix = '') => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) scanOrphans(path.join(dir, entry.name), rel);
        else if (!dbFiles.has(rel) && !dbFiles.has(entry.name)) orphanFileCount++;
      }
    };
    scanOrphans(UPLOADS_DIR);

    res.json({ users, images, videos, favorites, storage, orphans: dbOrphans, orphanFiles: orphanFileCount });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/admin/users — all users with stats
router.get('/users', (req, res) => {
  try {
    const db = getDb();
    const users = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.disabled, u.created_at, u.last_login,
        (SELECT COUNT(*) FROM images WHERE user_id = u.id) as image_count,
        (SELECT COALESCE(SUM(file_size), 0) FROM images WHERE user_id = u.id) as storage_used
      FROM users u ORDER BY u.created_at DESC
    `).all();

    res.json(users);
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// PUT /api/admin/users/:id/role — change role
router.put('/users/:id/role', (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: 'Role must be "admin" or "member"' });
    }
    // Prevent demoting yourself
    if (parseInt(req.params.id) === req.user.id && role !== 'admin') {
      return res.status(400).json({ error: 'Cannot demote yourself' });
    }

    const db = getDb();
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
    audit.fromReq(req, 'admin.role_change', 'user', parseInt(req.params.id), { role });
    res.json({ success: true });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/admin/users/:id/reset-password
router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const db = getDb();
    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
    audit.fromReq(req, 'admin.password_reset', 'user', parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// PUT /api/admin/users/:id/disable — toggle disabled
router.put('/users/:id/disable', (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot disable yourself' });
    }

    const db = getDb();
    const user = db.prepare('SELECT disabled FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newState = user.disabled ? 0 : 1;
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(newState, req.params.id);
    audit.fromReq(req, newState ? 'admin.user_disable' : 'admin.user_enable', 'user', parseInt(req.params.id));
    res.json({ success: true, disabled: !!newState });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// DELETE /api/admin/users/:id/data — purge all user's images/videos
router.delete('/users/:id/data', (req, res) => {
  try {
    const db = getDb();
    const images = db.prepare('SELECT id, filepath, thumbnail_path, preview_path, analysis_path FROM images WHERE user_id = ?').all(req.params.id);

    // DB deletes in a transaction (atomic — all or nothing)
    const purgeDb = db.transaction(() => {
      const imageIds = images.map(i => i.id);
      if (imageIds.length > 0) {
        const placeholders = imageIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM jobs WHERE image_id IN (${placeholders})`).run(...imageIds);
        db.prepare(`DELETE FROM image_tags WHERE image_id IN (${placeholders})`).run(...imageIds);
        db.prepare(`DELETE FROM comments WHERE image_id IN (${placeholders})`).run(...imageIds);
        db.prepare(`DELETE FROM collection_images WHERE image_id IN (${placeholders})`).run(...imageIds);
        db.prepare(`DELETE FROM favorites WHERE image_id IN (${placeholders})`).run(...imageIds);
      }
      db.prepare('DELETE FROM images WHERE user_id = ?').run(req.params.id);
      db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM image_tags)').run();
      db.prepare('UPDATE users SET storage_used_bytes = 0 WHERE id = ?').run(req.params.id);
    });
    purgeDb();

    // Delete files AFTER transaction commits (can't roll back file deletes)
    for (const img of images) {
      const files = [img.filepath, img.thumbnail_path, img.preview_path, img.analysis_path].filter(Boolean);
      for (const f of files) {
        const fullPath = path.join(UPLOADS_DIR, f);
        try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch (e) {}
      }
    }

    res.json({ success: true, deleted: images.length });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// DELETE /api/admin/users/:id — delete account (optionally purge data)
router.delete('/users/:id', (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    const db = getDb();
    const purgeData = req.query.purge === 'true';
    let filesToDelete = [];

    // All DB operations in one transaction
    const deleteUser = db.transaction(() => {
      if (purgeData) {
        const images = db.prepare('SELECT id, filepath, thumbnail_path, preview_path, analysis_path FROM images WHERE user_id = ?').all(req.params.id);
        filesToDelete = images;
        const imageIds = images.map(i => i.id);
        if (imageIds.length > 0) {
          const placeholders = imageIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM jobs WHERE image_id IN (${placeholders})`).run(...imageIds);
          db.prepare(`DELETE FROM image_tags WHERE image_id IN (${placeholders})`).run(...imageIds);
          db.prepare(`DELETE FROM comments WHERE image_id IN (${placeholders})`).run(...imageIds);
          db.prepare(`DELETE FROM collection_images WHERE image_id IN (${placeholders})`).run(...imageIds);
          db.prepare(`DELETE FROM favorites WHERE image_id IN (${placeholders})`).run(...imageIds);
        }
        db.prepare('DELETE FROM images WHERE user_id = ?').run(req.params.id);
        db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM image_tags)').run();
      }
      db.prepare('DELETE FROM favorites WHERE user_id = ?').run(req.params.id);
      db.prepare('DELETE FROM collections WHERE user_id = ?').run(req.params.id);
      db.prepare('DELETE FROM comments WHERE user_id = ?').run(req.params.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    });
    deleteUser();

    // Delete files AFTER transaction commits
    for (const img of filesToDelete) {
      const files = [img.filepath, img.thumbnail_path, img.preview_path, img.analysis_path].filter(Boolean);
      for (const f of files) {
        try { const fp = path.join(UPLOADS_DIR, f); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
      }
    }

    res.json({ success: true });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// DELETE /api/admin/orphans — purge all images with no user_id (pre-auth uploads)
router.delete('/orphans', (req, res) => {
  try {
    const db = getDb();
    const images = db.prepare('SELECT id, filepath, thumbnail_path, preview_path, analysis_path FROM images WHERE user_id IS NULL').all();

    // DB deletes in transaction
    const purgeOrphans = db.transaction(() => {
      const imageIds = images.map(i => i.id);
      if (imageIds.length > 0) {
        const placeholders = imageIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM jobs WHERE image_id IN (${placeholders})`).run(...imageIds);
        db.prepare(`DELETE FROM image_tags WHERE image_id IN (${placeholders})`).run(...imageIds);
        db.prepare(`DELETE FROM comments WHERE image_id IN (${placeholders})`).run(...imageIds);
        db.prepare(`DELETE FROM collection_images WHERE image_id IN (${placeholders})`).run(...imageIds);
        db.prepare(`DELETE FROM favorites WHERE image_id IN (${placeholders})`).run(...imageIds);
      }
      db.prepare('DELETE FROM images WHERE user_id IS NULL').run();
      db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM image_tags)').run();
    });
    purgeOrphans();

    // Delete files AFTER transaction commits
    for (const img of images) {
      const files = [img.filepath, img.thumbnail_path, img.preview_path, img.analysis_path].filter(Boolean);
      for (const f of files) {
        try { const fp = path.join(UPLOADS_DIR, f); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
      }
    }

    res.json({ success: true, deleted: images.length });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/admin/assign-orphans/:userId — assign all unowned images to a user
router.post('/assign-orphans/:userId', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('UPDATE images SET user_id = ? WHERE user_id IS NULL').run(req.params.userId);
    res.json({ success: true, assigned: result.changes });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/admin/orphan-files — scan for files on disk with no DB record
router.get('/orphan-files', (req, res) => {
  try {
    const db = getDb();

    // Get all filepaths and thumbnail paths from DB
    const dbFiles = new Set();
    const rows = db.prepare('SELECT filepath, thumbnail_path, preview_path FROM images').all();
    for (const row of rows) {
      if (row.filepath) dbFiles.add(row.filepath);
      if (row.thumbnail_path) dbFiles.add(row.thumbnail_path);
      if (row.preview_path) dbFiles.add(row.preview_path);
    }
    // Also add avatar files
    const users = db.prepare('SELECT avatar FROM users WHERE avatar IS NOT NULL').all();
    for (const u of users) {
      if (u.avatar) dbFiles.add(u.avatar);
    }

    // Scan uploads directory recursively
    const orphanFiles = [];
    let orphanSize = 0;

    const scanDir = (dir, prefix = '') => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          scanDir(path.join(dir, entry.name), relativePath);
        } else {
          if (!dbFiles.has(relativePath) && !dbFiles.has(entry.name)) {
            const fullPath = path.join(dir, entry.name);
            const stats = fs.statSync(fullPath);
            orphanFiles.push({ path: relativePath, size: stats.size, modified: stats.mtime });
            orphanSize += stats.size;
          }
        }
      }
    };

    scanDir(UPLOADS_DIR);

    res.json({ orphanFiles, count: orphanFiles.length, totalSize: orphanSize });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// DELETE /api/admin/orphan-files — purge files on disk with no DB record
router.delete('/orphan-files', (req, res) => {
  try {
    const db = getDb();

    // Get all filepaths from DB
    const dbFiles = new Set();
    const rows = db.prepare('SELECT filepath, thumbnail_path, preview_path FROM images').all();
    for (const row of rows) {
      if (row.filepath) dbFiles.add(row.filepath);
      if (row.thumbnail_path) dbFiles.add(row.thumbnail_path);
      if (row.preview_path) dbFiles.add(row.preview_path);
    }
    const users = db.prepare('SELECT avatar FROM users WHERE avatar IS NOT NULL').all();
    for (const u of users) {
      if (u.avatar) dbFiles.add(u.avatar);
    }

    // Scan and delete orphans
    let deleted = 0;
    let freedBytes = 0;

    const scanAndDelete = (dir, prefix = '') => {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          scanAndDelete(path.join(dir, entry.name), relativePath);
        } else {
          if (!dbFiles.has(relativePath) && !dbFiles.has(entry.name)) {
            const fullPath = path.join(dir, entry.name);
            try {
              const stats = fs.statSync(fullPath);
              freedBytes += stats.size;
              fs.unlinkSync(fullPath);
              deleted++;
            } catch (e) { /* skip files that can't be deleted */ }
          }
        }
      }
    };

    scanAndDelete(UPLOADS_DIR);

    res.json({ success: true, deleted, freedBytes });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/admin/regenerate-previews — regenerate preview videos for all videos
router.post('/regenerate-previews', async (req, res) => {
  try {
    const db = getDb();
    const { generateThumbnail } = require('../lib/thumbnail');
    const videos = db.prepare("SELECT id, filepath, filename FROM images WHERE media_type = 'video'").all();

    if (videos.length === 0) {
      return res.json({ success: true, regenerated: 0, message: 'No videos found' });
    }

    let regenerated = 0;
    let failed = 0;

    for (const video of videos) {
      try {
        const inputPath = path.join(UPLOADS_DIR, video.filepath);
        if (!fs.existsSync(inputPath)) { failed++; continue; }

        const { previewPath } = await generateThumbnail(inputPath, THUMBNAILS_DIR, video.filename || video.filepath);

        if (previewPath) {
          db.prepare('UPDATE images SET preview_path = ? WHERE id = ?').run(previewPath, video.id);
          regenerated++;
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
      }
    }

    res.json({ success: true, regenerated, failed, total: videos.length });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/admin/audit — view audit logs with filters
// PUT /api/admin/users/:id/quota — set storage quota for a user
router.put('/users/:id/quota', (req, res) => {
  try {
    const { quota_gb } = req.body;
    if (quota_gb === undefined || quota_gb < 0) return res.status(400).json({ error: 'quota_gb required (0 = unlimited)' });

    const db = getDb();
    const quotaBytes = Math.round(quota_gb * 1024 * 1024 * 1024);
    db.prepare('UPDATE users SET storage_quota_bytes = ? WHERE id = ?').run(quotaBytes, req.params.id);

    audit.fromReq(req, 'admin.quota_change', 'user', parseInt(req.params.id), { quota_gb });

    res.json({ success: true, quota_bytes: quotaBytes });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/admin/recalculate-storage — recalculate storage_used for all users
router.post('/recalculate-storage', (req, res) => {
  try {
    const db = getDb();
    const users = db.prepare('SELECT id FROM users').all();
    for (const u of users) {
      const total = db.prepare('SELECT COALESCE(SUM(file_size), 0) as total FROM images WHERE user_id = ?').get(u.id);
      db.prepare('UPDATE users SET storage_used_bytes = ? WHERE id = ?').run(total.total, u.id);
    }
    res.json({ success: true, recalculated: users.length });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/admin/generation-stats — AI generation parameter statistics
router.get('/generation-stats', (req, res) => {
  try {
    const db = getDb();

    // Most used models
    const models = db.prepare(`
      SELECT model as name, COUNT(*) as count FROM images
      WHERE model IS NOT NULL AND model != '' GROUP BY model ORDER BY count DESC LIMIT 20
    `).all();

    // Most used samplers
    const samplers = db.prepare(`
      SELECT sampler as name, COUNT(*) as count FROM images
      WHERE sampler IS NOT NULL AND sampler != '' GROUP BY sampler ORDER BY count DESC LIMIT 20
    `).all();

    // Resolution distribution
    const resolutions = db.prepare(`
      SELECT
        CASE
          WHEN width IS NULL OR height IS NULL THEN 'Unknown'
          WHEN width = height THEN 'Square'
          WHEN width > height THEN 'Landscape'
          ELSE 'Portrait'
        END as orientation,
        COUNT(*) as count
      FROM images GROUP BY orientation
    `).all();

    // Media type distribution
    const mediaTypes = db.prepare(`
      SELECT media_type as name, COUNT(*) as count FROM images GROUP BY media_type
    `).all();

    // Uploads over time (last 30 days, grouped by day)
    const uploadsOverTime = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM images
      WHERE created_at >= datetime('now', '-30 days')
      GROUP BY DATE(created_at) ORDER BY date
    `).all();

    // Steps distribution
    const steps = db.prepare(`
      SELECT steps as value, COUNT(*) as count FROM images
      WHERE steps IS NOT NULL GROUP BY steps ORDER BY count DESC LIMIT 15
    `).all();

    // CFG scale distribution
    const cfgScales = db.prepare(`
      SELECT ROUND(cfg_scale, 1) as value, COUNT(*) as count FROM images
      WHERE cfg_scale IS NOT NULL GROUP BY ROUND(cfg_scale, 1) ORDER BY count DESC LIMIT 15
    `).all();

    // Top tags
    const topTags = db.prepare(`
      SELECT t.name, t.category, COUNT(it.image_id) as count
      FROM tags t JOIN image_tags it ON t.id = it.tag_id
      WHERE t.category NOT IN ('model', 'sampler', 'orientation', 'resolution', 'media', 'rating')
      GROUP BY t.id ORDER BY count DESC LIMIT 20
    `).all();

    // Per-user stats
    const perUser = db.prepare(`
      SELECT u.username, u.display_name, COUNT(i.id) as image_count,
        COALESCE(SUM(i.file_size), 0) as storage_bytes
      FROM users u LEFT JOIN images i ON i.user_id = u.id
      GROUP BY u.id ORDER BY image_count DESC
    `).all();

    res.json({ models, samplers, resolutions, mediaTypes, uploadsOverTime, steps, cfgScales, topTags, perUser });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

router.get('/audit', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const result = audit.query({
      userId: req.query.user_id ? parseInt(req.query.user_id) : undefined,
      action: req.query.action || undefined,
      resourceType: req.query.resource_type || undefined,
      limit,
      offset,
    });
    res.json(result);
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// DELETE /api/admin/audit/cleanup — purge old audit logs
router.delete('/audit/cleanup', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 90;
    const cleaned = audit.cleanup(days);
    res.json({ success: true, cleaned });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

module.exports = router;
