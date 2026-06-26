import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { createId, getDataDir, getSqlite, nowIso, type SqliteDatabase } from "@hilihili/db";
import { isImagePath, isVideoPath, type MediaKind, type StructureStatus } from "@hilihili/shared";
import sharp from "sharp";

const require = createRequire(import.meta.url);

type LibraryRow = {
  id: string;
  name: string;
  root_path: string;
  enabled: number;
};

type MediaItemInput = {
  kind: MediaKind;
  title: string;
  postBody: string | null;
  libraryId: string;
  categoryId: string;
  creatorId: string;
  sourcePath: string;
  rootPath: string;
  folderPath: string | null;
  fingerprint: string;
  coverPath: string | null;
  contentPublishedAt: string | null;
  fileModifiedAt: string;
  hidden: boolean;
  structureStatus: StructureStatus;
};

type TagIndexEntry = string[] | { add?: string[]; remove?: string[] };
type TagsIndex = Record<string, TagIndexEntry>;
type ScanContext = { seenItemIds: Set<string> };
export type ItemTag = { id: string; name: string; source: "scan" | "manual"; sortOrder: number };
type InfoJson = {
  title?: string;
  date?: string;
  published_at?: string;
  alias?: string;
  p_titles?: Record<string, string>;
  hidden?: boolean;
};

const SUBTITLE_EXTS = [".srt", ".vtt"];

type SubtitleCandidate = {
  path: string;
  language: string;
  label: string;
  codeInFilename: string | null;
  isDefault: boolean;
  sortIndex: number;
};

function normalizeLanguageCode(raw: string): { code: string; label: string } | null {
  const code = raw.toLowerCase();
  const chinese = ["zh", "cmn", "chi", "zho", "chs", "cht", "sc", "tc"];
  const korean = ["ko", "kor", "ys", "kr"];
  const english = ["en", "eng", "us"];
  const japanese = ["ja", "jpn", "jp"];
  const spanish = ["es", "spa"];
  const french = ["fr", "fra", "fre"];
  const german = ["de", "deu", "ger"];
  const russian = ["ru", "rus"];

  if (chinese.includes(code)) return { code: "zh", label: "中文" };
  if (korean.includes(code)) return { code: "ko", label: "韩语" };
  if (english.includes(code)) return { code: "en", label: "英文" };
  if (japanese.includes(code)) return { code: "ja", label: "日文" };
  if (spanish.includes(code)) return { code: "es", label: "西班牙文" };
  if (french.includes(code)) return { code: "fr", label: "法文" };
  if (german.includes(code)) return { code: "de", label: "德文" };
  if (russian.includes(code)) return { code: "ru", label: "俄文" };
  if (/^[a-z]{2,3}$/.test(code)) return { code, label: code.toUpperCase() };
  return null;
}

function scanSubtitles(db: SqliteDatabase, partId: string, videoPath: string) {
  const folder = dirname(videoPath);
  const base = basename(videoPath, extname(videoPath));
  const entries = safeReadDir(folder);
  const candidates: SubtitleCandidate[] = [];

  for (const entry of entries) {
    const fullPath = join(folder, entry);
    const stat = safeStat(fullPath);
    if (!stat?.isFile()) continue;
    const ext = extname(entry).toLowerCase();
    if (!SUBTITLE_EXTS.includes(ext)) continue;
    const fileBase = basename(entry, ext);
    if (!fileBase.startsWith(base)) continue;

    const remainder = fileBase.slice(base.length);
    const match = remainder.match(/^[._-]([a-zA-Z0-9]{2,3})$/);
    const codeRaw = match?.[1] ?? null;
    const normalized = codeRaw ? normalizeLanguageCode(codeRaw) : null;

    if (codeRaw && !normalized) continue;

    if (normalized) {
      candidates.push({
        path: fullPath,
        language: normalized.code,
        label: normalized.label,
        codeInFilename: codeRaw!.toLowerCase(),
        isDefault: false,
        sortIndex: 0
      });
    } else if (fileBase === base) {
      candidates.push({
        path: fullPath,
        language: "und",
        label: "默认",
        codeInFilename: null,
        isDefault: false,
        sortIndex: 0
      });
    }
  }

  if (candidates.length === 0) return;

  const priority = (c: SubtitleCandidate) => {
    if (c.language === "zh") return 0;
    if (c.language === "ko") return 1;
    if (c.language === "en") return 2;
    if (c.language === "ja") return 3;
    if (c.language === "und") return 99;
    return 50;
  };

  candidates.sort((a, b) => priority(a) - priority(b) || a.label.localeCompare(b.label, "zh-CN"));
  const hasZh = candidates.some((c) => c.language === "zh");
  const hasDefaultCandidate = candidates.some((c) => c.language !== "und");

  candidates.forEach((candidate, index) => {
    candidate.sortIndex = index;
    candidate.isDefault = hasZh
      ? candidate.language === "zh"
      : !hasDefaultCandidate
        ? index === 0
        : candidate.language !== "und" && index === 0;
  });

  const selectId = db.prepare("SELECT id FROM media_subtitles WHERE part_id = ? AND path = ?");
  const insert = db.prepare(`
    INSERT INTO media_subtitles (id, part_id, path, language, label, is_default, sort_index)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE media_subtitles
    SET language = ?, label = ?, is_default = ?, sort_index = ?
    WHERE id = ?
  `);
  for (const candidate of candidates) {
    const existing = selectId.get(partId, candidate.path) as { id: string } | undefined;
    if (existing) {
      update.run(candidate.language, candidate.label, candidate.isDefault ? 1 : 0, candidate.sortIndex, existing.id);
    } else {
      insert.run(createId("sub"), partId, candidate.path, candidate.language, candidate.label, candidate.isDefault ? 1 : 0, candidate.sortIndex);
    }
  }
}

function upsertPartWithSubtitles(
  db: SqliteDatabase,
  itemId: string,
  title: string,
  partIndex: number,
  videoPath: string,
  sizeBytes: number,
  fingerprint: string
) {
  // media_parts.path 是 UNIQUE 约束。clearParts 只会清理当前 item 的分片，
  // 若同一路径仍挂在其它 item 上（例如上次扫描失败遗留的孤儿分片，或目录结构
  // 变化导致 upsertMediaItem 新建了 item），直接 INSERT 会触发 UNIQUE 冲突。
  // 这里复用已存在的行：路径相同意味着文件相同，duration/stream/预览图等派生
  // 元数据仍然有效，只需把归属 item 和基础字段更新到当前值即可。
  const existing = db.prepare("SELECT id FROM media_parts WHERE path = ?").get(videoPath) as { id: string } | undefined;
  let partId: string;
  if (existing) {
    partId = existing.id;
    db.prepare(`
      UPDATE media_parts
      SET item_id = ?, title = ?, part_index = ?, size_bytes = ?, fingerprint = ?
      WHERE id = ?
    `).run(itemId, title, partIndex, sizeBytes, fingerprint, partId);
  } else {
    partId = createId("part");
    db.prepare(`
      INSERT INTO media_parts (id, item_id, title, part_index, path, size_bytes, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(partId, itemId, title, partIndex, videoPath, sizeBytes, fingerprint);
  }
  // 复用行时旧的字幕仍存在，先清空再重扫，避免重复。
  db.prepare("DELETE FROM media_subtitles WHERE part_id = ?").run(partId);
  scanSubtitles(db, partId, videoPath);
  return partId;
}

export function enqueueScan(libraryId?: string) {
  const db = getSqlite();
  const existing = (libraryId
    ? db.prepare("SELECT id FROM scan_runs WHERE status IN ('queued', 'running') AND (library_id = ? OR library_id IS NULL) ORDER BY started_at DESC LIMIT 1").get(libraryId)
    : db.prepare("SELECT id FROM scan_runs WHERE status IN ('queued', 'running') ORDER BY started_at DESC LIMIT 1").get()) as { id: string } | undefined;
  if (existing) {
    return existing.id;
  }
  const runId = createId("scan");
  db.prepare("INSERT INTO scan_runs (id, library_id, status, started_at, items_indexed) VALUES (?, ?, 'queued', ?, 0)")
    .run(runId, libraryId ?? null, nowIso());
  return runId;
}

export async function processNextScanRun() {
  const db = getSqlite();
  const run = db.prepare("SELECT id, library_id FROM scan_runs WHERE status = 'queued' ORDER BY started_at ASC LIMIT 1")
    .get() as { id: string; library_id: string | null } | undefined;
  if (!run) {
    return false;
  }

  db.prepare("UPDATE scan_runs SET status = 'running', message = NULL WHERE id = ?").run(run.id);
  try {
    const libraries = run.library_id
      ? db.prepare("SELECT * FROM libraries WHERE id = ? AND enabled = 1").all(run.library_id) as LibraryRow[]
      : db.prepare("SELECT * FROM libraries WHERE enabled = 1").all() as LibraryRow[];
    if (run.library_id && libraries.length === 0) {
      throw new Error(`Library not found: ${run.library_id}`);
    }

    let indexed = 0;
    for (const library of libraries) {
      indexed += scanLibraryContents(db, library);
      db.prepare("UPDATE scan_runs SET items_indexed = ? WHERE id = ?").run(indexed, run.id);
    }

    await generateMissingThumbnails(db, run.id, libraries.map((item) => item.id));
    pruneOrphanTags(db);
    db.prepare("UPDATE scan_runs SET status = 'complete', finished_at = ?, items_indexed = ? WHERE id = ?")
      .run(nowIso(), indexed, run.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 扫描失败不仅要写进 scan_runs.message，也要打到 stdout，否则 worker 日志
    // 只会看到 "scan run complete" 而看不到失败原因。
    console.error(`[media] scan run ${run.id} failed: ${message}`, error);
    db.prepare("UPDATE scan_runs SET status = 'failed', message = ?, finished_at = ? WHERE id = ?")
      .run(message, nowIso(), run.id);
  }
  return true;
}

export async function scanEnabledLibraries() {
  const db = getSqlite();
  const libraries = db.prepare("SELECT * FROM libraries WHERE enabled = 1").all() as LibraryRow[];
  let total = 0;

  for (const library of libraries) {
    total += scanLibraryContents(db, library);
  }

  pruneOrphanTags(db);
  return total;
}

export async function scanLibrary(libraryId: string) {
  const db = getSqlite();
  const library = db.prepare("SELECT * FROM libraries WHERE id = ?").get(libraryId) as LibraryRow | undefined;
  if (!library) {
    throw new Error(`Library not found: ${libraryId}`);
  }

  const result = scanLibraryContents(db, library);
  pruneOrphanTags(db);
  return result;
}

function scanLibraryContents(db: SqliteDatabase, library: LibraryRow) {
  const tagsIndex = readTagsIndex(library.root_path);
  const context: ScanContext = { seenItemIds: new Set() };
  const indexed = scanRoot(db, library, tagsIndex, context);
  pruneUnseenItems(db, library.id, context.seenItemIds);
  return indexed;
}

function scanRoot(db: SqliteDatabase, library: LibraryRow, tagsIndex: TagsIndex, context: ScanContext) {
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

    indexed += scanCategory(db, library, entry, fullPath, tagsIndex, context);
  }

  indexed += scanRootLevelFiles(db, library, tagsIndex, context);
  return indexed;
}

function scanRootLevelFiles(db: SqliteDatabase, library: LibraryRow, tagsIndex: TagsIndex, context: ScanContext) {
  let indexed = 0;
  const categoryId = getOrCreateCategory(db, library.id, "未归类");
  const creatorId = getOrCreateCreator(db, categoryId, "未知UP");

  for (const entry of safeReadDir(library.root_path)) {
    const fullPath = join(library.root_path, entry);
    const stat = safeStat(fullPath);
    if (stat?.isFile() && (isVideoPath(fullPath) || isImagePath(fullPath))) {
      indexed += indexSingleFile(db, library, categoryId, creatorId, "未归类", "未知UP", fullPath, tagsIndex, "fallback", context);
    }
  }

  return indexed;
}

function scanCategory(db: SqliteDatabase, library: LibraryRow, categoryName: string, categoryPath: string, tagsIndex: TagsIndex, context: ScanContext) {
  if (categoryName === "_待归类") {
    return scanFallbackFiles(db, library, "待归类", "未知UP", categoryPath, tagsIndex, context);
  }
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
        continue;
      }
      indexed += scanCreator(db, library, categoryId, categoryName, entry, fullPath, tagsIndex, context);
      continue;
    }

    if (isVideoPath(fullPath) || isImagePath(fullPath)) {
      const creatorId = getOrCreateCreator(db, categoryId, "未知UP");
      indexed += indexSingleFile(db, library, categoryId, creatorId, categoryName, "未知UP", fullPath, tagsIndex, "fallback", context);
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
  tagsIndex: TagsIndex,
  context: ScanContext
) {
  let indexed = 0;
  const displayCreator = creatorName === "_无UP主" ? "未知UP" : creatorName;
  const creatorInfo = readInfoFile(join(creatorPath, "info.json"));
  const creatorId = getOrCreateCreator(db, categoryId, displayCreator, creatorInfo.alias);

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

      const childEntries = safeReadDir(fullPath);
      const videos = childEntries
        .map((name) => join(fullPath, name))
        .filter((path) => safeStat(path)?.isFile() && isVideoPath(path))
        .sort(comparePartNames);
      const images = childEntries
        .map((name) => join(fullPath, name))
        .filter((path) => safeStat(path)?.isFile() && isContentImage(path))
        .sort(compareNaturalPaths);

      if (existsSync(join(fullPath, "post.txt"))) {
        indexed += indexPost(db, library, categoryId, creatorId, fullPath, videos, images, tagsIndex, context);
      } else if (entry === "图片") {
        indexed += indexGallery(db, library, categoryId, creatorId, displayCreator, fullPath, images, tagsIndex, context);
      } else if (videos.length > 0) {
        indexed += indexMultiPartVideo(db, library, categoryId, creatorId, fullPath, videos, tagsIndex, context);
      } else if (images.length > 0) {
        indexed += indexGallery(db, library, categoryId, creatorId, displayCreator, fullPath, images, tagsIndex, context);
      } else {
        indexed += scanFallbackFiles(db, library, categoryName, displayCreator, fullPath, tagsIndex, context);
      }
      continue;
    }

    if (isVideoPath(fullPath) || isImagePath(fullPath)) {
      indexed += indexSingleFile(db, library, categoryId, creatorId, categoryName, displayCreator, fullPath, tagsIndex, "standard", context);
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
  tagsIndex: TagsIndex,
  context: ScanContext
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
      const childEntries = safeReadDir(fullPath);
      const videos = childEntries.map((name) => join(fullPath, name)).filter((path) => safeStat(path)?.isFile() && isVideoPath(path)).sort(comparePartNames);
      const images = childEntries.map((name) => join(fullPath, name)).filter((path) => safeStat(path)?.isFile() && isContentImage(path)).sort(compareNaturalPaths);
      if (existsSync(join(fullPath, "post.txt"))) {
        indexed += indexPost(db, library, categoryId, creatorId, fullPath, videos, images, tagsIndex, context);
        continue;
      }
      if (entry === "图片" && images.length > 0) {
        indexed += indexGallery(db, library, categoryId, creatorId, creatorName, fullPath, images, tagsIndex, context);
        continue;
      }
      if (videos.length > 0) {
        indexed += indexMultiPartVideo(db, library, categoryId, creatorId, fullPath, videos, tagsIndex, context);
        continue;
      }
      if (images.length > 0) {
        indexed += indexGallery(db, library, categoryId, creatorId, creatorName, fullPath, images, tagsIndex, context);
        continue;
      }
      indexed += scanFallbackFiles(db, library, categoryName, creatorName, fullPath, tagsIndex, context);
      continue;
    }

    if (isVideoPath(fullPath) || isImagePath(fullPath)) {
      indexed += indexSingleFile(db, library, categoryId, creatorId, categoryName, creatorName, fullPath, tagsIndex, "fallback", context);
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
  tagsIndex: TagsIndex,
  context: ScanContext
) {
  const info = readInfo(folderPath);
  const title = info.title ?? cleanTitle(basename(folderPath));
  const partFingerprints = videos.map((path) => fingerprintFile(path)).join("|");
  const fingerprint = stableHash(`multi:${partFingerprints}`);
  const coverPath = findCover(folderPath);
  const modifiedAt = new Date(Math.max(...videos.map((path) => statSync(path).mtimeMs))).toISOString();
  clearLegacyChildren(db, library.id, folderPath);
  const itemId = upsertMediaItem(db, {
    kind: "video",
    title,
    postBody: null,
    libraryId: library.id,
    categoryId,
    creatorId,
    sourcePath: folderPath,
    rootPath: library.root_path,
    folderPath,
    fingerprint,
    coverPath,
    contentPublishedAt: resolveContentDate(info, folderPath),
    fileModifiedAt: modifiedAt,
    hidden: Boolean(info.hidden),
    structureStatus: "standard"
  }, context);

  replaceParts(db, itemId, videos, info);

  db.prepare("DELETE FROM media_images WHERE item_id = ?").run(itemId);
  applyTags(db, itemId, library.root_path, folderPath, tagsIndex);
  return 1;
}

function indexPost(
  db: SqliteDatabase,
  library: LibraryRow,
  categoryId: string,
  creatorId: string,
  folderPath: string,
  videos: string[],
  images: string[],
  tagsIndex: TagsIndex,
  context: ScanContext
) {
  const info = readInfo(folderPath);
  const postPath = join(folderPath, "post.txt");
  const postBody = safeReadText(postPath).trim();
  const allFiles = [postPath, ...videos, ...images].filter(existsSync);
  const modifiedAt = newestModifiedAt(allFiles, folderPath);
  clearLegacyChildren(db, library.id, folderPath);
  const itemId = upsertMediaItem(db, {
    kind: "post",
    title: info.title ?? cleanTitle(basename(folderPath)),
    postBody,
    libraryId: library.id,
    categoryId,
    creatorId,
    sourcePath: folderPath,
    rootPath: library.root_path,
    folderPath,
    fingerprint: compositeFingerprint(allFiles),
    coverPath: videos.length > 0 ? findCover(folderPath) : images[0] ?? null,
    contentPublishedAt: resolveContentDate(info, folderPath),
    fileModifiedAt: modifiedAt,
    hidden: Boolean(info.hidden),
    structureStatus: "standard"
  }, context);
  replaceParts(db, itemId, videos, info);
  replaceImages(db, itemId, images);
  applyTags(db, itemId, library.root_path, folderPath, tagsIndex);
  return 1;
}

function indexGallery(
  db: SqliteDatabase,
  library: LibraryRow,
  categoryId: string,
  creatorId: string,
  creatorName: string,
  folderPath: string,
  images: string[],
  tagsIndex: TagsIndex,
  context: ScanContext
) {
  if (images.length === 0) return 0;
  const info = readInfo(folderPath);
  clearLegacyChildren(db, library.id, folderPath);
  const itemId = upsertMediaItem(db, {
    kind: "image",
    title: info.title ?? (basename(folderPath) === "图片" ? `${creatorName} 图片集` : cleanTitle(basename(folderPath))),
    postBody: null,
    libraryId: library.id,
    categoryId,
    creatorId,
    sourcePath: folderPath,
    rootPath: library.root_path,
    folderPath,
    fingerprint: compositeFingerprint(images),
    coverPath: images[0] ?? null,
    contentPublishedAt: resolveContentDate(info, folderPath, images),
    fileModifiedAt: newestModifiedAt(images, folderPath),
    hidden: Boolean(info.hidden),
    structureStatus: "standard"
  }, context);
  clearParts(db, itemId);
  replaceImages(db, itemId, images);
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
  structureStatus: StructureStatus,
  context: ScanContext
) {
  const folderPath = dirname(filePath);
  const sidecarInfo = readFileSidecar(filePath);
  const title = sidecarInfo.title ?? deriveTitleFromFile(filePath, creatorName);
  const kind: MediaKind = isVideoPath(filePath) ? "video" : "image";
  const coverPath = kind === "video" ? findCover(folderPath) : filePath;
  const fileStat = statSync(filePath);
  const itemId = upsertMediaItem(db, {
    kind,
    title,
    postBody: null,
    libraryId: library.id,
    categoryId,
    creatorId,
    sourcePath: filePath,
    rootPath: library.root_path,
    folderPath,
    fingerprint: fingerprintFile(filePath),
    coverPath,
    contentPublishedAt: resolveContentDate(sidecarInfo, filePath),
    fileModifiedAt: fileStat.mtime.toISOString(),
    hidden: Boolean(sidecarInfo.hidden),
    structureStatus
  }, context);

  if (kind === "video") {
    replaceParts(db, itemId, [filePath], sidecarInfo);
    db.prepare("DELETE FROM media_images WHERE item_id = ?").run(itemId);
  } else {
    clearParts(db, itemId);
    replaceImages(db, itemId, [filePath]);
  }

  applyTags(db, itemId, library.root_path, filePath, tagsIndex);
  return 1;
}

function upsertMediaItem(db: SqliteDatabase, input: MediaItemInput, context: ScanContext) {
  const now = nowIso();
  const relativePath = normalizeRelative(relative(input.rootPath, input.sourcePath));
  const existing = (db.prepare("SELECT id, fingerprint, generated_cover_path FROM media_items WHERE library_id = ? AND relative_path = ? ORDER BY updated_at DESC LIMIT 1")
    .get(input.libraryId, relativePath) ?? db.prepare("SELECT id, fingerprint, generated_cover_path FROM media_items WHERE fingerprint = ?").get(input.fingerprint)) as
    | { id: string; fingerprint: string; generated_cover_path: string | null }
    | undefined;

  if (existing) {
    const generatedCoverPath = existing.fingerprint === input.fingerprint && existing.generated_cover_path && existsSync(existing.generated_cover_path)
      ? existing.generated_cover_path
      : null;
    db.prepare(`
      UPDATE media_items
      SET kind = ?, title = ?, post_body = ?, library_id = ?, category_id = ?, creator_id = ?, source_path = ?,
          relative_path = ?, folder_path = ?, cover_path = ?, generated_cover_path = ?, content_published_at = ?, file_modified_at = ?,
          fingerprint = ?, thumbnail_status = ?, thumbnail_error = NULL, hidden = ?, structure_status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.kind,
      input.title,
      input.postBody,
      input.libraryId,
      input.categoryId,
      input.creatorId,
      input.sourcePath,
      relativePath,
      input.folderPath,
      input.coverPath,
      generatedCoverPath,
      input.contentPublishedAt,
      input.fileModifiedAt,
      input.fingerprint,
      input.coverPath || generatedCoverPath ? "ready" : "pending",
      input.hidden ? 1 : 0,
      input.structureStatus,
      now,
      existing.id
    );
    context.seenItemIds.add(existing.id);
    return existing.id;
  }

  const id = createId("item");
  db.prepare(`
    INSERT INTO media_items (
      id, kind, title, library_id, category_id, creator_id, source_path, relative_path,
      folder_path, fingerprint, cover_path, generated_cover_path, thumbnail_status, content_published_at, post_body,
      file_modified_at, hidden, structure_status, first_seen_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
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
    input.coverPath || input.kind === "image" ? "ready" : "pending",
    input.contentPublishedAt,
    input.postBody,
    input.fileModifiedAt,
    input.hidden ? 1 : 0,
    input.structureStatus,
    now,
    now
  );
  context.seenItemIds.add(id);
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

function getOrCreateCreator(db: SqliteDatabase, categoryId: string, name: string, alias?: string) {
  const existing = db.prepare("SELECT id FROM creators WHERE category_id = ? AND name = ?").get(categoryId, name) as { id: string } | undefined;
  if (existing) {
    if (alias !== undefined) db.prepare("UPDATE creators SET alias = ? WHERE id = ?").run(alias || null, existing.id);
    return existing.id;
  }
  const id = createId("up");
  db.prepare("INSERT INTO creators (id, name, alias, category_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, name, alias || null, categoryId, nowIso());
  return id;
}

function applyTags(db: SqliteDatabase, itemId: string, rootPath: string, targetPath: string, tagsIndex: TagsIndex) {
  const tags = resolveTags(rootPath, targetPath, tagsIndex);

  db.prepare("DELETE FROM media_tags WHERE media_item_id = ?").run(itemId);

  const timestamp = nowIso();
  for (const tag of tags) {
    const tagId = getOrCreateTag(db, tag.name);
    db.prepare(`
      INSERT OR IGNORE INTO media_tags (media_item_id, tag_id, source, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(itemId, tagId, tag.source, tag.sortOrder, timestamp);
  }
}

function resolveTags(rootPath: string, targetPath: string, tagsIndex: TagsIndex): { name: string; source: "scan" | "manual"; sortOrder: number }[] {
  const relativePath = targetPath.startsWith(rootPath)
    ? normalizeRelative(relative(rootPath, targetPath))
    : normalizeRelative(targetPath);
  const withoutExtension = relativePath.replace(/\.[^.]+$/, "");
  const segments = withoutExtension.split("/");
  const keys = [segments[0], segments.slice(0, 2).join("/"), withoutExtension, relativePath].filter(Boolean);
  const tags = new Map<string, { name: string; source: "scan" | "manual"; sortOrder: number }>();
  const removed = new Set<string>();

  for (const key of keys) {
    const entry = tagsIndex[key];
    if (!entry) continue;
    if (Array.isArray(entry)) {
      for (const name of entry) {
        addResolvedTag(tags, removed, name, "scan");
      }
      continue;
    }

    for (const name of entry.remove ?? []) {
      const normalized = normalizeTagName(name);
      if (!normalized) continue;
      const key = tagKey(normalized);
      removed.add(key);
      tags.delete(key);
    }
    for (const name of entry.add ?? []) {
      addResolvedTag(tags, removed, name, "manual");
    }
  }

  return Array.from(tags.values()).map((tag, sortOrder) => ({ ...tag, sortOrder }));
}

function addResolvedTag(
  tags: Map<string, { name: string; source: "scan" | "manual"; sortOrder: number }>,
  removed: Set<string>,
  rawName: string,
  source: "scan" | "manual"
) {
  const name = normalizeTagName(rawName);
  if (!name) return;
  const key = tagKey(name);
  if (removed.has(key)) return;
  const existing = tags.get(key);
  if (existing) {
    if (source === "manual") {
      existing.source = "manual";
    }
    return;
  }
  tags.set(key, { name, source, sortOrder: tags.size });
}

function replaceParts(db: SqliteDatabase, itemId: string, videos: string[], info: InfoJson) {
  // Keep a part row when the file is still present. watch_progress references
  // media_parts.id, so deleting and recreating every row on each startup scan
  // silently disconnects every saved resume position after an image update.
  const paths = new Set(videos);
  const staleParts = db.prepare("SELECT id, path FROM media_parts WHERE item_id = ?")
    .all(itemId) as { id: string; path: string }[];
  const deletePart = db.prepare("DELETE FROM media_parts WHERE id = ?");
  const clearProgressPart = db.prepare("UPDATE watch_progress SET part_id = NULL WHERE item_id = ? AND part_id = ?");
  for (const part of staleParts) {
    if (!paths.has(part.path)) {
      clearProgressPart.run(itemId, part.id);
      deletePart.run(part.id);
    }
  }

  videos.forEach((path, index) => {
    const partName = basename(path, extname(path));
    const pKey = partName.match(/^p(\d+)$/i)?.[0].toUpperCase();
    const stat = statSync(path);
    upsertPartWithSubtitles(db, itemId, pKey && info.p_titles?.[pKey] ? info.p_titles[pKey] : cleanTitle(partName), index + 1, path, stat.size, fingerprintFile(path));
  });
}

function clearParts(db: SqliteDatabase, itemId: string) {
  db.prepare("UPDATE watch_progress SET part_id = NULL WHERE item_id = ?").run(itemId);
  db.prepare("DELETE FROM media_parts WHERE item_id = ?").run(itemId);
}

function replaceImages(db: SqliteDatabase, itemId: string, images: string[]) {
  db.prepare("DELETE FROM media_images WHERE item_id = ?").run(itemId);
  // media_images.path 同样是 UNIQUE 约束，DELETE 只按 item_id 清理，
  // 残留在其它 item 上的同路径行会让下面的 INSERT 失败。复用已存在行。
  const updateExisting = db.prepare(`
    UPDATE media_images
    SET item_id = ?, sort_index = ?, size_bytes = ?, fingerprint = ?, thumbnail_path = NULL
    WHERE path = ?
  `);
  const insertNew = db.prepare(`
    INSERT INTO media_images (id, item_id, path, sort_index, size_bytes, fingerprint, thumbnail_path)
    VALUES (?, ?, ?, ?, ?, ?, NULL)
  `);
  images.forEach((path, index) => {
    const stat = statSync(path);
    const fp = fingerprintFile(path);
    const result = updateExisting.run(itemId, index + 1, stat.size, fp, path);
    if (result.changes === 0) {
      insertNew.run(createId("img"), itemId, path, index + 1, stat.size, fp);
    }
  });
}

function clearLegacyChildren(db: SqliteDatabase, libraryId: string, folderPath: string) {
  const prefix = `${folderPath}${sep}`;
  const rows = db.prepare("SELECT id, source_path FROM media_items WHERE library_id = ?").all(libraryId) as { id: string; source_path: string }[];
  const deleteInteractions = db.prepare("DELETE FROM interactions WHERE target_type = 'item' AND target_id = ?");
  const deleteMediaTags = db.prepare("DELETE FROM media_tags WHERE media_item_id = ?");
  const deleteItem = db.prepare("DELETE FROM media_items WHERE id = ?");
  for (const row of rows) {
    if (row.source_path.startsWith(prefix)) {
      deleteInteractions.run(row.id);
      deleteMediaTags.run(row.id);
      deleteItem.run(row.id);
    }
  }
}

function pruneUnseenItems(db: SqliteDatabase, libraryId: string, seenItemIds: Set<string>) {
  const existing = db.prepare("SELECT id FROM media_items WHERE library_id = ?").all(libraryId) as { id: string }[];
  const staleIds = existing.map((row) => row.id).filter((id) => !seenItemIds.has(id));
  if (staleIds.length === 0) return;

  const remove = db.transaction((ids: string[]) => {
    const deleteInteractions = db.prepare("DELETE FROM interactions WHERE target_type = 'item' AND target_id = ?");
    const deleteMediaTags = db.prepare("DELETE FROM media_tags WHERE media_item_id = ?");
    const deleteItem = db.prepare("DELETE FROM media_items WHERE id = ?");
    for (const id of ids) {
      deleteInteractions.run(id);
      deleteMediaTags.run(id);
      deleteItem.run(id);
    }
  });
  remove(staleIds);
  console.log(`[media] pruned ${staleIds.length} stale item(s) from library ${libraryId}`);
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

function pruneOrphanTags(db: SqliteDatabase) {
  const result = db.prepare(`
    DELETE FROM tags
    WHERE id NOT IN (SELECT DISTINCT tag_id FROM media_tags)
  `).run();
  if (result.changes > 0) {
    console.log(`[media] pruned ${result.changes} orphan tag(s)`);
  }
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

export function listItemTags(itemId: string): ItemTag[] {
  const db = getSqlite();
  return db.prepare(`
    SELECT t.id, t.name, mt.source, mt.sort_order AS sortOrder
    FROM media_tags mt
    JOIN tags t ON t.id = mt.tag_id
    WHERE mt.media_item_id = ?
    ORDER BY CASE mt.source WHEN 'manual' THEN 0 ELSE 1 END, mt.sort_order ASC, t.name ASC
  `).all(itemId) as ItemTag[];
}

export function addManualTagToItem(itemId: string, rawName: string): ItemTag[] {
  const name = normalizeTagName(rawName);
  if (!name) {
    throw new Error("Invalid tag name");
  }
  const row = findItemStorageTarget(itemId);
  updateTagsFile(row.root_path, row.source_path, (entry) => {
    const add = [name, ...entry.add.filter((item) => item !== name)];
    return {
      add,
      remove: entry.remove.filter((item) => item !== name)
    };
  });
  syncStoredTagsForItem(itemId);
  return listItemTags(itemId);
}

export function removeTagFromItem(itemId: string, tagId: string): ItemTag[] {
  const db = getSqlite();
  const tag = db.prepare("SELECT name FROM tags WHERE id = ?").get(tagId) as { name: string } | undefined;
  if (!tag) {
    throw new Error("Tag not found");
  }
  const name = normalizeTagName(tag.name);
  if (!name) {
    throw new Error("Invalid tag name");
  }
  const row = findItemStorageTarget(itemId);
  updateTagsFile(row.root_path, row.source_path, (entry) => ({
    add: entry.add.filter((item) => item !== name),
    remove: [name, ...entry.remove.filter((item) => item !== name)]
  }));
  syncStoredTagsForItem(itemId);
  return listItemTags(itemId);
}

function syncStoredTagsForItem(itemId: string) {
  const db = getSqlite();
  const row = findItemStorageTarget(itemId);
  applyTags(db, itemId, row.root_path, row.source_path, readTagsIndex(row.root_path));
  pruneOrphanTags(db);
}

function findItemStorageTarget(itemId: string) {
  const db = getSqlite();
  const row = db.prepare(`
    SELECT mi.source_path, l.root_path
    FROM media_items mi
    JOIN libraries l ON l.id = mi.library_id
    WHERE mi.id = ?
  `).get(itemId) as { source_path: string; root_path: string } | undefined;
  if (!row) {
    throw new Error("Item not found");
  }
  return row;
}

function updateTagsFile(
  rootPath: string,
  sourcePath: string,
  update: (entry: { add: string[]; remove: string[] }) => { add: string[]; remove: string[] }
) {
  const path = join(rootPath, "_tags.json");
  const index = readTagsIndex(rootPath);
  const key = normalizeRelative(relative(rootPath, sourcePath));
  const current = index[key];
  const normalized = normalizeTagIndexEntry(current);
  const next = update(normalized);
  index[key] = {
    add: uniqueTags(next.add),
    remove: uniqueTags(next.remove)
  };
  writeFileSync(path, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

function normalizeTagIndexEntry(entry: TagIndexEntry | undefined) {
  if (!entry) return { add: [] as string[], remove: [] as string[] };
  if (Array.isArray(entry)) {
    return { add: uniqueTags(entry), remove: [] as string[] };
  }
  return {
    add: uniqueTags(entry.add ?? []),
    remove: uniqueTags(entry.remove ?? [])
  };
}

function uniqueTags(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const name = normalizeTagName(value);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function normalizeTagName(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 40);
  return normalized.length > 0 ? normalized : null;
}

function tagKey(value: string) {
  return value.toLocaleLowerCase("zh-CN");
}

function readInfo(folderPath: string): InfoJson {
  return readInfoFile(join(folderPath, "info.json"));
}

function readFileSidecar(filePath: string): InfoJson {
  const extension = extname(filePath);
  return readInfoFile(`${filePath.slice(0, -extension.length)}.info.json`);
}

function readInfoFile(path: string): InfoJson {
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as InfoJson;
  } catch {
    console.warn(`[media] invalid info.json: ${path}`);
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
  return value
    .replace(/^\[(?:\d{4}-\d{2}(?:-\d{2})?|未知)\]\s*/, "")
    .replace(/^(?:\d{8}|\d{6})[\s_-]+/, "")
    .replace(/[_-]\d+$/, "")
    .replaceAll("_", " ")
    .trim();
}

export function resolvePublishedAt(sidecarValue: string | undefined, sourcePath: string) {
  return resolveContentDate({ date: sidecarValue }, sourcePath);
}

export function resolveContentDate(info: InfoJson, sourcePath: string, children: string[] = []) {
  for (const value of [info.date, info.published_at]) {
    const parsed = parseDateValue(value);
    if (parsed) return parsed;
  }
  const namedDate = parseNamedDate(basename(sourcePath));
  if (namedDate) return namedDate;
  if (children.length > 0) {
    const childDates = children.map((path) => parseNamedDate(basename(path))).filter((value): value is string => Boolean(value));
    if (childDates.length > 0) return childDates.sort().at(-1) ?? null;
    const childTimes = children.map((path) => {
      const childStat = safeStat(path);
      if (!childStat) return 0;
      return childStat.birthtime.getTime() > 0 && childStat.birthtime.getUTCFullYear() > 1970 ? childStat.birthtimeMs : childStat.mtimeMs;
    });
    const latestChildTime = Math.max(...childTimes);
    if (latestChildTime > 0) return new Date(latestChildTime).toISOString();
  }
  const stat = safeStat(sourcePath);
  if (!stat) return null;
  const birthtime = stat.birthtime;
  if (birthtime.getTime() > 0 && birthtime.getUTCFullYear() > 1970) return birthtime.toISOString();
  return stat.mtime.toISOString();
}

function parseDateValue(value?: string) {
  if (!value) return null;
  const compact = parseNamedDate(value);
  if (compact) return compact;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function parseNamedDate(value: string) {
  const bracket = value.match(/\[(\d{4})-(\d{2})(?:-(\d{2}))?\]/);
  if (bracket) return makeDate(Number(bracket[1]), Number(bracket[2]), Number(bracket[3] ?? 1));
  const dashed = value.match(/(?:^|\D)(\d{4})-(\d{2})-(\d{2})(?:\D|$)/);
  if (dashed) return makeDate(Number(dashed[1]), Number(dashed[2]), Number(dashed[3]));
  const compact = value.match(/(?:^|\D)(\d{8})(?:\D|$)/)?.[1];
  if (compact) return makeDate(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)), Number(compact.slice(6, 8)));
  const short = value.match(/(?:^|\D)(\d{6})(?:\D|$)/)?.[1];
  if (short) {
    const year = Number(short.slice(0, 2));
    return makeDate(year >= 70 ? 1900 + year : 2000 + year, Number(short.slice(2, 4)), Number(short.slice(4, 6)));
  }
  return null;
}

function makeDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString() : null;
}

async function generateMissingThumbnails(db: SqliteDatabase, runId: string, libraryIds: string[]) {
  if (libraryIds.length === 0) {
    return;
  }
  const placeholders = libraryIds.map(() => "?").join(",");
  // 用 MIN(part_index) 取首个分P，而非硬编码 part_index = 1。
  // upsertPartWithSubtitles 按 path 全局复用分P，clearParts 按 item_id 删除，
  // 在目录重组/分P跨 item 复用/扫描中断等场景下，item 的最小 part_index 可能不是 1。
  // 硬编码 part_index = 1 会让这些 item 被排除，封面永远不生成（thumbnail_status 卡在 pending）。
  const coverRows = db.prepare(`
    SELECT mi.id, mi.fingerprint, mi.generated_cover_path, mp.path, mp.id AS part_id
    FROM media_items mi
    JOIN media_parts mp ON mp.id = (
      SELECT inner_mp.id FROM media_parts inner_mp
      WHERE inner_mp.item_id = mi.id
      ORDER BY inner_mp.part_index ASC
      LIMIT 1
    )
    WHERE mi.library_id IN (${placeholders}) AND mi.kind IN ('video', 'post') AND mi.cover_path IS NULL
    ORDER BY mi.first_seen_at DESC
  `).all(...libraryIds) as { id: string; fingerprint: string; generated_cover_path: string | null; path: string; part_id: string }[];

  db.prepare("UPDATE scan_runs SET thumbnails_total = ?, thumbnails_ready = 0, thumbnails_failed = 0 WHERE id = ?")
    .run(coverRows.length, runId);
  let ready = 0;
  let failed = 0;
  for (const row of coverRows) {
    try {
      const cachedPath = row.generated_cover_path && existsSync(row.generated_cover_path)
        ? row.generated_cover_path
        : await generateThumbnail(row.path, row.fingerprint);
      db.prepare("UPDATE media_items SET generated_cover_path = ?, thumbnail_status = 'ready', thumbnail_error = NULL WHERE id = ?")
        .run(cachedPath, row.id);
      ready += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare("UPDATE media_items SET thumbnail_status = 'failed', thumbnail_error = ? WHERE id = ?").run(message, row.id);
      failed += 1;
    }
    db.prepare("UPDATE scan_runs SET thumbnails_ready = ?, thumbnails_failed = ? WHERE id = ?").run(ready, failed, runId);
  }

  const allParts = db.prepare(`
    SELECT mp.id, mp.path, mp.fingerprint, mp.duration_seconds, mp.preview_sprite_path, mp.stream_path
    FROM media_parts mp
    JOIN media_items mi ON mi.id = mp.item_id
    WHERE mi.library_id IN (${placeholders}) AND mi.kind IN ('video', 'post')
  `).all(...libraryIds) as { id: string; path: string; fingerprint: string; duration_seconds: number | null; preview_sprite_path: string | null; stream_path: string | null }[];

  for (const part of allParts) {
    let duration = part.duration_seconds ?? 0;
    try {
      const mediaInfo = await probeMedia(part.path);
      duration ||= mediaInfo.duration;
      if (duration > 0 && !part.duration_seconds) {
        db.prepare("UPDATE media_parts SET duration_seconds = ? WHERE id = ?").run(duration, part.id);
      }

      if (isBrowserPlayable(part.path, mediaInfo) && hasFastStart(part.path)) {
        db.prepare("UPDATE media_parts SET stream_path = NULL, stream_size_bytes = NULL, compatibility_status = 'ready', compatibility_error = NULL WHERE id = ?")
          .run(part.id);
      } else if (isBrowserPlayable(part.path, mediaInfo)) {
        // 编码兼容但 moov atom 在文件末尾，remux 为 faststart（流复制，不重新编码）
        const streamPath = part.stream_path && existsSync(part.stream_path)
          ? part.stream_path
          : await remuxWithFaststart(part.path, part.fingerprint);
        db.prepare("UPDATE media_parts SET stream_path = ?, stream_size_bytes = ?, compatibility_status = 'ready', compatibility_error = NULL WHERE id = ?")
          .run(streamPath, statSync(streamPath).size, part.id);
      } else {
        const streamPath = part.stream_path && existsSync(part.stream_path)
          ? part.stream_path
          : await generateCompatibleVideo(part.path, part.fingerprint);
        db.prepare("UPDATE media_parts SET stream_path = ?, stream_size_bytes = ?, compatibility_status = 'ready', compatibility_error = NULL WHERE id = ?")
          .run(streamPath, statSync(streamPath).size, part.id);
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare("UPDATE media_parts SET compatibility_status = 'failed', compatibility_error = ? WHERE id = ?").run(message, part.id);
      console.warn(`[media] compatibility preparation failed: ${part.path}: ${message}`);
      continue;
    }

    try {
      const spriteExists = part.preview_sprite_path && existsSync(part.preview_sprite_path);
      if (!spriteExists && duration > 3) {
        const sprite = await generatePreviewSprite(part.path, part.fingerprint, duration);
        db.prepare(`
          UPDATE media_parts SET preview_sprite_path = ?, preview_sprite_cols = ?, preview_sprite_rows = ?,
            preview_sprite_interval = ?, preview_thumb_w = ?, preview_thumb_h = ?
          WHERE id = ?
        `).run(sprite.path, sprite.cols, sprite.rows, sprite.interval, sprite.thumbW, sprite.thumbH, part.id);
      }
    } catch (error) {
      console.warn(`[media] preview sprite failed: ${part.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const imageRows = db.prepare(`
    SELECT mimg.id, mimg.path, mimg.fingerprint, mimg.thumbnail_path
    FROM media_images mimg
    JOIN media_items mi ON mi.id = mimg.item_id
    WHERE mi.library_id IN (${placeholders})
  `).all(...libraryIds) as { id: string; path: string; fingerprint: string; thumbnail_path: string | null }[];
  for (const image of imageRows) {
    try {
      if (!existsSync(image.path)) continue;
      const metadata = await sharp(image.path, { animated: false }).metadata();
      const thumbnailPath = image.thumbnail_path && existsSync(image.thumbnail_path)
        ? image.thumbnail_path
        : await generateImageThumbnail(image.path, image.fingerprint);
      db.prepare("UPDATE media_images SET width = ?, height = ?, thumbnail_path = ? WHERE id = ?")
        .run(metadata.width ?? null, metadata.height ?? null, thumbnailPath, image.id);
    } catch {
      // Keep the original available even when thumbnail generation fails.
    }
  }
}

async function generateImageThumbnail(imagePath: string, fingerprint: string) {
  const cacheDir = getAppMediaCacheDir();
  mkdirSync(cacheDir, { recursive: true });
  const outputPath = join(cacheDir, `${fingerprint}.image.webp`);
  if (!existsSync(outputPath)) {
    await sharp(imagePath, { animated: false }).rotate().resize({ width: 720, height: 720, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(outputPath);
  }
  return outputPath;
}

const SPRITE_THUMB_W = 160;
const SPRITE_THUMB_H = 90;
const SPRITE_COLS = 10;
const SPRITE_MAX_THUMBS = 100;

async function generatePreviewSprite(videoPath: string, fingerprint: string, duration: number) {
  const cacheDir = getAppMediaCacheDir();
  mkdirSync(cacheDir, { recursive: true });
  const outputPath = join(cacheDir, `${fingerprint}.sprite.webp`);
  if (existsSync(outputPath)) {
    return {
      path: outputPath,
      cols: SPRITE_COLS,
      rows: Math.ceil(Math.min(SPRITE_MAX_THUMBS, Math.ceil(duration / Math.max(2, duration / SPRITE_MAX_THUMBS))) / SPRITE_COLS),
      interval: Math.max(2, duration / SPRITE_MAX_THUMBS),
      thumbW: SPRITE_THUMB_W,
      thumbH: SPRITE_THUMB_H
    };
  }

  const interval = Math.max(2, duration / SPRITE_MAX_THUMBS);
  const thumbCount = Math.min(SPRITE_MAX_THUMBS, Math.ceil(duration / interval));
  const rows = Math.ceil(thumbCount / SPRITE_COLS);

  await runProcess(getFfmpegPath(), [
    "-hide_banner", "-loglevel", "error",
    "-ss", "0.5", "-i", videoPath,
    "-vf", `fps=1/${interval},scale=${SPRITE_THUMB_W}:${SPRITE_THUMB_H}:force_original_aspect_ratio=decrease,pad=${SPRITE_THUMB_W}:${SPRITE_THUMB_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,tile=${SPRITE_COLS}x${rows}`,
    "-frames:v", "1",
    "-c:v", "libwebp", "-quality", "50",
    "-y", outputPath
  ]);

  return { path: outputPath, cols: SPRITE_COLS, rows, interval, thumbW: SPRITE_THUMB_W, thumbH: SPRITE_THUMB_H };
}

async function generateThumbnail(videoPath: string, fingerprint: string) {
  const cacheDir = getAppMediaCacheDir();
  mkdirSync(cacheDir, { recursive: true });
  const outputPath = join(cacheDir, `${fingerprint}.webp`);
  if (existsSync(outputPath)) {
    return outputPath;
  }

  const duration = await probeDuration(videoPath).catch(() => 0);
  const rawCandidates = duration > 0
    ? (duration < 5 ? [duration / 2] : [duration * 0.2, duration * 0.35, duration * 0.5])
    : [0.2, 1, 5, 10];
  const candidates = [...new Set(rawCandidates.map((value) => duration > 0
    ? Math.max(0.2, Math.min(value, Math.max(0.2, duration - 0.3)))
    : value))];
  const generated: { path: string; score: number }[] = [];

  try {
    for (let index = 0; index < candidates.length; index += 1) {
      const candidatePath = join(cacheDir, `${fingerprint}.${index}.webp`);
      try {
        await runProcess(getFfmpegPath(), [
          "-hide_banner", "-loglevel", "error", "-ss", String(candidates[index]), "-i", videoPath,
          "-map", "0:v:0", "-frames:v", "1", "-vf", "scale=640:360:force_original_aspect_ratio=increase,crop=640:360",
          "-c:v", "libwebp", "-quality", "82", "-y", candidatePath
        ]);
        if (!existsSync(candidatePath)) continue;
        // Read into memory first so libvips does not keep the candidate file locked on Windows.
        const stats = await sharp(readFileSync(candidatePath)).greyscale().stats();
        const channel = stats.channels[0];
        const blackPenalty = channel.mean < 18 ? 100 : 0;
        generated.push({ path: candidatePath, score: stats.entropy + channel.stdev / 20 - blackPenalty });
      } catch {
        tryUnlink(candidatePath);
      }
    }
    const winner = generated.sort((a, b) => b.score - a.score)[0];
    if (!winner) {
      throw new Error("FFmpeg did not produce a thumbnail");
    }
    renameSync(winner.path, outputPath);
    return outputPath;
  } finally {
    for (const item of generated) {
      if (item.path !== outputPath) tryUnlink(item.path);
    }
  }
}

function tryUnlink(path: string) {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // Windows may briefly keep Sharp input files locked; stale candidates are harmless cache files.
  }
}

async function probeDuration(videoPath: string) {
  return (await probeMedia(videoPath)).duration;
}

type ProbedMedia = {
  duration: number;
  formatNames: string[];
  videoCodec: string | null;
  audioCodec: string | null;
};

async function probeMedia(videoPath: string): Promise<ProbedMedia> {
  const output = await runProcess(getFfprobePath(), [
    "-v", "error", "-show_entries", "format=format_name,duration:stream=codec_type,codec_name", "-of", "json", videoPath
  ]);
  const result = JSON.parse(output) as {
    format?: { format_name?: string; duration?: string };
    streams?: { codec_type?: string; codec_name?: string }[];
  };
  const video = result.streams?.find((stream) => stream.codec_type === "video");
  const audio = result.streams?.find((stream) => stream.codec_type === "audio");
  return {
    duration: Number(result.format?.duration) || 0,
    formatNames: (result.format?.format_name ?? "").split(",").filter(Boolean),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null
  };
}

function isBrowserPlayable(videoPath: string, media: ProbedMedia) {
  const extension = extname(videoPath).toLowerCase();
  const audioWorksInMp4 = media.audioCodec === null || media.audioCodec === "aac" || media.audioCodec === "mp3";
  if ([".mp4", ".m4v", ".mov"].includes(extension)) {
    return media.videoCodec === "h264" && audioWorksInMp4;
  }
  if (extension === ".webm") {
    return ["vp8", "vp9", "av1"].includes(media.videoCodec ?? "")
      && (media.audioCodec === null || ["opus", "vorbis"].includes(media.audioCodec));
  }
  return false;
}

/**
 * 检查 MP4 文件的 moov atom 是否在文件开头（faststart）。
 * 浏览器需要 moov 在开头才能流式播放；若 moov 在末尾，浏览器需先下载整个文件才能播放。
 * 仅适用于 MP4/M4V/MOV 容器，其他容器（如 WebM）始终返回 true。
 */
function hasFastStart(videoPath: string): boolean {
  const extension = extname(videoPath).toLowerCase();
  if (![".mp4", ".m4v", ".mov"].includes(extension)) {
    return true;
  }
  let fd: number | null = null;
  try {
    const buffer = Buffer.alloc(65536);
    fd = openSync(videoPath, "r");
    const bytesRead = readSync(fd, buffer, 0, buffer.length, 0);
    const content = buffer.subarray(0, bytesRead).toString("latin1");
    const moovIndex = content.indexOf("moov");
    const mdatIndex = content.indexOf("mdat");
    if (moovIndex === -1) return false;
    if (mdatIndex === -1) return true;
    return moovIndex < mdatIndex;
  } catch {
    return false;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * 将视频 remux 为 faststart 格式（流复制，不重新编码）。
 * 仅重新组织文件结构，将 moov atom 移到文件开头，速度远快于转码。
 */
async function remuxWithFaststart(videoPath: string, fingerprint: string): Promise<string> {
  const cacheDir = getAppMediaCacheDir();
  mkdirSync(cacheDir, { recursive: true });
  const outputPath = join(cacheDir, `${fingerprint}.faststart.mp4`);
  if (existsSync(outputPath)) return outputPath;
  const temporaryPath = join(cacheDir, `${fingerprint}.faststart.tmp.mp4`);
  if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  try {
    await runProcess(getFfmpegPath(), [
      "-hide_banner", "-loglevel", "error", "-i", videoPath,
      "-map", "0:V:0", "-map", "0:a:0?",
      "-c", "copy", "-movflags", "+faststart", "-y", temporaryPath
    ]);
    if (!existsSync(temporaryPath)) throw new Error("FFmpeg did not produce a remuxed video");
    renameSync(temporaryPath, outputPath);
    return outputPath;
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

async function generateCompatibleVideo(videoPath: string, fingerprint: string) {
  const cacheDir = getAppMediaCacheDir();
  mkdirSync(cacheDir, { recursive: true });
  const outputPath = join(cacheDir, `${fingerprint}.compatible.mp4`);
  if (existsSync(outputPath)) return outputPath;
  const temporaryPath = join(cacheDir, `${fingerprint}.compatible.tmp.mp4`);
  if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  try {
    await runProcess(getFfmpegPath(), [
      "-hide_banner", "-loglevel", "error", "-i", videoPath,
      "-map", "0:V:0", "-map", "0:a:0?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-y", temporaryPath
    ]);
    if (!existsSync(temporaryPath)) throw new Error("FFmpeg did not produce a compatible video");
    renameSync(temporaryPath, outputPath);
    return outputPath;
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function getFfmpegPath() {
  if (process.env.HILI_FFMPEG_PATH) {
    return process.env.HILI_FFMPEG_PATH;
  }
  return (require("ffmpeg-static") as string | null) ?? "ffmpeg";
}

function getFfprobePath() {
  if (process.env.HILI_FFPROBE_PATH) {
    return process.env.HILI_FFPROBE_PATH;
  }
  return (require("ffprobe-static") as { path?: string }).path ?? "ffprobe";
}

function runProcess(command: string, args: string[]) {
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise(stdout);
      } else {
        reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
      }
    });
  });
}

export async function createDemoLibrary(rootPath: string) {
  const root = resolveDemoRoot(rootPath);
  const multipart = join(root, "科技", "演示UP", "[2026-06-20] 多分P演示");
  const covered = join(root, "生活", "彩色UP", "[2026-06-18] 自带封面");
  const purePost = join(root, "摄影", "图片UP", "[2026-06-22] 九图动态");
  const videoPost = join(root, "科技", "演示UP", "260623 带视频动态");
  const imagePool = join(root, "摄影", "图片UP", "图片");
  const hidden = join(root, "生活", "彩色UP", "[2026-06-17] 隐藏演示");
  [multipart, covered, purePost, videoPost, imagePool, hidden].forEach((path) => mkdirSync(path, { recursive: true }));

  writeFileSync(join(root, "科技", "演示UP", "info.json"), JSON.stringify({ alias: "DemoCreator" }, null, 2));
  writeFileSync(join(root, "摄影", "图片UP", "info.json"), JSON.stringify({ alias: "PhotoUP" }, null, 2));
  writeFileSync(join(root, "_tags.json"), JSON.stringify({
    "科技": ["演示"],
    "科技/演示UP": ["科技", "测试"],
    "科技/演示UP/260623 带视频动态": ["图文", "配套视频"],
    "摄影/图片UP": ["摄影"]
  }, null, 2));

  writeFileSync(join(multipart, "info.json"), JSON.stringify({
    title: "多分P交互演示",
    published_at: "2026-06-20T12:00:00+08:00",
    p_titles: { P1: "彩条与声音", P2: "渐变与声音" }
  }, null, 2));
  await makeDemoVideo(join(multipart, "P1.mp4"), "testsrc2=size=1280x720:rate=30", 12);
  await makeDemoVideo(join(multipart, "P2.mp4"), "smptebars=size=1280x720:rate=30", 9);

  writeFileSync(join(covered, "info.json"), JSON.stringify({ title: "自带封面演示", published_at: "2026-06-18" }, null, 2));
  await makeDemoVideo(join(covered, "P1.mp4"), "color=c=0x5eead4:size=1280x720:rate=30", 8);
  await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#17212b" } })
    .composite([{ input: Buffer.from('<svg width="1280" height="720"><text x="640" y="380" text-anchor="middle" font-family="Arial" font-size="82" fill="#5eead4">Hilihili Demo</text></svg>') }])
    .jpeg({ quality: 88 }).toFile(join(covered, "cover.jpg"));
  writeFileSync(join(purePost, "post.txt"), "最近整理了一组用于演示图文动态的配图。这里会保留完整文案、九宫格顺序和原图浏览体验。", "utf8");
  writeFileSync(join(videoPost, "post.txt"), "这是一条带配套视频的动态：首页可以刷到视频，播放页只显示简介，完整图片仍然留在原动态里。", "utf8");
  writeFileSync(join(hidden, "info.json"), JSON.stringify({ title: "不应出现在信息流", date: "2026-06-17", hidden: true }, null, 2));
  await makeDemoVideo(join(videoPost, "P1.mp4"), "testsrc=size=1280x720:rate=30", 10);
  await makeDemoVideo(join(hidden, "P1.mp4"), "color=c=gray:size=1280x720:rate=30", 4);

  const colors = ["#553c9a", "#1d7874", "#d1495b", "#edae49", "#3066be", "#7a5195", "#ef5675", "#ffa600", "#2f4b7c"];
  for (let index = 0; index < colors.length; index += 1) {
    const svg = `<svg width="900" height="900"><rect width="900" height="900" fill="${colors[index]}"/><circle cx="450" cy="390" r="190" fill="rgba(255,255,255,.14)"/><text x="450" y="500" text-anchor="middle" font-family="Arial" font-size="170" fill="white">${index + 1}</text></svg>`;
    await sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toFile(join(purePost, `${index + 1}.jpg`));
    if (index < 3) await sharp(Buffer.from(svg)).webp({ quality: 82 }).toFile(join(imagePool, `图片 ${index + 1}.webp`));
    if (index < 2) await sharp(Buffer.from(svg)).jpeg({ quality: 84 }).toFile(join(videoPost, `${index + 1}.jpg`));
  }
  return root;
}

function resolveDemoRoot(rootPath: string) {
  const root = join(getDataDir(), "safe-demo-library");
  const requested = join(rootPath);
  if (resolve(requested) !== resolve(root)) {
    throw new Error("Demo library must be created inside the isolated data directory");
  }
  return root;
}

async function makeDemoVideo(path: string, source: string, duration: number) {
  if (existsSync(path)) {
    return;
  }
  await runProcess(getFfmpegPath(), [
    "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", source,
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", String(duration),
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", path
  ]);
}

function normalizeRelative(value: string) {
  return value.split(sep).join("/");
}

function comparePartNames(a: string, b: string) {
  return partNumber(a) - partNumber(b) || a.localeCompare(b);
}

function compareNaturalPaths(a: string, b: string) {
  return basename(a).localeCompare(basename(b), "zh-CN", { numeric: true, sensitivity: "base" });
}

function isContentImage(path: string) {
  return isImagePath(path) && !/^(cover|folder)\.(?:jpe?g|png|webp|gif|avif)$/i.test(basename(path));
}

function compositeFingerprint(paths: string[]) {
  return stableHash(paths.map((path) => `${basename(path)}:${fingerprintFile(path)}`).join("|"));
}

function newestModifiedAt(paths: string[], fallbackPath: string) {
  const times = paths.map((path) => safeStat(path)?.mtimeMs ?? 0);
  const fallback = safeStat(fallbackPath)?.mtimeMs ?? Date.now();
  return new Date(Math.max(fallback, ...times)).toISOString();
}

function safeReadText(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    console.warn(`[media] unable to read text file: ${path}`);
    return "";
  }
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
