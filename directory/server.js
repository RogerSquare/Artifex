/**
 * Artifex Directory — a standalone, community-hostable registry of Artifex
 * instances that opted into discovery. Registry ONLY: it stores instance
 * metadata so people can find peers; content always flows peer-to-peer
 * through the normal manifest-verified federation.
 *
 * Listing lifecycle:
 *  - register: the directory fetches the instance's own manifest and lists it
 *    only if it's a reachable Artifex with federation + discovery enabled
 *  - heartbeat: instances re-register periodically; entries unseen for 24h
 *    are hidden, and pruned entirely after 7 days
 *  - unregister: the directory re-probes the URL — a listing is removed when
 *    its instance is gone or has discovery disabled, so third parties cannot
 *    remove listings they don't control
 */
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');

const PORT = parseInt(process.env.PORT) || 3010;
const DB_PATH = process.env.DIRECTORY_DB_PATH || path.join(__dirname, 'directory.db');
const MAX_INSTANCES = parseInt(process.env.MAX_INSTANCES) || 500;
const STALE_MS = 24 * 60 * 60 * 1000;
const PRUNE_MS = 7 * 24 * 60 * 60 * 1000;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS instances (
    instance_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    url TEXT NOT NULL UNIQUE,
    api_version TEXT,
    public_images INTEGER DEFAULT 0,
    users INTEGER DEFAULT 0,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL
  );
`);

const app = express();
app.use(express.json({ limit: '10kb' }));
app.disable('x-powered-by');

// Public read — browsers may query directly
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

// Simple per-IP rate limit for writes: 10/min
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 10000) hits.clear();
  return list.length > 10;
}

function normalizeUrl(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`.replace(/\/+$/, '');
  } catch { return null; }
}

async function fetchManifest(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${baseUrl}/api/federation/manifest`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

function prune() {
  const cutoff = new Date(Date.now() - PRUNE_MS).toISOString();
  db.prepare('DELETE FROM instances WHERE last_seen < ?').run(cutoff);
}
setInterval(prune, 60 * 60 * 1000);

// POST /api/directory/register — self-registration + heartbeat (same call)
app.post('/api/directory/register', async (req, res) => {
  try {
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'Rate limit exceeded' });
    const url = normalizeUrl(req.body?.url);
    if (!url) return res.status(400).json({ error: 'Valid http(s) url required' });

    let manifest;
    try { manifest = await fetchManifest(url); }
    catch (e) { return res.status(400).json({ error: `Instance not reachable: ${e.message}` }); }

    if (!manifest?.id || !manifest?.api_version) return res.status(400).json({ error: 'Not an Artifex instance' });
    if (manifest.federation_enabled !== true) return res.status(400).json({ error: 'Federation is not enabled on that instance' });
    if (manifest.discovery_enabled !== true) return res.status(400).json({ error: 'Discovery is not enabled on that instance' });

    const count = db.prepare('SELECT COUNT(*) as c FROM instances').get().c;
    const exists = db.prepare('SELECT instance_id FROM instances WHERE instance_id = ? OR url = ?').get(manifest.id, url);
    if (!exists && count >= MAX_INSTANCES) return res.status(503).json({ error: 'Directory is full' });

    const now = new Date().toISOString();
    // A URL belongs to whichever instance currently answers there
    db.prepare('DELETE FROM instances WHERE url = ? AND instance_id != ?').run(url, manifest.id);
    db.prepare(`
      INSERT INTO instances (instance_id, name, description, url, api_version, public_images, users, first_seen, last_seen)
      VALUES (@instance_id, @name, @description, @url, @api_version, @public_images, @users, @now, @now)
      ON CONFLICT(instance_id) DO UPDATE SET
        name=excluded.name, description=excluded.description, url=excluded.url,
        api_version=excluded.api_version, public_images=excluded.public_images,
        users=excluded.users, last_seen=excluded.last_seen
    `).run({
      instance_id: manifest.id,
      name: String(manifest.name || 'Artifex Gallery').slice(0, 100),
      description: String(manifest.description || '').slice(0, 300),
      url,
      api_version: String(manifest.api_version || '').slice(0, 20),
      public_images: parseInt(manifest.stats?.public_images) || 0,
      users: parseInt(manifest.stats?.users) || 0,
      now,
    });

    res.json({ success: true, listed: true });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// POST /api/directory/unregister — removal is proven by re-probing the URL:
// the listing goes away only if the instance is gone or opted out
app.post('/api/directory/unregister', async (req, res) => {
  try {
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'Rate limit exceeded' });
    const url = normalizeUrl(req.body?.url);
    if (!url) return res.status(400).json({ error: 'Valid http(s) url required' });

    const row = db.prepare('SELECT * FROM instances WHERE url = ?').get(url);
    if (!row) return res.json({ success: true, removed: false });

    let optedOut = false;
    try {
      const manifest = await fetchManifest(url);
      optedOut = manifest?.id !== row.instance_id || manifest?.discovery_enabled !== true || manifest?.federation_enabled !== true;
    } catch { optedOut = true; } // unreachable — let it go

    if (optedOut) db.prepare('DELETE FROM instances WHERE url = ?').run(url);
    res.json({ success: true, removed: optedOut });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// GET /api/directory/instances — the public list (fresh entries only)
app.get('/api/directory/instances', (req, res) => {
  try {
    const cutoff = new Date(Date.now() - STALE_MS).toISOString();
    const instances = db.prepare(`
      SELECT instance_id, name, description, url, api_version, public_images, users, first_seen, last_seen
      FROM instances WHERE last_seen >= ? ORDER BY public_images DESC, last_seen DESC
    `).all(cutoff);
    res.json({ instances, total: instances.length });
  } catch (e) {
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/api/health', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM instances').get().c;
  res.json({ status: 'ok', service: 'artifex-directory', instances: count });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Artifex Directory running on http://0.0.0.0:${PORT}`);
});
