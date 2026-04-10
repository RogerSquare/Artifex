/**
 * Hub Push Client.
 * Pushes local public images to a remote hub.
 * Used by instances without public URLs (behind NAT, no domain).
 */

const { getDb } = require('../db');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const PUSH_INTERVAL = 15 * 60 * 1000; // 15 minutes

let pushTimer = null;

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM instance_settings WHERE key = ?').get(key);
  return row?.value || null;
}

/**
 * Post JSON to a URL.
 */
function postJson(url, data, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      timeout,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
        catch (e) { resolve({ status: res.statusCode, body: data }) }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

/**
 * Push local public images to the configured hub.
 */
async function pushToHub() {
  const hubUrl = getSetting('hub_url');
  if (!hubUrl) return;

  const db = getDb();
  const instanceId = getSetting('instance_id');
  const instanceName = getSetting('instance_name') || 'Artifex Gallery';

  // Get all public images
  const images = db.prepare(`
    SELECT i.id, i.title, i.width, i.height, i.format, i.media_type,
      i.prompt, i.model, i.sampler, i.steps, i.cfg_scale, i.seed,
      i.caption, i.created_at, i.thumbnail_path, u.username as uploaded_by
    FROM images i LEFT JOIN users u ON i.user_id = u.id
    WHERE i.visibility = 'public'
    ORDER BY i.created_at DESC LIMIT 500
  `).all();

  // Get tags for each image
  const enriched = images.map(img => {
    const tags = db.prepare(`
      SELECT t.name, t.category FROM image_tags it JOIN tags t ON it.tag_id = t.id WHERE it.image_id = ?
    `).all(img.id);

    const entry = {
      id: img.id,
      title: img.title,
      width: img.width, height: img.height,
      format: img.format, media_type: img.media_type,
      caption: img.caption,
      uploaded_by: img.uploaded_by,
      created_at: img.created_at,
      tags,
      metadata: { prompt: img.prompt, model: img.model, sampler: img.sampler, steps: img.steps, cfg_scale: img.cfg_scale, seed: img.seed },
    };

    // Include thumbnail as base64 (small, ~10-30KB each)
    if (img.thumbnail_path) {
      const thumbPath = path.join(UPLOADS_DIR, img.thumbnail_path);
      if (fs.existsSync(thumbPath)) {
        try {
          const buffer = fs.readFileSync(thumbPath);
          entry.thumbnail_base64 = buffer.toString('base64');
        } catch (e) {}
      }
    }

    return entry;
  });

  // Get recently deleted image IDs (from audit log, last 24h)
  const deleted = db.prepare(`
    SELECT CAST(resource_id AS INTEGER) as id FROM audit_logs
    WHERE action = 'image.delete' AND resource_type = 'image' AND created_at > datetime('now', '-1 day')
  `).all().map(r => r.id);

  try {
    const result = await postJson(`${hubUrl}/api/hub/push`, {
      instance_id: instanceId,
      instance_name: instanceName,
      images: enriched,
      deleted,
    });

    if (result.status === 200) {
      console.log(`[Hub Push] Pushed ${enriched.length} images to hub (${deleted.length} deleted)`);
    } else {
      console.error(`[Hub Push] Hub returned ${result.status}:`, result.body);
    }
  } catch (err) {
    console.error(`[Hub Push] Failed:`, err.message);
  }
}

/**
 * Start periodic push to hub.
 */
function start(intervalMs = PUSH_INTERVAL) {
  const hubUrl = getSetting('hub_url');
  if (!hubUrl) return;
  console.log(`[Hub Push] Started (interval: ${intervalMs / 60000}min, hub: ${hubUrl})`);
  pushTimer = setInterval(pushToHub, intervalMs);
  // Initial push after 15 seconds
  setTimeout(pushToHub, 15000);
}

function stop() {
  if (pushTimer) { clearInterval(pushTimer); pushTimer = null; }
}

module.exports = { pushToHub, start, stop };
