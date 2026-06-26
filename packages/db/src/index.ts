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
      description TEXT,
      avatar_path TEXT,
      banner_path TEXT,
      library_id TEXT REFERENCES libraries(id),
      category_id TEXT REFERENCES categories(id),
      created_at TEXT NOT NULL,
      updated_at TEXT,
      UNIQUE(category_id, name),
      UNIQUE(library_id, name)
    );
    CREATE TABLE IF NOT EXISTS media_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      post_body TEXT,
      description TEXT,
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
      source TEXT NOT NULL DEFAULT 'scan',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
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
      followed INTEGER NOT NULL DEFAULT 0,
      followed_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS creator_messages (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL UNIQUE REFERENCES media_items(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      read_at TEXT
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
    CREATE INDEX IF NOT EXISTS creator_messages_creator_idx ON creator_messages(creator_id);
    CREATE INDEX IF NOT EXISTS creator_messages_created_idx ON creator_messages(created_at);
  `);

  ensureColumn(db, "media_items", "generated_cover_path", "TEXT");
  ensureColumn(db, "media_items", "post_body", "TEXT");
  ensureColumn(db, "media_items", "description", "TEXT");
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
  ensureColumn(db, "creators", "description", "TEXT");
  ensureColumn(db, "creators", "avatar_path", "TEXT");
  ensureColumn(db, "creators", "banner_path", "TEXT");
  ensureColumn(db, "creators", "library_id", "TEXT");
  ensureColumn(db, "creators", "updated_at", "TEXT");
  ensureColumn(db, "watch_progress", "started_at", "TEXT");
  ensureColumn(db, "watch_progress", "completed_at", "TEXT");
  ensureColumn(db, "item_preferences", "coined", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "item_preferences", "coined_at", "TEXT");
  ensureColumn(db, "media_tags", "source", "TEXT NOT NULL DEFAULT 'scan'");
  ensureColumn(db, "media_tags", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "media_tags", "created_at", "TEXT");
  ensureColumn(db, "creator_preferences", "followed", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "creator_preferences", "followed_at", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS media_items_library_relative_idx ON media_items(library_id, relative_path)");
  mergeLegacyCreators(db);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS creators_library_name_idx ON creators(library_id, name)");

  db.exec(`
    UPDATE watch_progress SET started_at = updated_at WHERE started_at IS NULL;
    -- Older scanners rebuilt every media_parts row during each startup scan.
    -- Recover affected history by attaching it to the first playable part.
    UPDATE watch_progress
    SET part_id = (
      SELECT media_parts.id FROM media_parts
      WHERE media_parts.item_id = watch_progress.item_id
      ORDER BY media_parts.part_index ASC
      LIMIT 1
    )
    WHERE part_id IS NULL
      AND EXISTS (
        SELECT 1 FROM media_parts
        WHERE media_parts.item_id = watch_progress.item_id
      );
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

function mergeLegacyCreators(db: Database.Database) {
  db.exec(`
    UPDATE creators
    SET library_id = (
      SELECT categories.library_id FROM categories WHERE categories.id = creators.category_id
    )
    WHERE library_id IS NULL;
  `);
  const rows = db.prepare(`
    SELECT id, name, library_id AS libraryId, category_id AS categoryId, created_at AS createdAt,
      alias, description, avatar_path AS avatarPath, banner_path AS bannerPath
    FROM creators WHERE library_id IS NOT NULL
    ORDER BY created_at ASC, id ASC
  `).all() as {
    id: string; name: string; libraryId: string; categoryId: string | null; createdAt: string;
    alias: string | null; description: string | null; avatarPath: string | null; bannerPath: string | null;
  }[];
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.libraryId}\u0000${row.name}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const merge = db.transaction(() => {
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const canonical = group[0];
      for (const duplicate of group.slice(1)) {
        db.prepare(`
          UPDATE creators
          SET alias = COALESCE(alias, ?), description = COALESCE(description, ?),
            avatar_path = COALESCE(avatar_path, ?), banner_path = COALESCE(banner_path, ?)
          WHERE id = ?
        `).run(duplicate.alias, duplicate.description, duplicate.avatarPath, duplicate.bannerPath, canonical.id);
        db.prepare("UPDATE media_items SET creator_id = ? WHERE creator_id = ?").run(canonical.id, duplicate.id);
        db.prepare("UPDATE interactions SET target_id = ? WHERE target_type = 'creator' AND target_id = ?").run(canonical.id, duplicate.id);
        db.prepare("UPDATE creator_messages SET creator_id = ? WHERE creator_id = ?").run(canonical.id, duplicate.id);
        const preference = db.prepare(`
          SELECT blacklisted, followed, followed_at AS followedAt, updated_at AS updatedAt
          FROM creator_preferences WHERE creator_id = ?
        `).get(duplicate.id) as { blacklisted: number; followed: number; followedAt: string | null; updatedAt: string } | undefined;
        if (preference) {
          db.prepare(`
            INSERT INTO creator_preferences (creator_id, blacklisted, followed, followed_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(creator_id) DO UPDATE SET
              blacklisted = MAX(creator_preferences.blacklisted, excluded.blacklisted),
              followed = MAX(creator_preferences.followed, excluded.followed),
              followed_at = COALESCE(MIN(creator_preferences.followed_at, excluded.followed_at), creator_preferences.followed_at, excluded.followed_at),
              updated_at = MAX(creator_preferences.updated_at, excluded.updated_at)
          `).run(canonical.id, preference.blacklisted, preference.followed, preference.followedAt, preference.updatedAt);
          db.prepare("DELETE FROM creator_preferences WHERE creator_id = ?").run(duplicate.id);
        }
        db.prepare("DELETE FROM creators WHERE id = ?").run(duplicate.id);
      }
    }
  });
  merge();
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export type SqliteDatabase = Database.Database;
