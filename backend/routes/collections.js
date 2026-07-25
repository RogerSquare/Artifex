const express = require('express');
const { getDb } = require('../db');
const { requireAuth, optionalAuth } = require('../lib/authMiddleware');
const { remoteMediaUrls } = require('../lib/federation-urls');

const router = express.Router();

// Remote collection entries are addressed as "r<remote_images.id>" in URLs
// and reorder payloads (remote ids would collide with local image ids)
function parseRemoteKey(value) {
  const m = /^r(\d+)$/.exec(String(value));
  return m ? parseInt(m[1]) : null;
}

// GET /api/collections — list user's collections (+ public collections)
router.get('/', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const userId = req.user?.id || null;

    let collections;
    if (userId) {
      // Own collections + public collections from others
      collections = db.prepare(`
        SELECT c.*, u.username as owner_username,
          (SELECT COUNT(*) FROM collection_images WHERE collection_id = c.id) as image_count,
          (SELECT i.filepath FROM images i JOIN collection_images ci ON ci.image_id = i.id WHERE ci.collection_id = c.id ORDER BY ci.sort_order ASC LIMIT 1) as first_image_path
        FROM collections c
        LEFT JOIN users u ON c.user_id = u.id
        WHERE c.user_id = ? OR c.visibility = 'public'
        ORDER BY c.created_at DESC
      `).all(userId);
    } else {
      collections = db.prepare(`
        SELECT c.*, u.username as owner_username,
          (SELECT COUNT(*) FROM collection_images WHERE collection_id = c.id) as image_count,
          (SELECT i.filepath FROM images i JOIN collection_images ci ON ci.image_id = i.id WHERE ci.collection_id = c.id ORDER BY ci.sort_order ASC LIMIT 1) as first_image_path
        FROM collections c
        LEFT JOIN users u ON c.user_id = u.id
        WHERE c.visibility = 'public'
        ORDER BY c.created_at DESC
      `).all();
    }

    // Attach up to 4 preview image paths per collection. Remote entries
    // contribute their locally cached thumbnail as the preview.
    const previewStmt = db.prepare(`
      SELECT * FROM (
        SELECT i.filepath, i.media_type, i.preview_path, ci.sort_order
        FROM collection_images ci JOIN images i ON ci.image_id = i.id
        WHERE ci.collection_id = @cid
        UNION ALL
        SELECT ri.thumbnail_path as filepath, 'image' as media_type, NULL as preview_path, ci.sort_order
        FROM collection_images ci JOIN remote_images ri ON ci.remote_image_id = ri.id
        WHERE ci.collection_id = @cid AND ri.thumbnail_path IS NOT NULL
      ) ORDER BY sort_order ASC LIMIT 4
    `);
    for (const col of collections) {
      col.preview_items = previewStmt.all({ cid: col.id });
    }

    res.json(collections);
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/collections — create a collection
router.post('/', requireAuth, (req, res) => {
  try {
    const { name, description, visibility } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

    const db = getDb();
    const result = db.prepare(
      'INSERT INTO collections (user_id, name, description, visibility) VALUES (?, ?, ?, ?)'
    ).run(req.user.id, name.trim(), description?.trim() || null, visibility === 'public' ? 'public' : 'private');

    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(collection);
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// GET /api/collections/:id — get collection with images
router.get('/:id', optionalAuth, (req, res) => {
  try {
    const db = getDb();
    const userId = req.user?.id || null;

    const collection = db.prepare(`
      SELECT c.*, u.username as owner_username
      FROM collections c LEFT JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `).get(req.params.id);

    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    if (collection.visibility !== 'public' && collection.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const images = db.prepare(`
      SELECT i.*, ci.sort_order, ci.added_at,
        u.username as uploaded_by,
        (SELECT COUNT(*) FROM favorites WHERE image_id = i.id) as favorite_count,
        ${userId ? `(SELECT COUNT(*) FROM favorites WHERE image_id = i.id AND user_id = ${userId}) as is_favorited` : '0 as is_favorited'}
      FROM collection_images ci
      JOIN images i ON ci.image_id = i.id
      LEFT JOIN users u ON i.user_id = u.id
      WHERE ci.collection_id = ? AND ci.image_id IS NOT NULL
      ORDER BY ci.sort_order ASC, ci.added_at DESC
    `).all(req.params.id);

    // Remote entries: referenced remote_images rows, shaped like feed items
    const remoteRows = db.prepare(`
      SELECT ri.*, ci.sort_order, ci.added_at as ci_added_at,
        p.name as peer_name, p.url as peer_url
      FROM collection_images ci
      JOIN remote_images ri ON ci.remote_image_id = ri.id
      JOIN peers p ON ri.peer_id = p.id
      WHERE ci.collection_id = ? AND ci.remote_image_id IS NOT NULL
      ORDER BY ci.sort_order ASC, ci.added_at DESC
    `).all(req.params.id);

    const remoteImages = remoteRows.map(img => ({
      ...img,
      id: img.remote_id,
      remote_row_id: img.id,
      created_at: img.remote_created_at,
      added_at: img.ci_added_at,
      is_remote: true,
      visibility: 'public',
      is_favorited: 0,
      favorite_count: 0,
      tags: img.tags_json ? JSON.parse(img.tags_json) : [],
      ...remoteMediaUrls(img.peer_url, img),
      tags_json: undefined,
      preview_path: undefined,
      filepath: undefined,
      ci_added_at: undefined,
    }));

    const merged = [...images, ...remoteImages].sort((a, b) =>
      (a.sort_order - b.sort_order) || new Date(b.added_at) - new Date(a.added_at)
    );

    res.json({ ...collection, images: merged, image_count: merged.length });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// PUT /api/collections/:id — update collection
router.put('/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    if (!collection) return res.status(404).json({ error: 'Not found' });
    if (collection.user_id !== req.user.id) return res.status(403).json({ error: 'Not your collection' });

    const { name, description, visibility, cover_image_id } = req.body;
    db.prepare(`
      UPDATE collections SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        visibility = COALESCE(?, visibility),
        cover_image_id = COALESCE(?, cover_image_id)
      WHERE id = ?
    `).run(name?.trim() || null, description?.trim() || null, visibility || null, cover_image_id || null, req.params.id);

    const updated = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// DELETE /api/collections/:id — delete collection (not the images)
router.delete('/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    if (!collection) return res.status(404).json({ error: 'Not found' });
    if (collection.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not your collection' });
    }

    db.prepare('DELETE FROM collection_images WHERE collection_id = ?').run(req.params.id);
    db.prepare('DELETE FROM collections WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// POST /api/collections/:id/images — add images to collection.
// imageIds = local image ids; remoteImageIds = remote_images row ids
// (reference-in-place — live-mode peers have no rows and cannot be added).
router.post('/:id/images', requireAuth, (req, res) => {
  try {
    const imageIds = Array.isArray(req.body.imageIds) ? req.body.imageIds : [];
    const remoteImageIds = Array.isArray(req.body.remoteImageIds) ? req.body.remoteImageIds : [];
    if (imageIds.length === 0 && remoteImageIds.length === 0) {
      return res.status(400).json({ error: 'imageIds or remoteImageIds array required' });
    }

    const db = getDb();
    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    if (!collection) return res.status(404).json({ error: 'Not found' });
    if (collection.user_id !== req.user.id) return res.status(403).json({ error: 'Not your collection' });

    const maxOrder = db.prepare('SELECT MAX(sort_order) as max FROM collection_images WHERE collection_id = ?').get(req.params.id)?.max || 0;

    let added = 0;
    let order = maxOrder;
    const insertLocal = db.prepare('INSERT OR IGNORE INTO collection_images (collection_id, image_id, sort_order) VALUES (?, ?, ?)');
    for (const id of imageIds) {
      if (insertLocal.run(req.params.id, id, ++order).changes > 0) added++;
    }

    const insertRemote = db.prepare('INSERT OR IGNORE INTO collection_images (collection_id, remote_image_id, sort_order) VALUES (?, ?, ?)');
    const remoteExists = db.prepare('SELECT 1 as x FROM remote_images WHERE id = ?');
    for (const rid of remoteImageIds) {
      if (!remoteExists.get(rid)) continue; // stale reference (peer resynced/removed)
      if (insertRemote.run(req.params.id, rid, ++order).changes > 0) added++;
    }

    // Auto-set cover if none (local images only — cover_image_id FKs images)
    if (!collection.cover_image_id && imageIds.length > 0) {
      db.prepare('UPDATE collections SET cover_image_id = ? WHERE id = ? AND cover_image_id IS NULL').run(imageIds[0], req.params.id);
    }

    res.json({ success: true, added });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// PUT /api/collections/:id/reorder — reorder images in collection
router.put('/:id/reorder', requireAuth, (req, res) => {
  try {
    const { imageIds } = req.body;
    if (!Array.isArray(imageIds)) return res.status(400).json({ error: 'imageIds array required' });

    const db = getDb();
    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    if (!collection) return res.status(404).json({ error: 'Not found' });
    if (collection.user_id !== req.user.id) return res.status(403).json({ error: 'Not your collection' });

    // Entries may be local ids (numbers) or remote keys ("r<rowid>")
    const localStmt = db.prepare('UPDATE collection_images SET sort_order = ? WHERE collection_id = ? AND image_id = ?');
    const remoteStmt = db.prepare('UPDATE collection_images SET sort_order = ? WHERE collection_id = ? AND remote_image_id = ?');
    const updateAll = db.transaction(() => {
      for (let i = 0; i < imageIds.length; i++) {
        const remoteId = parseRemoteKey(imageIds[i]);
        if (remoteId !== null) remoteStmt.run(i, req.params.id, remoteId);
        else localStmt.run(i, req.params.id, imageIds[i]);
      }
    });
    updateAll();

    res.json({ success: true });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

// DELETE /api/collections/:id/images/:imageId — remove image from collection
router.delete('/:id/images/:imageId', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const collection = db.prepare('SELECT * FROM collections WHERE id = ?').get(req.params.id);
    if (!collection) return res.status(404).json({ error: 'Not found' });
    if (collection.user_id !== req.user.id) return res.status(403).json({ error: 'Not your collection' });

    const remoteId = parseRemoteKey(req.params.imageId);
    if (remoteId !== null) {
      db.prepare('DELETE FROM collection_images WHERE collection_id = ? AND remote_image_id = ?').run(req.params.id, remoteId);
    } else {
      db.prepare('DELETE FROM collection_images WHERE collection_id = ? AND image_id = ?').run(req.params.id, req.params.imageId);

      // If removed image was cover, clear it (covers are local-only)
      if (collection.cover_image_id === parseInt(req.params.imageId)) {
        const next = db.prepare('SELECT image_id FROM collection_images WHERE collection_id = ? AND image_id IS NOT NULL ORDER BY sort_order ASC LIMIT 1').get(req.params.id);
        db.prepare('UPDATE collections SET cover_image_id = ? WHERE id = ?').run(next?.image_id || null, req.params.id);
      }
    }

    res.json({ success: true });
  } catch (error) {
    const logger = require("../lib/logger"); logger.error(error.message, { stack: error.stack, path: req.path }); res.status(500).json({ error: "An internal error occurred" });
  }
});

module.exports = router;
