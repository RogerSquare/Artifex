const express = require('express');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db');
const { requireAuth } = require('../lib/authMiddleware');

const router = express.Router();
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const API_VERSION = '1.0.0';

/**
 * Get an instance setting from the DB.
 */
function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM instance_settings WHERE key = ?').get(key);
  return row?.value || null;
}

/**
 * Set an instance setting.
 */
function setSetting(key, value) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO instance_settings (key, value) VALUES (?, ?)').run(key, value);
}

/**
 * Check if federation is enabled. Returns false if disabled.
 */
function isFederationEnabled() {
  return getSetting('federation_enabled') === 'true';
}

/**
 * Middleware: reject if federation is disabled.
 */
function requireFederation(req, res, next) {
  if (!isFederationEnabled()) {
    return res.status(403).json({ error: 'Federation is disabled on this instance' });
  }
  // Add version header to all federation responses
  res.setHeader('X-Artifex-Version', API_VERSION);
  next();
}

/**
 * Build the instance manifest object.
 */
function getManifest() {
  const db = getDb();
  const imageCount = db.prepare("SELECT COUNT(*) as c FROM images WHERE visibility = 'public'").get();
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();

  return {
    id: getSetting('instance_id'),
    name: getSetting('instance_name') || 'Artifex Gallery',
    description: getSetting('instance_description') || '',
    url: getSetting('instance_url') || '',
    federation_enabled: isFederationEnabled(),
    api_version: API_VERSION,
    stats: {
      public_images: imageCount.c,
      users: userCount.c,
    },
    capabilities: ['images', 'tags', 'captions', 'nsfw-detection'],
  };
}

// ─── Public Federation Endpoints ───

// GET /api/federation/manifest — instance info and stats
router.get('/manifest', requireFederation, (req, res) => {
  try {
    res.json(getManifest());
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// GET /api/federation/public — paginated public images
router.get('/public', requireFederation, (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const total = db.prepare("SELECT COUNT(*) as c FROM images WHERE visibility = 'public'").get();

    const images = db.prepare(`
      SELECT i.id, i.title, i.original_name, i.width, i.height, i.format, i.media_type,
        i.prompt, i.model, i.sampler, i.steps, i.cfg_scale, i.seed, i.caption,
        i.created_at, u.username as uploaded_by
      FROM images i LEFT JOIN users u ON i.user_id = u.id
      WHERE i.visibility = 'public'
      ORDER BY i.created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset);

    // Add tags and thumbnail URL for each image
    const enriched = images.map(img => {
      const tags = db.prepare(`
        SELECT t.name, t.category FROM image_tags it JOIN tags t ON it.tag_id = t.id
        WHERE it.image_id = ? ORDER BY t.category, t.name
      `).all(img.id);

      return {
        ...img,
        tags,
        thumbnail_url: `/api/federation/image/${img.id}/thumbnail`,
        detail_url: `/api/federation/image/${img.id}`,
      };
    });

    res.json({
      instance: { id: getSetting('instance_id'), name: getSetting('instance_name'), url: getSetting('instance_url') },
      images: enriched,
      total: total.c,
      limit,
      offset,
    });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// GET /api/federation/updates?since=ISO_timestamp — incremental updates
router.get('/updates', requireFederation, (req, res) => {
  try {
    const since = req.query.since;
    if (!since) return res.status(400).json({ error: 'since parameter required (ISO timestamp)' });

    const db = getDb();

    // New or updated public images since timestamp
    const images = db.prepare(`
      SELECT i.id, i.title, i.original_name, i.width, i.height, i.format, i.media_type,
        i.prompt, i.model, i.sampler, i.caption, i.created_at, u.username as uploaded_by
      FROM images i LEFT JOIN users u ON i.user_id = u.id
      WHERE i.visibility = 'public' AND i.created_at > ?
      ORDER BY i.created_at DESC
    `).all(since);

    const enriched = images.map(img => {
      const tags = db.prepare(`
        SELECT t.name, t.category FROM image_tags it JOIN tags t ON it.tag_id = t.id WHERE it.image_id = ?
      `).all(img.id);
      return { ...img, tags, thumbnail_url: `/api/federation/image/${img.id}/thumbnail` };
    });

    // Deleted image IDs (from audit log)
    const deleted = db.prepare(`
      SELECT CAST(resource_id AS INTEGER) as id FROM audit_logs
      WHERE action = 'image.delete' AND resource_type = 'image' AND created_at > ?
    `).all(since).map(r => r.id);

    res.json({
      instance: { id: getSetting('instance_id'), name: getSetting('instance_name'), url: getSetting('instance_url') },
      images: enriched,
      deleted,
      since,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// GET /api/federation/image/:id — single image detail
router.get('/image/:id', requireFederation, (req, res) => {
  try {
    const db = getDb();
    const image = db.prepare(`
      SELECT i.*, u.username as uploaded_by
      FROM images i LEFT JOIN users u ON i.user_id = u.id
      WHERE i.id = ? AND i.visibility = 'public'
    `).get(req.params.id);

    if (!image) return res.status(404).json({ error: 'Image not found' });

    image.tags = db.prepare(`
      SELECT t.name, t.category, it.source FROM image_tags it JOIN tags t ON it.tag_id = t.id WHERE it.image_id = ?
    `).all(req.params.id);

    image.thumbnail_url = `/api/federation/image/${image.id}/thumbnail`;

    res.json({ instance: { id: getSetting('instance_id'), name: getSetting('instance_name') }, image });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// GET /api/federation/image/:id/thumbnail — serve thumbnail for remote caching
router.get('/image/:id/thumbnail', requireFederation, (req, res) => {
  try {
    const db = getDb();
    const image = db.prepare("SELECT thumbnail_path, filepath FROM images WHERE id = ? AND visibility = 'public'").get(req.params.id);

    if (!image) return res.status(404).json({ error: 'Image not found' });

    const filePath = path.join(UPLOADS_DIR, image.thumbnail_path || image.filepath);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Thumbnail not found' });

    // Cache for 1 hour
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// ─── Admin Endpoints (manage federation settings) ───

// GET /api/federation/settings — get federation settings (admin only)
router.get('/settings', requireAuth, (req, res) => {
  try {
    res.json({
      instance_id: getSetting('instance_id'),
      instance_name: getSetting('instance_name'),
      instance_description: getSetting('instance_description'),
      instance_url: getSetting('instance_url'),
      federation_enabled: getSetting('federation_enabled') === 'true',
      hub_url: getSetting('hub_url') || '',
    });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// PUT /api/federation/settings — update federation settings (admin only)
router.put('/settings', requireAuth, (req, res) => {
  try {
    const { instance_name, instance_description, instance_url, federation_enabled } = req.body;

    if (instance_name !== undefined) setSetting('instance_name', instance_name);
    if (instance_description !== undefined) setSetting('instance_description', instance_description);
    if (instance_url !== undefined) setSetting('instance_url', instance_url);
    if (federation_enabled !== undefined) setSetting('federation_enabled', federation_enabled ? 'true' : 'false');
    if (req.body.hub_url !== undefined) setSetting('hub_url', req.body.hub_url);

    const audit = require('../lib/audit');
    audit.fromReq(req, 'admin.federation_settings', 'instance', null, req.body);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// ─── Proxy Endpoints — fetch full-res and metadata from peers on demand ───

const http = require('http');
const https = require('https');

function proxyStream(url, res, cacheSeconds = 3600) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { timeout: 30000 }, (upstream) => {
      if (upstream.statusCode !== 200) {
        res.status(upstream.statusCode || 502).json({ error: 'Peer returned error' });
        upstream.resume();
        return resolve();
      }
      // Forward content-type and set cache
      if (upstream.headers['content-type']) res.setHeader('Content-Type', upstream.headers['content-type']);
      res.setHeader('Cache-Control', `public, max-age=${cacheSeconds}`);
      upstream.pipe(res);
      upstream.on('end', resolve);
      upstream.on('error', reject);
    }).on('error', (err) => {
      res.status(502).json({ error: 'Cannot reach peer' });
      resolve();
    });
  });
}

// GET /api/federation/proxy/:peerId/:remoteId/detail — fetch full metadata from peer
router.get('/proxy/:peerId/:remoteId/detail', async (req, res) => {
  try {
    const db = getDb();
    const peer = db.prepare('SELECT url FROM peers WHERE id = ?').get(req.params.peerId);
    if (!peer || !peer.url || peer.url === 'push-only') {
      // Fallback to stored metadata for push-only peers
      const img = db.prepare('SELECT * FROM remote_images WHERE peer_id = ? AND remote_id = ?').get(req.params.peerId, req.params.remoteId);
      if (!img) return res.status(404).json({ error: 'Image not found' });
      return res.json({
        image: {
          ...img,
          tags: img.tags_json ? JSON.parse(img.tags_json) : [],
          ...(img.metadata_json ? JSON.parse(img.metadata_json) : {}),
          tags_json: undefined, metadata_json: undefined,
        }
      });
    }

    // Fetch from peer
    const fetchJson = (url) => new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      client.get(url, { timeout: 15000 }, (r) => {
        if (r.statusCode !== 200) return reject(new Error(`HTTP ${r.statusCode}`));
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } });
      }).on('error', reject);
    });

    const detail = await fetchJson(`${peer.url}/api/federation/image/${req.params.remoteId}`);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(detail);
  } catch (error) {
    // Fallback to stored data
    const db = getDb();
    const img = db.prepare('SELECT * FROM remote_images WHERE peer_id = ? AND remote_id = ?').get(req.params.peerId, req.params.remoteId);
    if (img) {
      res.json({
        image: {
          ...img,
          tags: img.tags_json ? JSON.parse(img.tags_json) : [],
          ...(img.metadata_json ? JSON.parse(img.metadata_json) : {}),
          tags_json: undefined, metadata_json: undefined,
        }
      });
    } else {
      res.status(502).json({ error: 'Cannot reach peer and no cached data' });
    }
  }
});

// GET /api/federation/proxy/:peerId/:remoteId/full — proxy full-res image from peer
router.get('/proxy/:peerId/:remoteId/full', async (req, res) => {
  try {
    const db = getDb();
    const peer = db.prepare('SELECT url FROM peers WHERE id = ?').get(req.params.peerId);
    if (!peer || !peer.url || peer.url === 'push-only') {
      // For push-only peers, serve the cached thumbnail as best available
      const img = db.prepare('SELECT thumbnail_path FROM remote_images WHERE peer_id = ? AND remote_id = ?').get(req.params.peerId, req.params.remoteId);
      if (img?.thumbnail_path) {
        return res.sendFile(path.join(UPLOADS_DIR, img.thumbnail_path));
      }
      return res.status(404).json({ error: 'Full image not available for push-only peer' });
    }

    // First get the filepath from peer's image detail
    const fetchJson = (url) => new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;
      client.get(url, { timeout: 15000 }, (r) => {
        if (r.statusCode !== 200) return reject(new Error(`HTTP ${r.statusCode}`));
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } });
      }).on('error', reject);
    });

    const detail = await fetchJson(`${peer.url}/api/federation/image/${req.params.remoteId}`);
    const filepath = detail.image?.filepath;
    if (!filepath) return res.status(404).json({ error: 'Image filepath not found' });

    // Stream the full image from peer
    await proxyStream(`${peer.url}/uploads/${filepath}`, res, 7200);
  } catch (error) {
    res.status(502).json({ error: 'Cannot fetch full image from peer' });
  }
});

// ─── Peer Management (Admin) ───

const federationSync = require('../lib/federation-sync');

// GET /api/federation/peers — list all peers
router.get('/peers', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const peers = db.prepare('SELECT * FROM peers ORDER BY added_at DESC').all();
    res.json({ peers });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// POST /api/federation/peers — add a peer by URL (verifies manifest first)
router.post('/peers', requireAuth, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });

    // Verify it's a valid Artifex instance
    const peer = await federationSync.verifyPeer(url);

    const db = getDb();

    // Check if already added
    const existing = db.prepare('SELECT id FROM peers WHERE url = ?').get(peer.url);
    if (existing) return res.status(409).json({ error: 'Peer already added' });

    // Check not adding self
    const selfId = getSetting('instance_id');
    if (peer.instance_id === selfId) return res.status(400).json({ error: 'Cannot add yourself as a peer' });

    const info = db.prepare('INSERT INTO peers (instance_id, name, url) VALUES (?, ?, ?)').run(peer.instance_id, peer.name, peer.url);

    const audit = require('../lib/audit');
    audit.fromReq(req, 'admin.peer_add', 'peer', info.lastInsertRowid, { url: peer.url, name: peer.name });

    res.status(201).json({ success: true, peer: { id: info.lastInsertRowid, ...peer } });
  } catch (error) {
    res.status(400).json({ error: `Failed to verify peer: ${error.message}` });
  }
});

// DELETE /api/federation/peers/:id — remove peer and cached content
router.delete('/peers/:id', requireAuth, (req, res) => {
  try {
    const db = getDb();
    const peer = db.prepare('SELECT * FROM peers WHERE id = ?').get(req.params.id);
    if (!peer) return res.status(404).json({ error: 'Peer not found' });

    // Delete cached thumbnails
    const remoteImages = db.prepare('SELECT thumbnail_path FROM remote_images WHERE peer_id = ? AND thumbnail_cached = 1').all(req.params.id);
    for (const img of remoteImages) {
      if (img.thumbnail_path) {
        const fp = path.join(UPLOADS_DIR, img.thumbnail_path);
        try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
      }
    }

    db.prepare('DELETE FROM remote_images WHERE peer_id = ?').run(req.params.id);
    db.prepare('DELETE FROM peers WHERE id = ?').run(req.params.id);

    const audit = require('../lib/audit');
    audit.fromReq(req, 'admin.peer_remove', 'peer', parseInt(req.params.id), { url: peer.url });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

// POST /api/federation/peers/:id/sync — manually trigger sync for a peer
router.post('/peers/:id/sync', requireAuth, async (req, res) => {
  try {
    const result = await federationSync.syncPeer(parseInt(req.params.id));
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/federation/sync — sync all peers
router.post('/sync', requireAuth, async (req, res) => {
  try {
    await federationSync.syncAll();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/federation/feed — merged feed of remote images from all peers
router.get('/feed', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const peerId = req.query.peer ? parseInt(req.query.peer) : null;

    let where = '';
    const params = {};
    if (peerId) { where = 'WHERE ri.peer_id = @peerId'; params.peerId = peerId; }

    const total = db.prepare(`SELECT COUNT(*) as c FROM remote_images ri ${where}`).get(params);

    const images = db.prepare(`
      SELECT ri.*, p.name as peer_name, p.url as peer_url, p.instance_id as peer_instance_id
      FROM remote_images ri JOIN peers p ON ri.peer_id = p.id
      ${where}
      ORDER BY ri.remote_created_at DESC LIMIT @limit OFFSET @offset
    `).all({ ...params, limit, offset });

    // Parse JSON fields
    const enriched = images.map(img => ({
      ...img,
      tags: img.tags_json ? JSON.parse(img.tags_json) : [],
      metadata: img.metadata_json ? JSON.parse(img.metadata_json) : {},
      tags_json: undefined,
      metadata_json: undefined,
    }));

    res.json({ images: enriched, total: total.c, limit, offset });
  } catch (error) {
    res.status(500).json({ error: 'An internal error occurred' });
  }
});

module.exports = router;
