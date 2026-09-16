import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ulid } from "ulid";
import type { SearchHistoryItem } from "@hilihili/shared";
import * as schema from "./schema.js";

// 重新导出 schema 让上层（apps/api）按字段名引用表，避免 SQL 字符串与 schema 脱节
export * from "./schema.js";

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
    sqlite.pragma("busy_timeout = 5000");
    // WAL 下 NORMAL 已能保证崩溃一致性（只有断电可能丢最后几个事务），
    // 换来的是每次写入不再强制 fsync —— 播放进度那种高频小写入收益明显。
    sqlite.pragma("synchronous = NORMAL");
    // 负数 = KiB。16MB 页缓存 + 256MB 只读 mmap，减少大表扫描时的磁盘读。
    sqlite.pragma("cache_size = -16000");
    sqlite.pragma("mmap_size = 268435456");
    sqlite.pragma("temp_store = MEMORY");
    applyMigrations(sqlite);
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
  return `${prefix}_${ulid()}`;
}

type Migration = { version: number; name: string; fn: (db: Database.Database) => void };

function migrationBaseline(db: Database.Database) {
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
      source TEXT NOT NULL DEFAULT 'legacy',
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
    CREATE TABLE IF NOT EXISTS search_history (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      searched_at INTEGER NOT NULL,
      UNIQUE(query)
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
  ensureColumn(db, "media_images", "is_animated", "INTEGER");
  ensureColumn(db, "media_images", "frame_count", "INTEGER");
  ensureColumn(db, "media_images", "duration_ms", "INTEGER");
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
  ensureColumn(db, "media_tags", "source", "TEXT NOT NULL DEFAULT 'legacy'");
  ensureColumn(db, "media_tags", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "media_tags", "created_at", "TEXT");
  ensureColumn(db, "creator_preferences", "followed", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "creator_preferences", "followed_at", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS media_items_library_relative_idx ON media_items(library_id, relative_path)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS creators_library_name_idx ON creators(library_id, name)");
}

function migrationWatchProgressRepair(db: Database.Database) {
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
}

function migrationCleanTitles(db: Database.Database) {
  db.exec(`
    UPDATE media_items SET title = trim(substr(title, length('[未知]') + 1))
    WHERE title LIKE '[未知]%' AND trim(substr(title, length('[未知]') + 1)) != '';
    UPDATE media_parts SET title = trim(substr(title, length('[未知]') + 1))
    WHERE title LIKE '[未知]%' AND trim(substr(title, length('[未知]') + 1)) != '';
  `);
}

function migrationMergeLegacyCreators(db: Database.Database) {
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

function migrationSearchHistoryTimestamp(db: Database.Database) {
  // SQLite has no ALTER COLUMN; rebuild the table to switch searched_at from
  // integer (unix ms) to text (ISO 8601). strftime produces the same shape as
  // nowIso() (T separator, fractional seconds, Z suffix) so ORDER BY stays
  // correct across migrated and freshly inserted rows.
  db.exec(`
    CREATE TABLE search_history_new (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      searched_at TEXT NOT NULL,
      UNIQUE(query)
    );
    INSERT INTO search_history_new (id, query, searched_at)
    SELECT id, query, strftime('%Y-%m-%dT%H:%M:%fZ', searched_at / 1000, 'unixepoch')
    FROM search_history;
    DROP TABLE search_history;
    ALTER TABLE search_history_new RENAME TO search_history;
    CREATE UNIQUE INDEX search_history_query_idx ON search_history(query);
  `);
}

function migrationAddScanTracking(db: Database.Database) {
  // ensureColumn is idempotent: new DBs reach this migration with the columns
  // absent (baseline CREATE TABLE does not declare them), and old DBs reach it
  // without the columns too. ALTER ADD COLUMN would fail if rerun, so we guard
  // each addition with a PRAGMA table_info check.
  ensureColumn(db, "media_items", "last_scanned_at", "TEXT");
  ensureColumn(db, "media_parts", "compatibility_attempts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "media_parts", "last_compatibility_attempt_at", "TEXT");
}

function migrationScanRunFailureCounts(db: Database.Database) {
  // 扫描自检：记录失败/跳过的条目数，settings 页展示给用户排查问题
  ensureColumn(db, "scan_runs", "items_failed", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "scan_runs", "items_skipped", "INTEGER NOT NULL DEFAULT 0");
}

function migrationAddHlsTranscode(db: Database.Database) {
  // HLS 远程播放产物。列名与 packages/db/src/schema.ts 的 mediaParts 对应。
  // 沿用 ensureColumn 的幂等约定：老库此刻没有这些列，新库的基线 CREATE TABLE 也不声明它们。
  ensureColumn(db, "media_parts", "hls_path", "TEXT");
  ensureColumn(db, "media_parts", "hls_fingerprint", "TEXT");
  ensureColumn(db, "media_parts", "hls_status", "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn(db, "media_parts", "hls_error", "TEXT");
  ensureColumn(db, "media_parts", "hls_ladder", "TEXT");
  ensureColumn(db, "media_parts", "hls_updated_at", "TEXT");
  ensureColumn(db, "media_parts", "hls_attempts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "media_parts", "last_played_at", "TEXT");
  ensureColumn(db, "media_parts", "play_count", "INTEGER NOT NULL DEFAULT 0");

  db.exec(`
    CREATE TABLE IF NOT EXISTS transcode_tasks (
      id TEXT PRIMARY KEY,
      part_id TEXT NOT NULL REFERENCES media_parts(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      profile TEXT NOT NULL,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      progress REAL NOT NULL DEFAULT 0,
      encoder TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      error TEXT,
      queued_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      next_attempt_at TEXT,
      bytes_out INTEGER,
      duration_ms INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS transcode_tasks_part_profile_idx ON transcode_tasks(part_id, profile);
    CREATE INDEX IF NOT EXISTS transcode_tasks_queue_idx ON transcode_tasks(status, priority, queued_at);
    CREATE INDEX IF NOT EXISTS transcode_tasks_fingerprint_idx ON transcode_tasks(fingerprint);
  `);

  // 封面基础分辨率由 640x360 提到 1280x720（仅当源视频够宽时，见 packages/media 的 generateThumbnail）。
  // 已生成的旧封面不会自动失效，这里显式作废一次让下次扫描按新尺寸重生成；
  // 旧文件由 media-cache 的孤儿清理回收。只动「没有自带 cover.jpg」的条目——
  // 自带封面的条目走原图路径，本来就不生成封面，改了状态反而会卡在 pending。
  db.exec(`
    UPDATE media_items
    SET generated_cover_path = NULL, thumbnail_status = 'pending'
    WHERE generated_cover_path IS NOT NULL AND cover_path IS NULL;
  `);
}

function migrationAddQueryIndexes(db: Database.Database) {
  // 补齐热路径缺失的索引。这些都是「全表扫 + 过滤」的典型场景：
  //   - interactions 只有 (target_type, target_id)，按 kind/时间筛要扫全表
  //   - media_images 按 (item_id, sort_index) 取图集首图，只有 item_id 单列索引
  //   - media_items 的 hidden/kind 过滤与首见时间排序都在信息流主查询里
  //   - watch_progress 按 finished 过滤「继续观看」
  // 全部 IF NOT EXISTS，老库新库都安全。
  db.exec(`
    CREATE INDEX IF NOT EXISTS interactions_kind_created_idx ON interactions(target_type, kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS media_images_item_sort_idx ON media_images(item_id, sort_index);
    CREATE INDEX IF NOT EXISTS media_items_hidden_kind_idx ON media_items(hidden, kind);
    CREATE INDEX IF NOT EXISTS media_items_seen_idx ON media_items(first_seen_at DESC);
    CREATE INDEX IF NOT EXISTS watch_progress_finished_idx ON watch_progress(finished, updated_at DESC);
    CREATE INDEX IF NOT EXISTS media_parts_hls_status_idx ON media_parts(hls_status);
  `);
}

const migrations: Migration[] = [
  { version: 0, name: "baseline", fn: migrationBaseline },
  { version: 1, name: "watch_progress_repair", fn: migrationWatchProgressRepair },
  { version: 2, name: "clean_titles", fn: migrationCleanTitles },
  { version: 3, name: "merge_legacy_creators", fn: migrationMergeLegacyCreators },
  { version: 4, name: "search_history_timestamp", fn: migrationSearchHistoryTimestamp },
  { version: 5, name: "add_scan_tracking", fn: migrationAddScanTracking },
  { version: 6, name: "scan_run_failure_counts", fn: migrationScanRunFailureCounts },
  { version: 7, name: "add_hls_transcode", fn: migrationAddHlsTranscode },
  { version: 8, name: "add_query_indexes", fn: migrationAddQueryIndexes },
];

function ensureSchemaMigrationsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function getAppliedVersions(db: Database.Database): Set<number> {
  const rows = db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[];
  return new Set(rows.map((r) => r.version));
}

function applyMigrations(db: Database.Database) {
  ensureSchemaMigrationsTable(db);
  const applied = getAppliedVersions(db);
  const pending = migrations.filter((m) => !applied.has(m.version));
  for (const migration of pending) {
    const run = db.transaction(() => {
      migration.fn(db);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.version, migration.name, nowIso());
    });
    run();
  }
}

function ensureColumn(db: Database.Database, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function upsertSearchHistory(query: string): void {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) return;
  getSqlite().prepare(`
    INSERT INTO search_history (id, query, searched_at)
    VALUES (?, ?, ?)
    ON CONFLICT(query) DO UPDATE SET searched_at = excluded.searched_at
  `).run(createId("srch"), normalized, nowIso());
}

export function listSearchHistory(limit = 20): SearchHistoryItem[] {
  const rows = getSqlite().prepare(`
    SELECT id, query, searched_at AS searchedAt
    FROM search_history
    ORDER BY searched_at DESC
    LIMIT ?
  `).all(limit) as SearchHistoryItem[];
  return rows;
}

export function clearSearchHistory(): void {
  getSqlite().prepare("DELETE FROM search_history").run();
}

export function deleteSearchHistory(id: string): void {
  getSqlite().prepare("DELETE FROM search_history WHERE id = ?").run(id);
}

export type SqliteDatabase = Database.Database;
