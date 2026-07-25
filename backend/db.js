const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.ARTIFEX_DB_PATH || path.join(__dirname, 'gallery.db');

let db;

const getDb = () => {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initDb();
  }
  return db;
};

const initDb = () => {
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      avatar TEXT,
      role TEXT DEFAULT 'member',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      filepath TEXT NOT NULL,
      thumbnail_path TEXT,
      title TEXT,
      width INTEGER,
      height INTEGER,
      file_size INTEGER,
      format TEXT,
      has_metadata INTEGER DEFAULT 0,
      metadata_raw TEXT,
      prompt TEXT,
      negative_prompt TEXT,
      model TEXT,
      sampler TEXT,
      steps INTEGER,
      cfg_scale REAL,
      seed TEXT,
      workflow_json TEXT,
      tags TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      imported_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      image_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      cover_image_id INTEGER,
      visibility TEXT DEFAULT 'private',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (cover_image_id) REFERENCES images(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS collection_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NOT NULL,
      image_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      added_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
      UNIQUE(collection_id, image_id)
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      UNIQUE(name, category)
    );

    CREATE TABLE IF NOT EXISTS image_tags (
      image_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      source TEXT DEFAULT 'metadata',
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (image_id, tag_id),
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      image_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
      UNIQUE(user_id, image_id)
    );
  `);

  // Migrations: add columns to existing tables if missing
  const addColumnIfMissing = (table, column, definition) => {
    try {
      db.prepare(`SELECT ${column} FROM ${table} LIMIT 1`).get();
    } catch (e) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };

  addColumnIfMissing('users', 'bio', 'TEXT');
  addColumnIfMissing('users', 'disabled', 'INTEGER DEFAULT 0');
  addColumnIfMissing('users', 'last_login', 'TEXT');
  addColumnIfMissing('users', 'storage_quota_bytes', `INTEGER DEFAULT ${process.env.DEFAULT_STORAGE_QUOTA || 5 * 1024 * 1024 * 1024}`); // 5GB default
  addColumnIfMissing('users', 'storage_used_bytes', 'INTEGER DEFAULT 0');
  addColumnIfMissing('images', 'user_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
  addColumnIfMissing('images', 'visibility', "TEXT DEFAULT 'private'");
  addColumnIfMissing('images', 'prompt_json', 'TEXT');
  addColumnIfMissing('images', 'media_type', "TEXT DEFAULT 'image'");
  addColumnIfMissing('images', 'duration', 'REAL');
  addColumnIfMissing('images', 'preview_path', 'TEXT');
  addColumnIfMissing('images', 'video_metadata', 'TEXT');
  addColumnIfMissing('favorites', 'sort_order', 'INTEGER DEFAULT 0');
  addColumnIfMissing('images', 'file_hash', 'TEXT');
  addColumnIfMissing('images', 'caption', 'TEXT');
  addColumnIfMissing('images', 'analysis_path', 'TEXT');

  // Create indexes (safe to run after migrations)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_images_model ON images(model);
    CREATE INDEX IF NOT EXISTS idx_images_visibility ON images(visibility);
    CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_images_has_metadata ON images(has_metadata);
    CREATE INDEX IF NOT EXISTS idx_images_user ON images(user_id);
    CREATE INDEX IF NOT EXISTS idx_images_file_hash ON images(file_hash);
    CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
    CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category);
    CREATE INDEX IF NOT EXISTS idx_image_tags_image ON image_tags(image_id);
    CREATE INDEX IF NOT EXISTS idx_image_tags_tag ON image_tags(tag_id);
  `);

  // FTS5 full-text search index for images
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
      title, original_name, prompt, negative_prompt, model, caption,
      content='images', content_rowid='id'
    );
  `);

  // Triggers to keep FTS in sync with images table
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS images_fts_insert AFTER INSERT ON images BEGIN
      INSERT INTO images_fts(rowid, title, original_name, prompt, negative_prompt, model, caption)
      VALUES (new.id, new.title, new.original_name, new.prompt, new.negative_prompt, new.model, new.caption);
    END;

    CREATE TRIGGER IF NOT EXISTS images_fts_delete AFTER DELETE ON images BEGIN
      INSERT INTO images_fts(images_fts, rowid, title, original_name, prompt, negative_prompt, model, caption)
      VALUES ('delete', old.id, old.title, old.original_name, old.prompt, old.negative_prompt, old.model, old.caption);
    END;

    CREATE TRIGGER IF NOT EXISTS images_fts_update AFTER UPDATE ON images BEGIN
      INSERT INTO images_fts(images_fts, rowid, title, original_name, prompt, negative_prompt, model, caption)
      VALUES ('delete', old.id, old.title, old.original_name, old.prompt, old.negative_prompt, old.model, old.caption);
      INSERT INTO images_fts(rowid, title, original_name, prompt, negative_prompt, model, caption)
      VALUES (new.id, new.title, new.original_name, new.prompt, new.negative_prompt, new.model, new.caption);
    END;
  `);

  // Audit log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
  `);

  // Job queue table for background ML tasks
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      image_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      next_retry_at TEXT,
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_image ON jobs(image_id);
  `);

  // Instance settings for federation
  db.exec(`
    CREATE TABLE IF NOT EXISTS instance_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Federation rework: remote_images gained full metadata columns (schema v2).
  // Old-schema tables (no file_hash column) are dropped and rebuilt by the
  // CREATE below; rows re-sync from peers (wipe authorized by the rework).
  const remoteImagesOldSchema =
    db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'remote_images'").get() &&
    !db.prepare("SELECT 1 AS x FROM pragma_table_info('remote_images') WHERE name = 'file_hash'").get();
  if (remoteImagesOldSchema) {
    db.exec('DROP TABLE remote_images');
  }

  // Federation peers and remote images
  db.exec(`
    CREATE TABLE IF NOT EXISTS peers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      status TEXT DEFAULT 'active',
      mode TEXT DEFAULT 'synced',
      last_synced_at TEXT,
      image_count INTEGER DEFAULT 0,
      error TEXT,
      added_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS remote_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      peer_id INTEGER NOT NULL,
      remote_id INTEGER NOT NULL,
      title TEXT,
      thumbnail_cached INTEGER DEFAULT 0,
      thumbnail_path TEXT,
      tags_json TEXT,
      caption TEXT,
      uploaded_by TEXT,
      width INTEGER,
      height INTEGER,
      format TEXT,
      media_type TEXT DEFAULT 'image',
      prompt TEXT,
      negative_prompt TEXT,
      model TEXT,
      sampler TEXT,
      steps INTEGER,
      cfg_scale REAL,
      seed TEXT,
      workflow_json TEXT,
      prompt_json TEXT,
      video_metadata TEXT,
      duration REAL,
      file_size INTEGER,
      file_hash TEXT,
      filepath TEXT,
      preview_path TEXT,
      remote_created_at TEXT,
      synced_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (peer_id) REFERENCES peers(id) ON DELETE CASCADE,
      UNIQUE(peer_id, remote_id)
    );

    CREATE INDEX IF NOT EXISTS idx_remote_images_peer ON remote_images(peer_id);
    CREATE INDEX IF NOT EXISTS idx_remote_images_synced ON remote_images(synced_at);
  `);

  // Live-mode peers: mode='live' means nothing is cached locally — content is
  // pulled from the peer's API at browse time (feat-federation-live-mode-001)
  addColumnIfMissing('peers', 'mode', "TEXT DEFAULT 'synced'");

  // Collections can reference remote images (feat-remote-select-collect-001):
  // image_id becomes nullable, remote_image_id points at the synced
  // remote_images row (reference-in-place; entries cascade away with the
  // peer). One-time table rebuild — must run after remote_images exists.
  const ciHasRemote = db.prepare("SELECT 1 AS x FROM pragma_table_info('collection_images') WHERE name = 'remote_image_id'").get();
  if (!ciHasRemote) {
    db.exec(`
      CREATE TABLE collection_images_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER NOT NULL,
        image_id INTEGER,
        remote_image_id INTEGER,
        sort_order INTEGER DEFAULT 0,
        added_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
        FOREIGN KEY (remote_image_id) REFERENCES remote_images(id) ON DELETE CASCADE,
        CHECK ((image_id IS NULL) != (remote_image_id IS NULL)),
        UNIQUE(collection_id, image_id),
        UNIQUE(collection_id, remote_image_id)
      );
      INSERT INTO collection_images_v2 (id, collection_id, image_id, sort_order, added_at)
        SELECT id, collection_id, image_id, sort_order, added_at FROM collection_images;
      DROP TABLE collection_images;
      ALTER TABLE collection_images_v2 RENAME TO collection_images;
    `);
    console.log('[Migration] collection_images rebuilt with remote_image_id support');
  }

  // Per-user peer lists (feat-federation-user-peers-001): owner_user_id NULL
  // = global (admin-managed). Rebuild once to drop the table-level UNIQUE(url)
  // — different users may add the same peer URL independently. FKs are turned
  // off during the rebuild so remote_images rows don't cascade away.
  const peersHaveOwner = db.prepare("SELECT 1 AS x FROM pragma_table_info('peers') WHERE name = 'owner_user_id'").get();
  if (!peersHaveOwner) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE peers_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        mode TEXT DEFAULT 'synced',
        owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        last_synced_at TEXT,
        image_count INTEGER DEFAULT 0,
        error TEXT,
        added_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO peers_v2 (id, instance_id, name, url, status, mode, last_synced_at, image_count, error, added_at)
        SELECT id, instance_id, name, url, status, mode, last_synced_at, image_count, error, added_at FROM peers;
      DROP TABLE peers;
      ALTER TABLE peers_v2 RENAME TO peers;
      CREATE INDEX IF NOT EXISTS idx_peers_owner ON peers(owner_user_id);
    `);
    db.pragma('foreign_keys = ON');
    console.log('[Migration] peers rebuilt with per-user owner support');
  }

  // One-time federation rework migration: the hub/relay model is gone.
  // Old installs carry hub-era artifacts (hub_instances table, hub_mode/hub_url
  // settings) — wipe federated state so peers are re-added under the new model.
  const hubEra =
    db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'hub_instances'").get() ||
    db.prepare("SELECT 1 AS x FROM instance_settings WHERE key IN ('hub_mode', 'hub_url')").get();
  if (hubEra) {
    const thumbsDir = path.join(__dirname, 'uploads', 'thumbnails');
    try {
      for (const f of fs.readdirSync(thumbsDir)) {
        if (f.startsWith('remote_')) {
          try { fs.unlinkSync(path.join(thumbsDir, f)); } catch (e) {}
        }
      }
    } catch (e) {}
    db.exec(`
      DELETE FROM remote_images;
      DELETE FROM peers;
      DROP TABLE IF EXISTS hub_instances;
      DELETE FROM instance_settings WHERE key IN ('hub_mode', 'hub_url');
    `);
    console.log('[Migration] Hub/relay removed — federation peers wiped; re-add peer URLs in Admin > Federation');
  }

  // Generate instance ID on first boot. INSTANCE_NAME / PUBLIC_URL /
  // FEDERATION_ENABLED env vars (Docker/compose) seed the initial values only —
  // once the DB exists, the admin UI owns these settings and env is ignored.
  const crypto = require('crypto');
  const existing = db.prepare("SELECT value FROM instance_settings WHERE key = 'instance_id'").get();
  if (!existing) {
    const instanceId = crypto.randomUUID();
    const seedName = process.env.INSTANCE_NAME || 'Artifex Gallery';
    const seedUrl = process.env.PUBLIC_URL || '';
    const seedFederation = String(process.env.FEDERATION_ENABLED || 'false').toLowerCase() === 'true' ? 'true' : 'false';
    db.prepare("INSERT INTO instance_settings (key, value) VALUES ('instance_id', ?)").run(instanceId);
    db.prepare("INSERT OR IGNORE INTO instance_settings (key, value) VALUES ('instance_name', ?)").run(seedName);
    db.prepare("INSERT OR IGNORE INTO instance_settings (key, value) VALUES ('instance_description', '')").run();
    db.prepare("INSERT OR IGNORE INTO instance_settings (key, value) VALUES ('instance_url', ?)").run(seedUrl);
    db.prepare("INSERT OR IGNORE INTO instance_settings (key, value) VALUES ('federation_enabled', ?)").run(seedFederation);
    console.log(`Instance ID generated: ${instanceId}`);
  }

  // Rebuild FTS index to stay in sync (safe to run every startup — fast on small datasets)
  try {
    db.exec("INSERT INTO images_fts(images_fts) VALUES('rebuild')");
  } catch (e) {
    console.error('FTS rebuild failed:', e.message);
  }
};

module.exports = { getDb };
