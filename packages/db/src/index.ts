import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema.js";

let sqlite: Database.Database | null = null;

export function getDataDir() {
  return resolve(process.env.HILI_DATA_DIR ?? "./app-data");
}

export function getDatabasePath() {
  return process.env.HILI_DB_PATH ?? resolve(getDataDir(), "hilihili.db");
}

export function getSqlite() {
  if (!sqlite) {
    const dbPath = getDatabasePath();
    mkdirSync(dirname(dbPath), { recursive: true });
    sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    migrate(sqlite);
  }

  return sqlite;
}

export function getDb() {
  return drizzle(getSqlite(), { schema });
}

export function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      library_id TEXT REFERENCES libraries(id),
      created_at TEXT NOT NULL,
      UNIQUE(library_id, name)
    );
    CREATE TABLE IF NOT EXISTS creators (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      alias TEXT,
      category_id TEXT REFERENCES categories(id),
      created_at TEXT NOT NULL,
      UNIQUE(category_id, name)
    );
    CREATE TABLE IF NOT EXISTS media_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      post_body TEXT,
      library_id TEXT NOT NULL REFERENCES libraries(id),
      category_id TEXT REFERENCES categories(id),
      creator_id TEXT REFERENCES creators(id),
      source_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      folder_path TEXT,
      fingerprint TEXT NOT NULL UNIQUE,
      cover_path TEXT,
      hidden INTEGER NOT NULL DEFAULT 0,
      structure_status TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media_parts (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      part_index INTEGER NOT NULL,
      path TEXT NOT NULL UNIQUE,
      size_bytes INTEGER NOT NULL,
      duration_seconds REAL,
      fingerprint TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media_images (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      path TEXT NOT NULL UNIQUE,
      sort_index INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      fingerprint TEXT NOT NULL,
      thumbnail_path TEXT
    );
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS media_tags (
      media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      UNIQUE(media_item_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      value REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS watch_progress (
      item_id TEXT PRIMARY KEY REFERENCES media_items(id) ON DELETE CASCADE,
      part_id TEXT REFERENCES media_parts(id),
      position_seconds REAL NOT NULL DEFAULT 0,
      finished INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      at_seconds REAL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scan_runs (
      id TEXT PRIMARY KEY,
      library_id TEXT REFERENCES libraries(id),
      status TEXT NOT NULL,
      message TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      items_indexed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS item_preferences (
      item_id TEXT PRIMARY KEY REFERENCES media_items(id) ON DELETE CASCADE,
      reaction TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creator_preferences (
      creator_id TEXT PRIMARY KEY REFERENCES creators(id) ON DELETE CASCADE,
      blacklisted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorite_folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL REFERENCES favorite_folders(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE(folder_id, item_id)
    );
    CREATE TABLE IF NOT EXISTS media_subtitles (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL REFERENCES media_parts(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      language TEXT NOT NULL,
      label TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_index INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS media_items_library_idx ON media_items(library_id);
    CREATE INDEX IF NOT EXISTS media_items_category_idx ON media_items(category_id);
    CREATE INDEX IF NOT EXISTS media_items_creator_idx ON media_items(creator_id);
    CREATE INDEX IF NOT EXISTS media_parts_item_idx ON media_parts(item_id);
    CREATE INDEX IF NOT EXISTS media_subtitles_part_idx ON media_subtitles(part_id);
    CREATE INDEX IF NOT EXISTS media_images_item_idx ON media_images(item_id);
    CREATE INDEX IF NOT EXISTS interactions_target_idx ON interactions(target_type, target_id);
    CREATE INDEX IF NOT EXISTS comments_item_idx ON comments(item_id);
    CREATE INDEX IF NOT EXISTS favorites_folder_idx ON favorites(folder_id);
    CREATE INDEX IF NOT EXISTS favorites_item_idx ON favorites(item_id);
  `);

  ensureColumn(db, "media_items", "generated_cover_path", "TEXT");
  ensureColumn(db, "media_items", "post_body", "TEXT");
  ensureColumn(db, "media_items", "thumbnail_status", "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn(db, "media_items", "thumbnail_error", "TEXT");
  ensureColumn(db, "media_items", "content_published_at", "TEXT");
  ensureColumn(db, "media_items", "file_modified_at", "TEXT");
  ensureColumn(db, "scan_runs", "thumbnails_total", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "scan_runs", "thumbnails_ready", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "scan_runs", "thumbnails_failed", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "media_parts", "preview_sprite_path", "TEXT");
  ensureColumn(db, "media_parts", "preview_sprite_cols", "INTEGER");
  ensureColumn(db, "media_parts", "preview_sprite_rows", "INTEGER");
  ensureColumn(db, "media_parts", "preview_sprite_interval", "REAL");
  ensureColumn(db, "media_parts", "preview_thumb_w", "INTEGER");
  ensureColumn(db, "media_parts", "preview_thumb_h", "INTEGER");
  ensureColumn(db, "media_parts", "stream_path", "TEXT");
  ensureColumn(db, "media_parts", "stream_size_bytes", "INTEGER");
  ensureColumn(db, "media_parts", "compatibility_status", "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn(db, "media_parts", "compatibility_error", "TEXT");
  ensureColumn(db, "creators", "alias", "TEXT");
  ensureColumn(db, "watch_progress", "started_at", "TEXT");
  ensureColumn(db, "watch_progress", "completed_at", "TEXT");
  ensureColumn(db, "item_preferences", "coined", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "item_preferences", "coined_at", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS media_items_library_relative_idx ON media_items(library_id, relative_path)");

  db.exec(`
    UPDATE watch_progress SET started_at = updated_at WHERE started_at IS NULL;
    UPDATE watch_progress
    SET finished = CASE WHEN EXISTS (
      SELECT 1
      FROM media_parts current_part
      WHERE current_part.id = watch_progress.part_id
        AND current_part.item_id = watch_progress.item_id
        AND current_part.part_index = (
          SELECT MAX(last_part.part_index) FROM media_parts last_part
          WHERE last_part.item_id = watch_progress.item_id
        )
        AND current_part.duration_seconds > 0
        AND watch_progress.position_seconds >= current_part.duration_seconds * 0.9
    ) THEN 1 ELSE 0 END;
    UPDATE watch_progress
    SET completed_at = CASE WHEN finished = 1 THEN COALESCE(completed_at, updated_at) ELSE NULL END;
  `);

  db.exec(`
    UPDATE media_items SET title = trim(substr(title, length('[未知]') + 1))
    WHERE title LIKE '[未知]%' AND trim(substr(title, length('[未知]') + 1)) != '';
    UPDATE media_parts SET title = trim(substr(title, length('[未知]') + 1))
    WHERE title LIKE '[未知]%' AND trim(substr(title, length('[未知]') + 1)) != '';
  `);
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export type SqliteDatabase = Database.Database;
