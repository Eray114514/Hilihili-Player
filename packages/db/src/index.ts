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
      category_id TEXT REFERENCES categories(id),
      created_at TEXT NOT NULL,
      UNIQUE(category_id, name)
    );
    CREATE TABLE IF NOT EXISTS media_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS media_items_library_idx ON media_items(library_id);
    CREATE INDEX IF NOT EXISTS media_items_category_idx ON media_items(category_id);
    CREATE INDEX IF NOT EXISTS media_items_creator_idx ON media_items(creator_id);
    CREATE INDEX IF NOT EXISTS media_parts_item_idx ON media_parts(item_id);
    CREATE INDEX IF NOT EXISTS interactions_target_idx ON interactions(target_type, target_id);
    CREATE INDEX IF NOT EXISTS comments_item_idx ON comments(item_id);
  `);
}

export type SqliteDatabase = Database.Database;
