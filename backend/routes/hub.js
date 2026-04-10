/**
 * Hub/Directory Service routes.
 * When hub_mode is enabled, this instance acts as a lightweight index
 * that aggregates metadata from registered Artifex instances.
 *
 * The hub stores only metadata + thumbnail URLs — no original images.
 * It crawls registered instances periodically and serves a unified feed.
 */

const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../lib/authMiddleware');

const router = express.Router();

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM instance_settings WHERE key = ?').get(key);
  return row?.value || null;
}

function isHubMode() {
  return getSetting('hub_mode') === 'true';
}

function requireHub(req, res, next) {
  if (!isHubMode()) return res.status(403).json({ error: 'Hub mode is not enabled on this instance' });
  next();
}

// ─── Public Hub Endpoints ───

// POST /api/hub/register — instance registers itself with the hub
router.post('/register', requireHub, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    const cleanUrl = url.replace(/\/+$/, '');

    // Fetch manifest to verify
    const http = require('http');
    const https = require('https');
    const manifest = await new Promise((resolve, reject) => {
      const client = cleanUrl.startsWith('https') ? https : http;
      client.get(`${cleanUrl}/api/federation/manifest`, { timeout: 10000 }, (r) => {
        if (r.statusCode !== 200) return reject(new Error(`HTTP ${r.statusCode}`));
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } });
      }).on('error', reject);
    });

    if (!manifest.id) return res.status(400).json({ error: 'Invalid Artifex instance' });

    const db = getDb();

    // Upsert instance
    db.prepare(`
      INSERT INTO hub_instances (instance_id, name, url, description, image_count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(instance_id) DO UPDATE SET
        name=excluded.name, url=excluded.url, description=excluded.description,
        image_count=excluded.image_count, status='active', error=NULL
    `).run(manifest.id, manifest.name, cleanUrl, manifest.description || '', manifest.stats?.public_images || 0);

    // Also add as a peer for syncing
    const existingPeer = db.prepare('SELECT id FROM peers WHERE url = ?').get(cleanUrl);
    if (!existingPeer) {
      db.prepare('INSERT INTO peers (instance_id, name, url) VALUES (?, ?, ?)').run(manifest.id, manifest.name, cleanUrl);
    }

    // Return a registration token (just the instance_id for now)
    res.json({
      success: true,
      hub: { name: getSetting('instance_name'), url: getSetting('instance_url') },
      registration_token: manifest.id,
    });
  } catch (error) {
    res.status(400).json({ error: `Registration failed: ${error.message}` });
  }
});

// GET /api/hub/instances — list all registered instances
router.get('/instances', requireHub, (req, res) => {
  try {
    const db = getDb();
    const instances = db.prepare("SELECT * FROM hub_instances WHERE status != 'blocked' ORDER BY image_count DESC").all();
    res.json({ instances, total: instances.length });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// GET /api/hub/instance/:id — single instance detail
router.get('/instance/:id', requireHub, (req, res) => {
  try {
    const db = getDb();
    const instance = db.prepare('SELECT * FROM hub_instances WHERE id = ?').get(req.params.id);
    if (!instance) return res.status(404).json({ error: 'Instance not found' });

    // Get remote images from this instance (via peer)
    const peer = db.prepare('SELECT id FROM peers WHERE instance_id = ?').get(instance.instance_id);
    let images = [];
    if (peer) {
      images = db.prepare('SELECT * FROM remote_images WHERE peer_id = ? ORDER BY remote_created_at DESC LIMIT 50').all(peer.id);
      images = images.map(img => ({
        ...img,
        tags: img.tags_json ? JSON.parse(img.tags_json) : [],
        metadata: img.metadata_json ? JSON.parse(img.metadata_json) : {},
        tags_json: undefined, metadata_json: undefined,
      }));
    }

    res.json({ instance, images });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// GET /api/hub/explore — paginated feed from all registered instances
router.get('/explore', requireHub, (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const total = db.prepare('SELECT COUNT(*) as c FROM remote_images').get();

    const images = db.prepare(`
      SELECT ri.*, p.name as peer_name, p.url as peer_url,
        hi.name as instance_name, hi.instance_id as instance_uuid
      FROM remote_images ri
      JOIN peers p ON ri.peer_id = p.id
      LEFT JOIN hub_instances hi ON p.instance_id = hi.instance_id
      ORDER BY ri.remote_created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const enriched = images.map(img => ({
      ...img,
      tags: img.tags_json ? JSON.parse(img.tags_json) : [],
      metadata: img.metadata_json ? JSON.parse(img.metadata_json) : {},
      tags_json: undefined, metadata_json: undefined,
    }));

    res.json({ images: enriched, total: total.c, limit, offset });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// GET /api/hub/search?q=term — search across all federated content
router.get('/search', requireHub, (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'q parameter required' });

    const db = getDb();
    const searchTerm = `%${q.toLowerCase()}%`;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const images = db.prepare(`
      SELECT ri.*, p.name as peer_name, p.url as peer_url
      FROM remote_images ri JOIN peers p ON ri.peer_id = p.id
      WHERE LOWER(ri.title) LIKE ? OR LOWER(ri.caption) LIKE ? OR LOWER(ri.tags_json) LIKE ?
      ORDER BY ri.remote_created_at DESC LIMIT ?
    `).all(searchTerm, searchTerm, searchTerm, limit);

    const enriched = images.map(img => ({
      ...img,
      tags: img.tags_json ? JSON.parse(img.tags_json) : [],
      metadata: img.metadata_json ? JSON.parse(img.metadata_json) : {},
      tags_json: undefined, metadata_json: undefined,
    }));

    res.json({ images: enriched, total: enriched.length, query: q });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// ─── Admin Hub Controls ───

// GET /api/hub/settings — hub mode settings
router.get('/settings', requireAuth, (req, res) => {
  res.json({ hub_mode: isHubMode() });
});

// PUT /api/hub/settings — toggle hub mode
router.put('/settings', requireAuth, (req, res) => {
  try {
    const { hub_mode } = req.body;
    if (hub_mode !== undefined) {
      getDb().prepare("INSERT OR REPLACE INTO instance_settings (key, value) VALUES ('hub_mode', ?)").run(hub_mode ? 'true' : 'false');
    }
    const audit = require('../lib/audit');
    audit.fromReq(req, 'admin.hub_settings', 'instance', null, { hub_mode });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// DELETE /api/hub/instances/:id — remove an instance from the hub
router.delete('/instances/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM hub_instances WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// ─── Relay: Push/Pull for No-Domain Instances ───
// Instances without public URLs push their metadata to the hub.
// They only need outbound internet — no domain, no port forwarding.

// POST /api/hub/push — instance pushes its public images to the hub
router.post('/push', requireHub, express.json({ limit: '10mb' }), (req, res) => {
  try {
    const { instance_id, instance_name, images, deleted } = req.body;
    if (!instance_id || !instance_name) return res.status(400).json({ error: 'instance_id and instance_name required' });

    const db = getDb();

    // Upsert hub instance (no URL needed for push-only instances)
    db.prepare(`
      INSERT INTO hub_instances (instance_id, name, url, image_count)
      VALUES (?, ?, '', ?)
      ON CONFLICT(instance_id) DO UPDATE SET
        name=excluded.name, image_count=excluded.image_count,
        last_crawled_at=datetime('now'), status='active', error=NULL
    `).run(instance_id, instance_name, (images || []).length);

    // Ensure peer exists for this instance
    let peer = db.prepare('SELECT id FROM peers WHERE instance_id = ?').get(instance_id);
    if (!peer) {
      const info = db.prepare("INSERT INTO peers (instance_id, name, url, status) VALUES (?, ?, 'push-only', 'active')").run(instance_id, instance_name);
      peer = { id: info.lastInsertRowid };
    }

    // Upsert images
    if (images && images.length > 0) {
      const upsert = db.prepare(`
        INSERT INTO remote_images (peer_id, remote_id, title, tags_json, caption, metadata_json, uploaded_by, width, height, format, media_type, remote_created_at, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(peer_id, remote_id) DO UPDATE SET
          title=excluded.title, tags_json=excluded.tags_json, caption=excluded.caption,
          metadata_json=excluded.metadata_json, synced_at=datetime('now')
      `);

      const batch = db.transaction(() => {
        for (const img of images) {
          upsert.run(
            peer.id, img.id, img.title || null,
            JSON.stringify(img.tags || []), img.caption || null,
            JSON.stringify(img.metadata || {}), img.uploaded_by || null,
            img.width || null, img.height || null, img.format || null,
            img.media_type || 'image', img.created_at || null
          );
        }

        // Handle deletions
        if (deleted && deleted.length > 0) {
          const placeholders = deleted.map(() => '?').join(',');
          db.prepare(`DELETE FROM remote_images WHERE peer_id = ? AND remote_id IN (${placeholders})`).run(peer.id, ...deleted);
        }
      });
      batch();
    }

    // Handle thumbnail pushes (base64 in image data)
    let cachedThumbs = 0;
    if (images) {
      const path = require('path');
      const fs = require('fs');
      const THUMBNAILS_DIR = path.join(__dirname, '..', 'uploads', 'thumbnails');

      for (const img of images) {
        if (img.thumbnail_base64) {
          try {
            const thumbFilename = `remote_${peer.id}_${img.id}.webp`;
            const thumbPath = path.join(THUMBNAILS_DIR, thumbFilename);
            const buffer = Buffer.from(img.thumbnail_base64, 'base64');
            fs.writeFileSync(thumbPath, buffer);
            db.prepare('UPDATE remote_images SET thumbnail_cached = 1, thumbnail_path = ? WHERE peer_id = ? AND remote_id = ?')
              .run(`thumbnails/${thumbFilename}`, peer.id, img.id);
            cachedThumbs++;
          } catch (e) {}
        }
      }
    }

    const totalRemote = db.prepare('SELECT COUNT(*) as c FROM remote_images WHERE peer_id = ?').get(peer.id);
    db.prepare('UPDATE peers SET image_count = ? WHERE id = ?').run(totalRemote.c, peer.id);

    res.json({
      success: true,
      received: (images || []).length,
      deleted: (deleted || []).length,
      thumbnails_cached: cachedThumbs,
    });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// GET /api/hub/pull — instance pulls the aggregated feed from the hub
// Same as /api/hub/explore but intended for instance-to-instance pull
router.get('/pull', requireHub, (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const since = req.query.since;

    let where = '';
    const params = {};
    if (since) { where = 'WHERE ri.synced_at > @since'; params.since = since; }

    const total = db.prepare(`SELECT COUNT(*) as c FROM remote_images ri ${where}`).get(params);
    const images = db.prepare(`
      SELECT ri.*, p.name as peer_name, p.instance_id as peer_instance_id
      FROM remote_images ri JOIN peers p ON ri.peer_id = p.id
      ${where}
      ORDER BY ri.remote_created_at DESC LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset });

    const enriched = images.map(img => ({
      ...img,
      tags: img.tags_json ? JSON.parse(img.tags_json) : [],
      metadata: img.metadata_json ? JSON.parse(img.metadata_json) : {},
      tags_json: undefined, metadata_json: undefined,
    }));

    // List of registered instances
    const instances = db.prepare("SELECT instance_id, name, image_count FROM hub_instances WHERE status = 'active'").all();

    res.json({ images: enriched, total: total.c, limit, offset, instances });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

module.exports = router;
