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
  structureStatus: StructureStatus;
};

type TagsIndex = Record<string, string[]>;

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
    db.prepare("UPDATE scan_runs SET status = 'complete', finished_at = ?, items_indexed = ? WHERE id = ?")
      .run(nowIso(), indexed, run.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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

  return total;
}

export async function scanLibrary(libraryId: string) {
  const db = getSqlite();
  const library = db.prepare("SELECT * FROM libraries WHERE id = ?").get(libraryId) as LibraryRow | undefined;
  if (!library) {
    throw new Error(`Library not found: ${libraryId}`);
  }

  return scanLibraryContents(db, library);
}

function scanLibraryContents(db: SqliteDatabase, library: LibraryRow) {
  const tagsIndex = readTagsIndex(library.root_path);
  return scanRoot(db, library, tagsIndex);
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
  const modifiedAt = new Date(Math.max(...videos.map((path) => statSync(path).mtimeMs))).toISOString();
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
    contentPublishedAt: resolvePublishedAt(info.published_at, folderPath),
    fileModifiedAt: modifiedAt,
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
  const fileStat = statSync(filePath);
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
    contentPublishedAt: resolvePublishedAt(sidecarInfo.published_at, filePath) ?? resolvePublishedAt(undefined, folderPath),
    fileModifiedAt: fileStat.mtime.toISOString(),
    structureStatus
  });

  if (kind === "video") {
    db.prepare("DELETE FROM media_parts WHERE item_id = ?").run(itemId);
    db.prepare(`
      INSERT INTO media_parts (id, item_id, title, part_index, path, size_bytes, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(createId("part"), itemId, title, 1, filePath, fileStat.size, fingerprintFile(filePath));
  }

  applyTags(db, itemId, library.root_path, filePath, tagsIndex);
  applyTags(db, itemId, library.root_path, join(categoryName, creatorName), tagsIndex);
  return 1;
}

function upsertMediaItem(db: SqliteDatabase, input: MediaItemInput) {
  const now = nowIso();
  const relativePath = normalizeRelative(relative(input.rootPath, input.sourcePath));
  const existing = db.prepare("SELECT id, generated_cover_path FROM media_items WHERE fingerprint = ?").get(input.fingerprint) as
    | { id: string; generated_cover_path: string | null }
    | undefined;

  if (existing) {
    db.prepare(`
      UPDATE media_items
      SET kind = ?, title = ?, library_id = ?, category_id = ?, creator_id = ?, source_path = ?,
          relative_path = ?, folder_path = ?, cover_path = ?, content_published_at = ?, file_modified_at = ?,
          thumbnail_status = ?, thumbnail_error = NULL, structure_status = ?, updated_at = ?
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
      input.contentPublishedAt,
      input.fileModifiedAt,
      input.coverPath || existing.generated_cover_path ? "ready" : "pending",
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
      folder_path, fingerprint, cover_path, generated_cover_path, thumbnail_status, content_published_at,
      file_modified_at, hidden, structure_status, first_seen_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, ?, ?, ?)
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
    input.fileModifiedAt,
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

function readInfo(folderPath: string): { title?: string; p_titles?: Record<string, string>; published_at?: string } {
  const path = join(folderPath, "info.json");
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as { title?: string; p_titles?: Record<string, string>; published_at?: string };
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
  return value.replace(/^\[\d{4}-\d{2}(?:-\d{2})?\]\s*/, "").replace(/[_-]\d+$/, "").replaceAll("_", " ").trim();
}

export function resolvePublishedAt(sidecarValue: string | undefined, sourcePath: string) {
  if (sidecarValue) {
    const parsed = Date.parse(sidecarValue);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  const match = basename(sourcePath).match(/\[(\d{4})-(\d{2})(?:-(\d{2}))?\]/);
  if (!match) {
    return null;
  }
  const value = `${match[1]}-${match[2]}-${match[3] ?? "01"}T00:00:00.000Z`;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

async function generateMissingThumbnails(db: SqliteDatabase, runId: string, libraryIds: string[]) {
  if (libraryIds.length === 0) {
    return;
  }
  const placeholders = libraryIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT mi.id, mi.fingerprint, mi.generated_cover_path, mp.path
    FROM media_items mi
    JOIN media_parts mp ON mp.item_id = mi.id AND mp.part_index = 1
    WHERE mi.library_id IN (${placeholders}) AND mi.kind = 'video' AND mi.cover_path IS NULL
    ORDER BY mi.first_seen_at DESC
  `).all(...libraryIds) as { id: string; fingerprint: string; generated_cover_path: string | null; path: string }[];

  db.prepare("UPDATE scan_runs SET thumbnails_total = ?, thumbnails_ready = 0, thumbnails_failed = 0 WHERE id = ?")
    .run(rows.length, runId);
  let ready = 0;
  let failed = 0;
  for (const row of rows) {
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
}

async function generateThumbnail(videoPath: string, fingerprint: string) {
  const cacheDir = getAppMediaCacheDir();
  mkdirSync(cacheDir, { recursive: true });
  const outputPath = join(cacheDir, `${fingerprint}.webp`);
  if (existsSync(outputPath)) {
    return outputPath;
  }

  const duration = await probeDuration(videoPath);
  const rawCandidates = duration > 0
    ? (duration < 5 ? [duration / 2] : [duration * 0.2, duration * 0.35, duration * 0.5])
    : [10];
  const candidates = rawCandidates.map((value) => Math.max(0.2, Math.min(value, Math.max(0.2, duration - 0.3))));
  const generated: { path: string; score: number }[] = [];

  try {
    for (let index = 0; index < candidates.length; index += 1) {
      const candidatePath = join(cacheDir, `${fingerprint}.${index}.webp`);
      await runProcess(getFfmpegPath(), [
        "-hide_banner", "-loglevel", "error", "-ss", String(candidates[index]), "-i", videoPath,
        "-frames:v", "1", "-vf", "scale=640:360:force_original_aspect_ratio=increase,crop=640:360",
        "-c:v", "libwebp", "-quality", "82", "-y", candidatePath
      ]);
      const stats = await sharp(candidatePath).greyscale().stats();
      const channel = stats.channels[0];
      const blackPenalty = channel.mean < 18 ? 100 : 0;
      generated.push({ path: candidatePath, score: stats.entropy + channel.stdev / 20 - blackPenalty });
    }
    const winner = generated.sort((a, b) => b.score - a.score)[0];
    if (!winner) {
      throw new Error("FFmpeg did not produce a thumbnail");
    }
    renameSync(winner.path, outputPath);
    return outputPath;
  } finally {
    for (const item of generated) {
      if (item.path !== outputPath && existsSync(item.path)) {
        unlinkSync(item.path);
      }
    }
  }
}

async function probeDuration(videoPath: string) {
  const output = await runProcess(getFfprobePath(), [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", videoPath
  ]);
  return Number(output.trim()) || 0;
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
  const imageFolder = join(root, "摄影", "图片UP", "[2026-06-16] 图片动态");
  [multipart, covered, imageFolder].forEach((path) => mkdirSync(path, { recursive: true }));

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
  await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#241f31" } })
    .composite([{ input: Buffer.from('<svg width="1280" height="720"><circle cx="640" cy="330" r="170" fill="#f3b562"/><text x="640" y="610" text-anchor="middle" font-family="Arial" font-size="64" fill="white">Image Preview</text></svg>') }])
    .webp({ quality: 85 }).toFile(join(imageFolder, "演示图片.webp"));
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
