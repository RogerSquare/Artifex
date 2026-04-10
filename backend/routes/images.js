const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getDb } = require('../db');
const { extractMetadata, extractVideoMetadata } = require('../lib/metadata');
const { generateThumbnail, isVideo } = require('../lib/thumbnail');
const { requireAuth, optionalAuth } = require('../lib/authMiddleware');
const { applyMetadataTags } = require('../lib/tagger');
const jobQueue = require('../lib/job-queue');
const audit = require('../lib/audit');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const THUMBNAILS_DIR = path.join(UPLOADS_DIR, 'thumbnails');

// Multer config — save with unique filenames to avoid collisions
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const hash = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${hash}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max (videos can be large)
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm', '.mov'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Unsupported format: ${ext}`));
  }
});

// POST /api/images/upload — single or multiple image upload (auth required)
router.post('/upload', requireAuth, upload.array('images', 50), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No images provided' });
  }

  const db = getDb();

  // Check storage quota
  const userQuota = db.prepare('SELECT storage_quota_bytes, storage_used_bytes FROM users WHERE id = ?').get(req.user.id);
  if (userQuota && userQuota.storage_quota_bytes > 0) {
    const uploadSize = req.files.reduce((sum, f) => sum + f.size, 0);
    if (userQuota.storage_used_bytes + uploadSize > userQuota.storage_quota_bytes) {
      // Clean up uploaded temp files
      for (const f of req.files) { try { fs.unlinkSync(f.path); } catch (e) {} }
      const used = (userQuota.storage_used_bytes / 1024 / 1024 / 1024).toFixed(2);
      const quota = (userQuota.storage_quota_bytes / 1024 / 1024 / 1024).toFixed(2);
      return res.status(413).json({ error: `Storage quota exceeded (${used}GB / ${quota}GB)` });
    }
  }
  const insertStmt = db.prepare(`
    INSERT INTO images (user_id, filename, original_name, filepath, thumbnail_path, preview_path, analysis_path, title, width, height, file_size, format,
      has_metadata, metadata_raw, prompt, negative_prompt, model, sampler, steps, cfg_scale, seed, prompt_json, workflow_json, media_type, duration, video_metadata, file_hash)
    VALUES (@user_id, @filename, @original_name, @filepath, @thumbnail_path, @preview_path, @analysis_path, @title, @width, @height, @file_size, @format,
      @has_metadata, @metadata_raw, @prompt, @negative_prompt, @model, @sampler, @steps, @cfg_scale, @seed, @prompt_json, @workflow_json, @media_type, @duration, @video_metadata, @file_hash)
  `);

  const skipDuplicates = req.query.skip_duplicates !== 'false'; // default: skip dupes
  const results = [];

  for (const file of req.files) {
    try {
      // Compute SHA-256 hash via stream (non-blocking, doesn't hold entire file in memory)
      const fileHash = await new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(file.path);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
      });

      // Check for existing duplicate
      const existing = db.prepare('SELECT id, filename, original_name, thumbnail_path, file_hash FROM images WHERE file_hash = ?').get(fileHash);
      if (existing && skipDuplicates) {
        // Remove the uploaded file since we're skipping
        fs.unlinkSync(file.path);
        results.push({ duplicate: true, existing_id: existing.id, original_name: file.originalname, existing_name: existing.original_name, thumbnail_path: existing.thumbnail_path });
        continue;
      }

      const mediaType = isVideo(file.originalname) ? 'video' : 'image';

      // Extract metadata — different extraction for images vs videos
      const meta = mediaType === 'image'
        ? await extractMetadata(file.path)
        : await extractVideoMetadata(file.path);

      // Generate thumbnail (handles both images and videos)
      const { width, height, thumbPath, duration, previewPath, analysisPath } = await generateThumbnail(
        file.path, THUMBNAILS_DIR, file.filename
      );

      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      const title = path.basename(file.originalname, path.extname(file.originalname));

      const record = {
        user_id: req.user.id,
        filename: file.filename,
        original_name: file.originalname,
        filepath: file.filename,
        thumbnail_path: thumbPath ? `thumbnails/${thumbPath}` : null,
        preview_path: previewPath || null,
        analysis_path: analysisPath || null,
        title,
        width,
        height,
        file_size: file.size,
        format: ext,
        has_metadata: meta.has_metadata ? 1 : 0,
        metadata_raw: meta.metadata_raw || null,
        prompt: meta.prompt || null,
        negative_prompt: meta.negative_prompt || null,
        model: meta.model || null,
        sampler: meta.sampler || null,
        steps: meta.steps || null,
        cfg_scale: meta.cfg_scale || null,
        seed: meta.seed || null,
        prompt_json: meta.prompt_json || null,
        workflow_json: meta.workflow_json || null,
        media_type: mediaType,
        duration: duration || null,
        video_metadata: meta.video_metadata ? JSON.stringify(meta.video_metadata) : null,
        file_hash: fileHash,
      };

      const info = insertStmt.run(record);
      const imageId = info.lastInsertRowid;

      // Auto-tag from metadata (synchronous, fast)
      try { applyMetadataTags(imageId, record); } catch (e) { console.error('Metadata tagging failed:', e.message); }

      // Enqueue background ML jobs (nsfw, vision, caption)
      jobQueue.enqueueImageJobs(imageId);

      results.push({ id: imageId, ...record });
    } catch (err) {
      console.error(`Failed to process ${file.originalname}:`, err.message);
      results.push({ error: err.message, filename: file.originalname });
    }
  }

  const uploaded = results.filter(r => !r.error && !r.duplicate).length;
  const duplicates = results.filter(r => r.duplicate).length;
  const failed = results.filter(r => r.error).length;

  if (uploaded > 0) {
    // Update storage used
    const addedBytes = results.filter(r => !r.error && !r.duplicate).reduce((sum, r) => sum + (r.file_size || 0), 0);
    if (addedBytes > 0) {
      db.prepare('UPDATE users SET storage_used_bytes = storage_used_bytes + ? WHERE id = ?').run(addedBytes, req.user.id);
    }
    audit.fromReq(req, 'image.upload', 'image', null, { uploaded, duplicates, failed });
  }

  res.status(201).json({ success: true, uploaded, duplicates, failed, images: results });
});

// Helper to build image queries with common filters
function buildImageQuery(req, extraConditions = [], extraParams = {}, extraJoins = '', customOrder = null) {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const sort = req.query.sort === 'oldest' ? 'ASC' : 'DESC';
  const userId = req.user?.id || null;

  const conditions = [...extraConditions];
  const params = { ...extraParams };

  if (req.query.model) { conditions.push('i.model = @model'); params.model = req.query.model; }
  if (req.query.sampler) { conditions.push('i.sampler = @sampler'); params.sampler = req.query.sampler; }
  if (req.query.has_metadata === 'true') conditions.push('i.has_metadata = 1');
  else if (req.query.has_metadata === 'false') conditions.push('i.has_metadata = 0');
  if (req.query.media_type === 'image') conditions.push("i.media_type = 'image'");
  else if (req.query.media_type === 'video') conditions.push("i.media_type = 'video'");
  if (req.query.tag) {
    conditions.push('i.id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON it.tag_id = t.id WHERE t.name = @tagFilter)');
    params.tagFilter = req.query.tag.toLowerCase();
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Include is_favorited (for current user) and favorite_count
  const favSelect = userId
    ? `, CASE WHEN fav_me.id IS NOT NULL THEN 1 ELSE 0 END as is_favorited`
    : ', 0 as is_favorited';
  const favJoin = userId
    ? `LEFT JOIN favorites fav_me ON fav_me.image_id = i.id AND fav_me.user_id = ${userId}`
    : '';
  const countSelect = ', (SELECT COUNT(*) FROM favorites WHERE image_id = i.id) as favorite_count, (SELECT COUNT(*) FROM comments WHERE image_id = i.id) as comment_count';

  const total = db.prepare(`SELECT COUNT(*) as count FROM images i ${extraJoins} ${where}`).get(params);
  const images = db.prepare(
    `SELECT i.id, i.filename, i.original_name, i.filepath, i.thumbnail_path, i.title, i.width, i.height, i.file_size, i.format,
      i.has_metadata, i.prompt, i.model, i.sampler, i.steps, i.cfg_scale, i.seed, i.created_at, i.user_id, i.visibility, i.media_type, i.duration, i.preview_path,
      u.username as uploaded_by ${favSelect} ${countSelect}
     FROM images i LEFT JOIN users u ON i.user_id = u.id ${favJoin} ${extraJoins} ${where} ORDER BY ${customOrder || `i.created_at ${sort}`} LIMIT @limit OFFSET @offset`
  ).all({ ...params, limit, offset });

  return { total: total.count, limit, offset, images };
}

// GET /api/images — all images visible to the current user (public + own private)
router.get('/', optionalAuth, (req, res) => {
  try {
    const conditions = [];
    const params = {};

    if (req.user) {
      // Logged in: see public images + own images (public or private)
      conditions.push("(i.visibility = 'public' OR i.user_id = @user_id)");
      params.user_id = req.user.id;
    } else {
      // Not logged in: public only
      conditions.push("i.visibility = 'public'");
    }

    res.json(buildImageQuery(req, conditions, params));
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/images/public — public gallery feed (local public + federated)
router.get('/public', (req, res) => {
  try {
    const result = buildImageQuery(req, ["i.visibility = 'public'"]);

    // Include federated images if federation is enabled
    const includeFederated = req.query.include_federated !== 'false';
    if (includeFederated) {
      try {
        const db = getDb();
        const fedEnabled = db.prepare("SELECT value FROM instance_settings WHERE key = 'federation_enabled'").get();
        if (fedEnabled?.value === 'true') {
          const limit = Math.min(parseInt(req.query.limit) || 50, 200);
          const offset = parseInt(req.query.offset) || 0;

          const remoteImages = db.prepare(`
            SELECT ri.remote_id as id, ri.title, ri.width, ri.height, ri.format, ri.media_type,
              ri.caption, ri.remote_created_at as created_at, ri.uploaded_by,
              ri.thumbnail_path, ri.thumbnail_cached, ri.tags_json, ri.metadata_json,
              ri.peer_id, p.name as peer_name, p.url as peer_url
            FROM remote_images ri JOIN peers p ON ri.peer_id = p.id
            WHERE p.status = 'active'
            ORDER BY ri.remote_created_at DESC LIMIT ? OFFSET ?
          `).all(limit, offset);

          const enriched = remoteImages.map(img => ({
            ...img,
            is_remote: true,
            visibility: 'public',
            is_favorited: false,
            favorite_count: 0,
            comment_count: 0,
            tags: img.tags_json ? JSON.parse(img.tags_json) : [],
            prompt: img.metadata_json ? JSON.parse(img.metadata_json).prompt : null,
            model: img.metadata_json ? JSON.parse(img.metadata_json).model : null,
            sampler: img.metadata_json ? JSON.parse(img.metadata_json).sampler : null,
            tags_json: undefined,
            metadata_json: undefined,
          }));

          // Merge and sort by created_at
          const merged = [...result.images, ...enriched]
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, limit);

          const remoteTotal = db.prepare('SELECT COUNT(*) as c FROM remote_images ri JOIN peers p ON ri.peer_id = p.id WHERE p.status = ?').get('active');
          result.images = merged;
          result.total = result.total + (remoteTotal?.c || 0);
          result.includes_federated = true;
        }
      } catch (e) {
        // Federation query failure shouldn't break the public feed
      }
    }

    res.json(result);
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/images/mine — current user's images (public + private)
router.get('/mine', requireAuth, (req, res) => {
  try {
    res.json(buildImageQuery(req, ['i.user_id = @user_id'], { user_id: req.user.id }));
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/images/favorites — current user's favorited images
router.get('/favorites', requireAuth, (req, res) => {
  try {
    res.json(buildImageQuery(req,
      ['fav_filter.id IS NOT NULL'],
      {},
      'INNER JOIN favorites fav_filter ON fav_filter.image_id = i.id AND fav_filter.user_id = ' + req.user.id,
      'fav_filter.sort_order ASC, fav_filter.created_at DESC'
    ));
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/images/search — full-text search using FTS5 (with LIKE fallback)
router.get('/search', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const q = req.query.q || '';
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.user?.id || null;

    if (!q.trim()) {
      return res.status(400).json({ error: 'Search query (q) is required' });
    }

    // Sanitize FTS query: escape double quotes, wrap terms for prefix matching
    const ftsQuery = q.trim().split(/\s+/).map(term => `"${term.replace(/"/g, '""')}"*`).join(' ');

    // Include favorite status
    const favSelect = userId
      ? `, CASE WHEN fav_me.id IS NOT NULL THEN 1 ELSE 0 END as is_favorited`
      : ', 0 as is_favorited';
    const favJoin = userId
      ? `LEFT JOIN favorites fav_me ON fav_me.image_id = i.id AND fav_me.user_id = ${userId}`
      : '';

    // Also search tags via a subquery
    const tagMatch = `i.id IN (SELECT it.image_id FROM image_tags it JOIN tags t ON it.tag_id = t.id WHERE t.name LIKE @likeTerm)`;

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM images i
      WHERE (i.id IN (SELECT rowid FROM images_fts WHERE images_fts MATCH @fts) OR ${tagMatch})
        AND (i.visibility = 'public' OR i.user_id = @userId)
    `).get({ fts: ftsQuery, likeTerm: `%${q}%`, userId });

    const images = db.prepare(`
      SELECT i.id, i.filename, i.original_name, i.filepath, i.thumbnail_path, i.title, i.width, i.height,
        i.file_size, i.format, i.has_metadata, i.prompt, i.model, i.sampler, i.steps, i.cfg_scale, i.seed,
        i.created_at, i.user_id, i.visibility, i.media_type, i.duration, i.preview_path, i.caption,
        u.username as uploaded_by,
        (SELECT COUNT(*) FROM favorites WHERE image_id = i.id) as favorite_count,
        (SELECT COUNT(*) FROM comments WHERE image_id = i.id) as comment_count
        ${favSelect}
      FROM images i
      LEFT JOIN users u ON i.user_id = u.id
      ${favJoin}
      WHERE (i.id IN (SELECT rowid FROM images_fts WHERE images_fts MATCH @fts) OR ${tagMatch})
        AND (i.visibility = 'public' OR i.user_id = @userId)
      ORDER BY i.created_at DESC LIMIT @limit OFFSET @offset
    `).all({ fts: ftsQuery, likeTerm: `%${q}%`, userId, limit, offset });

    res.json({ total: total.count, limit, offset, query: q, images });
  } catch (error) {
    // Fallback to LIKE if FTS fails (e.g., malformed query)
    try {
      const db = getDb();
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const offset = parseInt(req.query.offset) || 0;
      const searchTerm = `%${req.query.q}%`;

      const total = db.prepare(
        `SELECT COUNT(*) as count FROM images WHERE title LIKE @q OR prompt LIKE @q OR model LIKE @q OR original_name LIKE @q OR caption LIKE @q`
      ).get({ q: searchTerm });

      const images = db.prepare(
        `SELECT id, filename, original_name, filepath, thumbnail_path, title, width, height, file_size, format,
          has_metadata, prompt, model, sampler, created_at, user_id, visibility, media_type, duration, preview_path, caption
         FROM images WHERE title LIKE @q OR prompt LIKE @q OR model LIKE @q OR original_name LIKE @q OR caption LIKE @q
         ORDER BY created_at DESC LIMIT @limit OFFSET @offset`
      ).all({ q: searchTerm, limit, offset });

      res.json({ total: total.count, limit, offset, query: req.query.q, images });
    } catch (fallbackError) {
      res.status(500).json({ error: fallbackError.message });
    }
  }
});

// GET /api/images/tags — unique models and samplers scoped to visible images
router.get('/tags', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const userId = req.user?.id;
    const tab = req.query.tab || 'all';

    // Build WHERE clause matching the same visibility rules as the list endpoints
    let where = '';
    const params = {};
    if (tab === 'mine' && userId) {
      where = 'WHERE user_id = @userId';
      params.userId = userId;
    } else if (tab === 'public') {
      where = "WHERE visibility = 'public'";
    } else if (tab === 'favorites' && userId) {
      where = `WHERE id IN (SELECT image_id FROM favorites WHERE user_id = ${userId})`;
    } else if (userId) {
      where = "WHERE (visibility = 'public' OR user_id = @userId)";
      params.userId = userId;
    } else {
      where = "WHERE visibility = 'public'";
    }

    const models = db.prepare(`SELECT DISTINCT model FROM images ${where} AND model IS NOT NULL ORDER BY model`).all(params).map(r => r.model);
    const samplers = db.prepare(`SELECT DISTINCT sampler FROM images ${where} AND sampler IS NOT NULL ORDER BY sampler`).all(params).map(r => r.sampler);

    res.json({ models, samplers });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// PUT /api/images/batch/visibility — bulk visibility update (owner only)
router.put('/batch/visibility', requireAuth, (req, res) => {
  try {
    const { ids, visibility } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids (array) is required' });
    }
    if (!['public', 'private'].includes(visibility)) {
      return res.status(400).json({ error: 'visibility must be "public" or "private"' });
    }

    const db = getDb();
    let updated = 0;
    let skipped = 0;

    const updateStmt = db.prepare('UPDATE images SET visibility = ? WHERE id = ? AND user_id = ?');

    for (const id of ids) {
      const result = updateStmt.run(visibility, id, req.user.id);
      if (result.changes > 0) updated++;
      else skipped++;
    }

    res.json({ success: true, updated, skipped });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// DELETE /api/images/batch — bulk delete (owner only)
router.delete('/batch', requireAuth, (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids (array) is required' });
    }

    const db = getDb();
    let deleted = 0;
    let skipped = 0;

    for (const id of ids) {
      const image = db.prepare('SELECT * FROM images WHERE id = ? AND user_id = ?').get(id, req.user.id);
      if (!image) { skipped++; continue; }

      const originalPath = path.join(UPLOADS_DIR, image.filepath);
      if (fs.existsSync(originalPath)) fs.unlinkSync(originalPath);
      if (image.thumbnail_path) {
        const thumbPath = path.join(UPLOADS_DIR, image.thumbnail_path);
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      }

      db.prepare('DELETE FROM images WHERE id = ?').run(id);
      deleted++;
    }

    res.json({ success: true, deleted, skipped });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/images/:id/favorite — toggle favorite on/off
router.post('/:id/favorite', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const imageId = req.params.id;
    const userId = req.user.id;

    const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND image_id = ?').get(userId, imageId);

    if (existing) {
      db.prepare('DELETE FROM favorites WHERE user_id = ? AND image_id = ?').run(userId, imageId);
      res.json({ success: true, favorited: false });
    } else {
      db.prepare('INSERT INTO favorites (user_id, image_id) VALUES (?, ?)').run(userId, imageId);
      res.json({ success: true, favorited: true });
    }
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// PUT /api/images/favorites/reorder — reorder favorited images
router.put('/favorites/reorder', requireAuth, (req, res) => {
  try {
    const { imageIds } = req.body;
    if (!Array.isArray(imageIds)) return res.status(400).json({ error: 'imageIds array required' });

    const db = getDb();
    const stmt = db.prepare('UPDATE favorites SET sort_order = ? WHERE user_id = ? AND image_id = ?');
    const updateAll = db.transaction(() => {
      for (let i = 0; i < imageIds.length; i++) {
        stmt.run(i, req.user.id, imageIds[i]);
      }
    });
    updateAll();

    res.json({ success: true });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/images/duplicates — find duplicate images by file hash
router.get('/duplicates', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const dupes = db.prepare(`
      SELECT file_hash, COUNT(*) as count, GROUP_CONCAT(id) as image_ids,
        GROUP_CONCAT(original_name, '||') as names
      FROM images
      WHERE file_hash IS NOT NULL AND user_id = ?
      GROUP BY file_hash
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `).all(req.user.id);

    const groups = dupes.map(d => ({
      file_hash: d.file_hash,
      count: d.count,
      image_ids: d.image_ids.split(',').map(Number),
      names: d.names.split('||')
    }));

    res.json({ duplicates: groups, total_groups: groups.length });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/images/:id/comments — list comments for an image
router.get('/:id/comments', (req, res) => {
  try {
    const db = getDb();
    const comments = db.prepare(`
      SELECT c.id, c.content, c.created_at, c.user_id,
        u.username, u.display_name, u.avatar
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.image_id = ?
      ORDER BY c.created_at ASC
    `).all(req.params.id);
    res.json(comments);
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/images/:id/comments — add a comment (auth required)
router.post('/:id/comments', requireAuth, (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Comment content is required' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ error: 'Comment too long (max 2000 characters)' });
    }

    const db = getDb();
    const result = db.prepare('INSERT INTO comments (user_id, image_id, content) VALUES (?, ?, ?)').run(req.user.id, req.params.id, content.trim());

    const comment = db.prepare(`
      SELECT c.id, c.content, c.created_at, c.user_id,
        u.username, u.display_name, u.avatar
      FROM comments c LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(comment);
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// DELETE /api/images/:id/comments/:commentId — delete a comment (owner or admin)
router.delete('/:id/comments/:commentId', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const comment = db.prepare('SELECT user_id FROM comments WHERE id = ?').get(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Cannot delete this comment' });
    }

    db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.commentId);
    res.json({ success: true });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/images/:id — single image with full metadata (respects visibility)
router.get('/:id', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const userId = req.user?.id || null;
    const image = db.prepare(
      `SELECT i.*, u.username as uploaded_by,
        (SELECT COUNT(*) FROM favorites WHERE image_id = i.id) as favorite_count,
        (SELECT COUNT(*) FROM comments WHERE image_id = i.id) as comment_count
       FROM images i LEFT JOIN users u ON i.user_id = u.id WHERE i.id = ?`
    ).get(req.params.id);

    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Private images only visible to owner
    if (image.visibility === 'private' && (!req.user || image.user_id !== req.user.id)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Add is_favorited for current user
    image.is_favorited = userId
      ? !!db.prepare('SELECT id FROM favorites WHERE user_id = ? AND image_id = ?').get(userId, req.params.id)
      : false;

    // Add tags
    image.tags = db.prepare(`
      SELECT t.id, t.name, t.category, it.source
      FROM image_tags it JOIN tags t ON it.tag_id = t.id
      WHERE it.image_id = ? ORDER BY t.category, t.name
    `).all(req.params.id);

    // Add job queue status (pending/processing jobs indicate tagging in progress)
    const pendingJobs = db.prepare("SELECT type, status FROM jobs WHERE image_id = ? AND status IN ('pending', 'processing')").all(req.params.id);
    if (pendingJobs.length > 0) {
      image.tagging_status = 'processing';
      image.pending_jobs = pendingJobs.map(j => j.type);
    } else {
      image.tagging_status = 'done';
    }

    res.json(image);
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// PUT /api/images/:id/visibility — toggle public/private (owner only)
router.put('/:id/visibility', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const { visibility } = req.body;

    if (!['public', 'private'].includes(visibility)) {
      return res.status(400).json({ error: 'visibility must be "public" or "private"' });
    }

    const image = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id);
    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    if (image.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only change visibility of your own images' });
    }

    db.prepare('UPDATE images SET visibility = ? WHERE id = ?').run(visibility, req.params.id);
    audit.fromReq(req, 'image.visibility', 'image', parseInt(req.params.id), { visibility });
    res.json({ success: true, visibility });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// DELETE /api/images/:id — delete image and files (owner or admin)
router.delete('/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const image = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id);

    if (!image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Only owner or admin can delete
    if (image.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only delete your own images' });
    }

    // DB deletes in transaction (atomic)
    const deleteImage = db.transaction(() => {
      db.prepare('DELETE FROM jobs WHERE image_id = ?').run(req.params.id);
      db.prepare('DELETE FROM image_tags WHERE image_id = ?').run(req.params.id);
      db.prepare('DELETE FROM favorites WHERE image_id = ?').run(req.params.id);
      db.prepare('DELETE FROM comments WHERE image_id = ?').run(req.params.id);
      db.prepare('DELETE FROM collection_images WHERE image_id = ?').run(req.params.id);
      db.prepare('DELETE FROM images WHERE id = ?').run(req.params.id);
    });
    deleteImage();

    // Delete files AFTER transaction commits
    const filesToDelete = [image.filepath, image.thumbnail_path, image.preview_path, image.analysis_path].filter(Boolean);
    for (const f of filesToDelete) {
      try { const fp = path.join(UPLOADS_DIR, f); if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
    }

    // Update storage used
    if (image.user_id && image.file_size) {
      db.prepare('UPDATE users SET storage_used_bytes = MAX(0, storage_used_bytes - ?) WHERE id = ?').run(image.file_size, image.user_id);
    }

    audit.fromReq(req, 'image.delete', 'image', parseInt(req.params.id), { filename: image.original_name });

    res.json({ success: true });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/images/import — batch import from a folder path
router.post('/import', async (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath) {
    return res.status(400).json({ error: 'folderPath is required' });
  }

  if (!fs.existsSync(folderPath)) {
    return res.status(400).json({ error: 'Folder does not exist' });
  }

  const stat = fs.statSync(folderPath);
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'Path is not a directory' });
  }

  const ALLOWED_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
  const db = getDb();

  // Collect all image files recursively
  const imageFiles = [];
  const scanDir = (dir) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          scanDir(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ALLOWED_EXTS.includes(ext)) {
            imageFiles.push(fullPath);
          }
        }
      }
    } catch (err) { /* skip unreadable dirs */ }
  };
  scanDir(folderPath);

  if (imageFiles.length === 0) {
    return res.json({ success: true, imported: 0, skipped: 0, errors: 0, message: 'No image files found' });
  }

  // Get already-imported original names to skip duplicates
  const existingNames = new Set(
    db.prepare('SELECT original_name FROM images').all().map(r => r.original_name)
  );

  const insertStmt = db.prepare(`
    INSERT INTO images (filename, original_name, filepath, thumbnail_path, title, width, height, file_size, format,
      has_metadata, metadata_raw, prompt, negative_prompt, model, sampler, steps, cfg_scale, seed, prompt_json, workflow_json)
    VALUES (@filename, @original_name, @filepath, @thumbnail_path, @title, @width, @height, @file_size, @format,
      @has_metadata, @metadata_raw, @prompt, @negative_prompt, @model, @sampler, @steps, @cfg_scale, @seed, @prompt_json, @workflow_json)
  `);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const srcPath of imageFiles) {
    const originalName = path.basename(srcPath);

    // Skip if already imported
    if (existingNames.has(originalName)) {
      skipped++;
      continue;
    }

    try {
      // Copy file to uploads directory with unique name
      const ext = path.extname(originalName).toLowerCase();
      const hash = crypto.randomBytes(8).toString('hex');
      const destFilename = `${Date.now()}-${hash}${ext}`;
      const destPath = path.join(UPLOADS_DIR, destFilename);
      fs.copyFileSync(srcPath, destPath);

      // Extract metadata from the copy
      const meta = await extractMetadata(destPath);

      // Generate thumbnail
      const { width, height, thumbPath } = await generateThumbnail(
        destPath, THUMBNAILS_DIR, destFilename
      );

      const format = ext.replace('.', '');
      const fileSize = fs.statSync(destPath).size;
      const title = path.basename(originalName, ext);

      const record = {
        filename: destFilename,
        original_name: originalName,
        filepath: destFilename,
        thumbnail_path: `thumbnails/${thumbPath}`,
        title,
        width,
        height,
        file_size: fileSize,
        format,
        has_metadata: meta.has_metadata ? 1 : 0,
        metadata_raw: meta.metadata_raw,
        prompt: meta.prompt,
        negative_prompt: meta.negative_prompt,
        model: meta.model,
        sampler: meta.sampler,
        steps: meta.steps,
        cfg_scale: meta.cfg_scale,
        seed: meta.seed,
        prompt_json: meta.prompt_json,
        workflow_json: meta.workflow_json,
      };

      insertStmt.run(record);
      existingNames.add(originalName);
      imported++;
    } catch (err) {
      console.error(`Import failed for ${originalName}:`, err.message);
      errors++;
    }
  }

  res.json({
    success: true,
    imported,
    skipped,
    errors,
    total_scanned: imageFiles.length,
    message: `Imported ${imported} images, skipped ${skipped} duplicates, ${errors} errors`
  });
});

module.exports = router;
