/**
 * One-time backfill: re-probe existing media files for embedded creation
 * timestamps (ffprobe creation_time for videos, PNG "Creation Time" chunks
 * for images) and apply them to images.original_created_at. Embedded dates
 * are authoritative — they beat the mtime/created_at values the schema
 * migration seeded. Runs asynchronously after boot, once per install
 * (guarded by an instance_settings key).
 */
const path = require('path');
const { getDb } = require('../db');
const { extractMetadata, extractVideoMetadata } = require('./metadata');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const DONE_KEY = 'original_created_backfill_v2';

async function run() {
  const db = getDb();
  if (db.prepare('SELECT value FROM instance_settings WHERE key = ?').get(DONE_KEY)) return;

  const rows = db.prepare('SELECT id, filepath, media_type FROM images').all();
  const setStmt = db.prepare('UPDATE images SET original_created_at = ? WHERE id = ?');
  let updated = 0;
  for (const row of rows) {
    try {
      const fp = path.join(UPLOADS_DIR, row.filepath);
      const meta = row.media_type === 'video'
        ? await extractVideoMetadata(fp)
        : await extractMetadata(fp);
      if (meta.original_created_at) {
        setStmt.run(meta.original_created_at, row.id);
        updated++;
      }
    } catch (e) { /* unreadable file — keep existing value */ }
  }

  db.prepare('INSERT OR REPLACE INTO instance_settings (key, value) VALUES (?, ?)').run(DONE_KEY, new Date().toISOString());
  console.log(`[Backfill] Embedded creation dates applied to ${updated}/${rows.length} images`);
}

module.exports = { run };
