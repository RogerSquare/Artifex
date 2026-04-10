/**
 * Federation sync engine.
 * Periodically polls peer instances for new public content.
 */

const { getDb } = require('../db');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');

const THUMBNAILS_DIR = path.join(__dirname, '..', 'uploads', 'thumbnails');
const DEFAULT_SYNC_INTERVAL = 30 * 60 * 1000; // 30 minutes

let syncTimer = null;
let syncing = false;

/**
 * Fetch JSON from a URL.
 */
function fetchJson(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Download a file from URL to local path.
 */
function downloadFile(url, destPath, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const stream = fs.createWriteStream(destPath);
      res.pipe(stream);
      stream.on('finish', () => { stream.close(); resolve(); });
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Verify a URL is a valid Artifex instance by fetching its manifest.
 */
async function verifyPeer(url) {
  const cleanUrl = url.replace(/\/+$/, '');
  const manifest = await fetchJson(`${cleanUrl}/api/federation/manifest`);

  if (!manifest.id || !manifest.api_version) {
    throw new Error('Invalid manifest — not an Artifex instance');
  }

  return {
    instance_id: manifest.id,
    name: manifest.name || 'Unknown',
    url: cleanUrl,
    stats: manifest.stats,
    api_version: manifest.api_version,
  };
}

/**
 * Sync a single peer — fetch new images since last sync.
 */
async function syncPeer(peerId) {
  const db = getDb();
  const peer = db.prepare('SELECT * FROM peers WHERE id = ?').get(peerId);
  if (!peer || peer.status === 'blocked') return { synced: 0 };

  try {
    // Incremental sync — fetch updates since last sync
    const sinceParam = peer.last_synced_at
      ? `?since=${encodeURIComponent(peer.last_synced_at)}`
      : '';
    const endpoint = peer.last_synced_at
      ? `${peer.url}/api/federation/updates${sinceParam}`
      : `${peer.url}/api/federation/public?limit=200`;

    const data = await fetchJson(endpoint);
    const images = data.images || [];
    const deleted = data.deleted || [];

    // Upsert remote images
    const upsert = db.prepare(`
      INSERT INTO remote_images (peer_id, remote_id, title, tags_json, caption, metadata_json, uploaded_by, width, height, format, media_type, remote_created_at, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(peer_id, remote_id) DO UPDATE SET
        title=excluded.title, tags_json=excluded.tags_json, caption=excluded.caption,
        metadata_json=excluded.metadata_json, synced_at=datetime('now')
    `);

    const syncBatch = db.transaction(() => {
      for (const img of images) {
        const metadata = JSON.stringify({
          prompt: img.prompt, model: img.model, sampler: img.sampler,
          steps: img.steps, cfg_scale: img.cfg_scale, seed: img.seed,
        });
        upsert.run(
          peerId, img.id, img.title,
          JSON.stringify(img.tags || []), img.caption || null,
          metadata, img.uploaded_by || null,
          img.width || null, img.height || null, img.format || null,
          img.media_type || 'image', img.created_at || null
        );
      }

      // Remove deleted images
      if (deleted.length > 0) {
        const placeholders = deleted.map(() => '?').join(',');
        db.prepare(`DELETE FROM remote_images WHERE peer_id = ? AND remote_id IN (${placeholders})`).run(peerId, ...deleted);
      }
    });
    syncBatch();

    // Cache thumbnails for new images
    let cached = 0;
    for (const img of images) {
      if (img.thumbnail_url) {
        try {
          const thumbFilename = `remote_${peerId}_${img.id}.webp`;
          const thumbPath = path.join(THUMBNAILS_DIR, thumbFilename);
          if (!fs.existsSync(thumbPath)) {
            const thumbUrl = `${peer.url}${img.thumbnail_url}`;
            await downloadFile(thumbUrl, thumbPath);
            db.prepare('UPDATE remote_images SET thumbnail_cached = 1, thumbnail_path = ? WHERE peer_id = ? AND remote_id = ?')
              .run(`thumbnails/${thumbFilename}`, peerId, img.id);
            cached++;
          }
        } catch (e) {
          // Thumbnail cache failure is non-critical
        }
      }
    }

    // Update peer status
    const totalRemote = db.prepare('SELECT COUNT(*) as c FROM remote_images WHERE peer_id = ?').get(peerId);
    db.prepare("UPDATE peers SET last_synced_at = datetime('now'), image_count = ?, status = 'active', error = NULL WHERE id = ?")
      .run(totalRemote.c, peerId);

    console.log(`[Federation] Synced peer ${peer.name}: ${images.length} new, ${deleted.length} deleted, ${cached} thumbnails cached`);
    return { synced: images.length, deleted: deleted.length, cached };

  } catch (err) {
    db.prepare("UPDATE peers SET status = 'error', error = ? WHERE id = ?").run(err.message, peerId);
    console.error(`[Federation] Sync failed for ${peer.name}:`, err.message);
    return { synced: 0, error: err.message };
  }
}

/**
 * Sync all active peers.
 */
async function syncAll() {
  if (syncing) return;
  syncing = true;

  const db = getDb();
  const enabled = db.prepare("SELECT value FROM instance_settings WHERE key = 'federation_enabled'").get();
  if (enabled?.value !== 'true') { syncing = false; return; }

  const peers = db.prepare("SELECT id, name FROM peers WHERE status != 'blocked'").all();

  for (const peer of peers) {
    await syncPeer(peer.id);
  }

  syncing = false;
}

/**
 * Start periodic sync.
 */
function start(intervalMs = DEFAULT_SYNC_INTERVAL) {
  if (syncTimer) return;
  console.log(`[Federation] Sync engine started (interval: ${intervalMs / 60000}min)`);
  syncTimer = setInterval(syncAll, intervalMs);
  // Run initial sync after 10 seconds
  setTimeout(syncAll, 10000);
}

/**
 * Stop periodic sync.
 */
function stop() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

module.exports = { verifyPeer, syncPeer, syncAll, start, stop };
