/**
 * Live-mode feed assembly for federated content.
 *
 * Synced peers serve from the local remote_images cache; live-mode peers
 * (peers.mode = 'live') store nothing locally — their content is fetched from
 * the peer's public API at browse time with a short in-memory TTL cache.
 * Unreachable live peers contribute nothing: their items are simply absent
 * from feeds until the peer comes back.
 */
const { getDb } = require('../db');
const { remoteMediaUrls } = require('./federation-urls');
const federationSync = require('./federation-sync');

const LIVE_TIMEOUT_MS = 4000;
const LIVE_CACHE_TTL_MS = 30000;
const LIVE_CACHE_MAX_ENTRIES = 200;
const liveCache = new Map(); // `${peerId}:${count}:${offset}` -> { at, items, total }

function clearLiveCache(peerId) {
  for (const key of liveCache.keys()) {
    if (key.startsWith(`${peerId}:`)) liveCache.delete(key);
  }
}

// Map a peer /federation/public item to the same shape /federation/feed emits
// for synced rows, so PhotoViewer/MetadataPanel work identically.
function shapeLiveItem(peer, img) {
  return {
    peer_id: peer.id,
    remote_id: img.id,
    remote_row_id: null, // live items have no local row to reference (e.g. for collections)
    peer_name: peer.name,
    peer_url: peer.url,
    peer_instance_id: peer.instance_id,
    title: img.title ?? null,
    caption: img.caption ?? null,
    uploaded_by: img.uploaded_by ?? null,
    width: img.width ?? null,
    height: img.height ?? null,
    format: img.format ?? null,
    media_type: img.media_type || 'image',
    prompt: img.prompt ?? null,
    negative_prompt: img.negative_prompt ?? null,
    model: img.model ?? null,
    sampler: img.sampler ?? null,
    steps: img.steps ?? null,
    cfg_scale: img.cfg_scale ?? null,
    seed: img.seed != null ? String(img.seed) : null,
    workflow_json: img.workflow_json ?? null,
    prompt_json: img.prompt_json ?? null,
    video_metadata: img.video_metadata ?? null,
    duration: img.duration ?? null,
    file_size: img.file_size ?? null,
    file_hash: img.file_hash ?? null,
    remote_created_at: img.created_at ?? null,
    thumbnail_cached: 0,
    thumbnail_path: null,
    is_remote: true,
    live: true,
    tags: img.tags || [],
    metadata: {
      prompt: img.prompt, model: img.model, sampler: img.sampler,
      steps: img.steps, cfg_scale: img.cfg_scale, seed: img.seed,
    },
    ...remoteMediaUrls(peer.url, { remote_id: img.id, preview_path: img.preview_path }),
  };
}

async function fetchLiveItems(peer, count, offset = 0) {
  const key = `${peer.id}:${count}:${offset}`;
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < LIVE_CACHE_TTL_MS) return hit;

  const data = await federationSync.fetchJson(
    `${peer.url}/api/federation/public?limit=${Math.min(count, 200)}&offset=${offset}`,
    LIVE_TIMEOUT_MS
  );
  const entry = {
    at: Date.now(),
    items: (data.images || []).map(img => shapeLiveItem(peer, img)),
    total: data.total || 0,
  };
  if (liveCache.size >= LIVE_CACHE_MAX_ENTRIES) liveCache.clear();
  liveCache.set(key, entry);
  return entry;
}

/**
 * Fetch the first `count` items from every live-mode peer in parallel
 * (optionally a single peer). Failed peers are skipped.
 */
async function fetchAllLiveWindows(count, peerId = null) {
  const db = getDb();
  let sql = "SELECT * FROM peers WHERE mode = 'live' AND status != 'blocked'";
  const params = [];
  if (peerId) { sql += ' AND id = ?'; params.push(peerId); }
  const livePeers = db.prepare(sql).all(...params);
  if (livePeers.length === 0) return { items: [], total: 0 };

  const settled = await Promise.allSettled(livePeers.map(p => fetchLiveItems(p, count)));
  const items = [];
  let total = 0;
  for (const s of settled) {
    if (s.status === 'fulfilled') { items.push(...s.value.items); total += s.value.total; }
  }
  return { items, total };
}

module.exports = { fetchLiveItems, fetchAllLiveWindows, clearLiveCache };
