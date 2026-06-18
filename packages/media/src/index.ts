import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { createId, getDataDir, getSqlite, nowIso, type SqliteDatabase } from "@hilihili/db";
import { isImagePath, isVideoPath, type MediaKind, type StructureStatus } from "@hilihili/shared";

type LibraryRow = {
  id: string;
  name: string;
  root_path: string;
  enabled: number;
};

type MediaItemInput = {
  kind: MediaKind;
  title: string;
  libraryId: string;
  categoryId: string;
  creatorId: string;
  sourcePath: string;
  rootPath: string;
  folderPath: string | null;
  fingerprint: string;
  coverPath: string | null;
  structureStatus: StructureStatus;
};

type TagsIndex = Record<string, string[]>;

export async function scanEnabledLibraries() {
  const db = getSqlite();
  const libraries = db.prepare("SELECT * FROM libraries WHERE enabled = 1").all() as LibraryRow[];
  let total = 0;

  for (const library of libraries) {
    total += await scanLibrary(library.id);
  }

  return total;
}

export async function scanLibrary(libraryId: string) {
  const db = getSqlite();
  const library = db.prepare("SELECT * FROM libraries WHERE id = ?").get(libraryId) as LibraryRow | undefined;
  if (!library) {
    throw new Error(`Library not found: ${libraryId}`);
  }

  const runId = createId("scan");
  db.prepare("INSERT INTO scan_runs (id, library_id, status, started_at, items_indexed) VALUES (?, ?, ?, ?, ?)")
    .run(runId, libraryId, "running", nowIso(), 0);

  try {
    const tagsIndex = readTagsIndex(library.root_path);
    const count = scanRoot(db, library, tagsIndex);
    db.prepare("UPDATE scan_runs SET status = ?, finished_at = ?, items_indexed = ? WHERE id = ?")
      .run("complete", nowIso(), count, runId);
    return count;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare("UPDATE scan_runs SET status = ?, message = ?, finished_at = ? WHERE id = ?")
      .run("failed", message, nowIso(), runId);
    throw error;
  }
}

function scanRoot(db: SqliteDatabase, library: LibraryRow, tagsIndex: TagsIndex) {
  if (!existsSync(library.root_path)) {
    throw new Error(`Library path does not exist: ${library.root_path}`);
  }

  let indexed = 0;
  const entries = safeReadDir(library.root_path);

  for (const entry of entries) {
    const fullPath = join(library.root_path, entry);
    if (!safeStat(fullPath)?.isDirectory()) {
      continue;
    }

    if (entry.startsWith("_") && entry !== "_待归类") {
      continue;
    }

    indexed += scanCategory(db, library, entry, fullPath, tagsIndex);
  }

  indexed += scanRootLevelFiles(db, library, tagsIndex);
  return indexed;
}

function scanRootLevelFiles(db: SqliteDatabase, library: LibraryRow, tagsIndex: TagsIndex) {
  let indexed = 0;
  const categoryId = getOrCreateCategory(db, library.id, "未归类");
  const creatorId = getOrCreateCreator(db, categoryId, "未知UP");

  for (const entry of safeReadDir(library.root_path)) {
    const fullPath = join(library.root_path, entry);
    const stat = safeStat(fullPath);
    if (stat?.isFile() && (isVideoPath(fullPath) || isImagePath(fullPath))) {
      indexed += indexSingleFile(db, library, categoryId, creatorId, "未归类", "未知UP", fullPath, tagsIndex, "fallback");
    }
  }

  return indexed;
}

function scanCategory(db: SqliteDatabase, library: LibraryRow, categoryName: string, categoryPath: string, tagsIndex: TagsIndex) {
  let indexed = 0;
  const categoryId = getOrCreateCategory(db, library.id, categoryName);
  const entries = safeReadDir(categoryPath);

  for (const entry of entries) {
    const fullPath = join(categoryPath, entry);
    const stat = safeStat(fullPath);
    if (!stat) {
      continue;
    }

    if (stat.isDirectory()) {
      if (entry.startsWith("_") && entry !== "_无UP主") {
        indexed += scanFallbackFiles(db, library, categoryName, "未知UP", fullPath, tagsIndex);
        continue;
      }
      indexed += scanCreator(db, library, categoryId, categoryName, entry, fullPath, tagsIndex);
      continue;
    }

    if (isVideoPath(fullPath) || isImagePath(fullPath)) {
      const creatorId = getOrCreateCreator(db, categoryId, "未知UP");
      indexed += indexSingleFile(db, library, categoryId, creatorId, categoryName, "未知UP", fullPath, tagsIndex, "fallback");
    }
  }

  return indexed;
}

function scanCreator(
  db: SqliteDatabase,
  library: LibraryRow,
  categoryId: string,
  categoryName: string,
  creatorName: string,
  creatorPath: string,
  tagsIndex: TagsIndex
) {
  let indexed = 0;
  const displayCreator = creatorName === "_无UP主" ? "未知UP" : creatorName;
  const creatorId = getOrCreateCreator(db, categoryId, displayCreator);

  for (const entry of safeReadDir(creatorPath)) {
    const fullPath = join(creatorPath, entry);
    const stat = safeStat(fullPath);
    if (!stat) {
      continue;
    }

    if (stat.isDirectory()) {
      if (entry.startsWith("_")) {
        continue;
      }

      const videos = safeReadDir(fullPath)
        .map((name) => join(fullPath, name))
        .filter((path) => safeStat(path)?.isFile() && isVideoPath(path))
        .sort(comparePartNames);
      const images = safeReadDir(fullPath)
        .map((name) => join(fullPath, name))
        .filter((path) => safeStat(path)?.isFile() && isImagePath(path));

      if (videos.length > 0) {
        indexed += indexMultiPartVideo(db, library, categoryId, creatorId, fullPath, videos, tagsIndex);
      } else if (images.length > 0) {
        for (const image of images) {
          indexed += indexSingleFile(db, library, categoryId, creatorId, categoryName, displayCreator, image, tagsIndex, "standard");
        }
      } else {
        indexed += scanFallbackFiles(db, library, categoryName, displayCreator, fullPath, tagsIndex);
      }
      continue;
    }

    if (isVideoPath(fullPath) || isImagePath(fullPath)) {
      indexed += indexSingleFile(db, library, categoryId, creatorId, categoryName, displayCreator, fullPath, tagsIndex, "standard");
    }
  }

  return indexed;
}

function scanFallbackFiles(
  db: SqliteDatabase,
  library: LibraryRow,
  categoryName: string,
  creatorName: string,
  startPath: string,
  tagsIndex: TagsIndex
) {
  let indexed = 0;
  const categoryId = getOrCreateCategory(db, library.id, categoryName);
  const creatorId = getOrCreateCreator(db, categoryId, creatorName);

  for (const entry of safeReadDir(startPath)) {
    const fullPath = join(startPath, entry);
    const stat = safeStat(fullPath);
    if (!stat) {
      continue;
    }

    if (stat.isDirectory()) {
      if (entry.startsWith("_") && entry !== "_待归类") {
        continue;
      }
      indexed += scanFallbackFiles(db, library, categoryName, creatorName, fullPath, tagsIndex);
      continue;
    }

    if (isVideoPath(fullPath) || isImagePath(fullPath)) {
      indexed += indexSingleFile(db, library, categoryId, creatorId, categoryName, creatorName, fullPath, tagsIndex, "fallback");
    }
  }

  return indexed;
}

function indexMultiPartVideo(
  db: SqliteDatabase,
  library: LibraryRow,
  categoryId: string,
  creatorId: string,
  folderPath: string,
  videos: string[],
  tagsIndex: TagsIndex
) {
  const info = readInfo(folderPath);
  const title = info.title ?? cleanTitle(basename(folderPath));
  const partFingerprints = videos.map((path) => fingerprintFile(path)).join("|");
  const fingerprint = stableHash(`multi:${partFingerprints}`);
  const coverPath = findCover(folderPath);
  const itemId = upsertMediaItem(db, {
    kind: "video",
    title,
    libraryId: library.id,
    categoryId,
    creatorId,
    sourcePath: folderPath,
    rootPath: library.root_path,
    folderPath,
    fingerprint,
    coverPath,
    structureStatus: "standard"
  });

  db.prepare("DELETE FROM media_parts WHERE item_id = ?").run(itemId);

  videos.forEach((path, index) => {
    const partName = basename(path, extname(path));
    const pKey = partName.match(/^p(\d+)$/i)?.[0].toUpperCase();
    const titleForPart = pKey && info.p_titles?.[pKey] ? info.p_titles[pKey] : cleanTitle(partName);
    const stat = statSync(path);
    db.prepare(`
      INSERT INTO media_parts (id, item_id, title, part_index, path, size_bytes, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(createId("part"), itemId, titleForPart, index + 1, path, stat.size, fingerprintFile(path));
  });

  applyTags(db, itemId, library.root_path, folderPath, tagsIndex);
  return 1;
}

function indexSingleFile(
  db: SqliteDatabase,
  library: LibraryRow,
  categoryId: string,
  creatorId: string,
  categoryName: string,
  creatorName: string,
  filePath: string,
  tagsIndex: TagsIndex,
  structureStatus: StructureStatus
) {
  const folderPath = dirname(filePath);
  const sidecarInfo = readInfo(folderPath);
  const title = sidecarInfo.title ?? deriveTitleFromFile(filePath, creatorName);
  const kind: MediaKind = isVideoPath(filePath) ? "video" : "image";
  const coverPath = kind === "video" ? findCover(folderPath) : filePath;
  const itemId = upsertMediaItem(db, {
    kind,
    title,
    libraryId: library.id,
    categoryId,
    creatorId,
    sourcePath: filePath,
    rootPath: library.root_path,
    folderPath,
    fingerprint: fingerprintFile(filePath),
    coverPath,
    structureStatus
  });

  if (kind === "video") {
    const stat = statSync(filePath);
    db.prepare("DELETE FROM media_parts WHERE item_id = ?").run(itemId);
    db.prepare(`
      INSERT INTO media_parts (id, item_id, title, part_index, path, size_bytes, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(createId("part"), itemId, title, 1, filePath, stat.size, fingerprintFile(filePath));
  }

  applyTags(db, itemId, library.root_path, filePath, tagsIndex);
  applyTags(db, itemId, library.root_path, join(categoryName, creatorName), tagsIndex);
  return 1;
}

function upsertMediaItem(db: SqliteDatabase, input: MediaItemInput) {
  const now = nowIso();
  const relativePath = normalizeRelative(relative(input.rootPath, input.sourcePath));
  const existing = db.prepare("SELECT id FROM media_items WHERE fingerprint = ?").get(input.fingerprint) as { id: string } | undefined;

  if (existing) {
    db.prepare(`
      UPDATE media_items
      SET kind = ?, title = ?, library_id = ?, category_id = ?, creator_id = ?, source_path = ?,
          relative_path = ?, folder_path = ?, cover_path = ?, structure_status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.kind,
      input.title,
      input.libraryId,
      input.categoryId,
      input.creatorId,
      input.sourcePath,
      relativePath,
      input.folderPath,
      input.coverPath,
      input.structureStatus,
      now,
      existing.id
    );
    return existing.id;
  }

  const id = createId("item");
  db.prepare(`
    INSERT INTO media_items (
      id, kind, title, library_id, category_id, creator_id, source_path, relative_path,
      folder_path, fingerprint, cover_path, hidden, structure_status, first_seen_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(
    id,
    input.kind,
    input.title,
    input.libraryId,
    input.categoryId,
    input.creatorId,
    input.sourcePath,
    relativePath,
    input.folderPath,
    input.fingerprint,
    input.coverPath,
    input.structureStatus,
    now,
    now
  );
  return id;
}

function getOrCreateCategory(db: SqliteDatabase, libraryId: string, name: string) {
  const existing = db.prepare("SELECT id FROM categories WHERE library_id = ? AND name = ?").get(libraryId, name) as { id: string } | undefined;
  if (existing) {
    return existing.id;
  }
  const id = createId("cat");
  db.prepare("INSERT INTO categories (id, name, library_id, created_at) VALUES (?, ?, ?, ?)")
    .run(id, name, libraryId, nowIso());
  return id;
}

function getOrCreateCreator(db: SqliteDatabase, categoryId: string, name: string) {
  const existing = db.prepare("SELECT id FROM creators WHERE category_id = ? AND name = ?").get(categoryId, name) as { id: string } | undefined;
  if (existing) {
    return existing.id;
  }
  const id = createId("up");
  db.prepare("INSERT INTO creators (id, name, category_id, created_at) VALUES (?, ?, ?, ?)")
    .run(id, name, categoryId, nowIso());
  return id;
}

function applyTags(db: SqliteDatabase, itemId: string, rootPath: string, targetPath: string, tagsIndex: TagsIndex) {
  const relativePath = targetPath.startsWith(rootPath)
    ? normalizeRelative(relative(rootPath, targetPath))
    : normalizeRelative(targetPath);
  const tagNames = tagsIndex[relativePath] ?? tagsIndex[relativePath.replace(/\.[^.]+$/, "")] ?? [];

  for (const tagName of tagNames) {
    const tagId = getOrCreateTag(db, tagName);
    db.prepare("INSERT OR IGNORE INTO media_tags (media_item_id, tag_id) VALUES (?, ?)").run(itemId, tagId);
  }
}

function getOrCreateTag(db: SqliteDatabase, name: string) {
  const existing = db.prepare("SELECT id FROM tags WHERE name = ?").get(name) as { id: string } | undefined;
  if (existing) {
    return existing.id;
  }
  const id = createId("tag");
  db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").run(id, name);
  return id;
}

function fingerprintFile(filePath: string) {
  const stat = statSync(filePath);
  const buffer = Buffer.alloc(Math.min(65536, stat.size));
  const handle = openSync(filePath, "r");
  try {
    readSync(handle, buffer, 0, buffer.length, 0);
  } finally {
    closeSync(handle);
  }
  return stableHash(`${stat.size}:${stat.mtimeMs}:${buffer.toString("base64")}`);
}

function stableHash(value: string) {
  return createHash("sha1").update(value).digest("hex");
}

function readTagsIndex(rootPath: string): TagsIndex {
  const path = join(rootPath, "_tags.json");
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TagsIndex;
  } catch {
    return {};
  }
}

function readInfo(folderPath: string): { title?: string; p_titles?: Record<string, string> } {
  const path = join(folderPath, "info.json");
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as { title?: string; p_titles?: Record<string, string> };
  } catch {
    return {};
  }
}

function findCover(folderPath: string) {
  const candidates = ["cover.jpg", "cover.jpeg", "cover.png", "folder.jpg"].map((name) => join(folderPath, name));
  return candidates.find((path) => existsSync(path)) ?? null;
}

function deriveTitleFromFile(filePath: string, creatorName: string) {
  const raw = basename(filePath, extname(filePath));
  const prefix = `${creatorName}_`;
  return cleanTitle(raw.startsWith(prefix) ? raw.slice(prefix.length) : raw);
}

function cleanTitle(value: string) {
  return value.replace(/^\[\d{4}-\d{2}\]\s*/, "").replace(/[_-]\d+$/, "").replaceAll("_", " ").trim();
}

function normalizeRelative(value: string) {
  return value.split(sep).join("/");
}

function comparePartNames(a: string, b: string) {
  return partNumber(a) - partNumber(b) || a.localeCompare(b);
}

function partNumber(path: string) {
  const match = basename(path).match(/^P(\d+)/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function safeReadDir(path: string) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function safeStat(path: string) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

export function getAppMediaCacheDir() {
  return join(getDataDir(), "media-cache");
}
