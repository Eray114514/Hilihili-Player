import cors from "@fastify/cors";
import Fastify from "fastify";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { platform } from "node:os";
import { lookup } from "mime-types";
import { createId, getSqlite, nowIso } from "@hilihili/db";
import { addManualTagToItem, enqueueScan, listItemTags, removeTagFromItem } from "@hilihili/media";
import { getFeedItemsByIds, getRecommendedFeed } from "@hilihili/recommendation";
import type { DirectoryEntry, FeedItem, InteractionKind } from "@hilihili/shared";

type AddLibraryBody = {
  name?: string;
  rootPath?: string;
};

type InteractionBody = {
  kind?: InteractionKind;
  value?: number;
  positionSeconds?: number;
  durationSeconds?: number;
  partId?: string;
};

type ActivityRow = {
  itemId: string;
  resumePartId: string | null;
  resumePartIndex: number | null;
  resumePartTitle: string | null;
  positionSeconds: number;
  durationSeconds: number | null;
  finished: number;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  likedAt: string | null;
  coinedAt: string | null;
};

type CommentBody = {
  body?: string;
  atSeconds?: number | null;
};

type FavoriteFolderBody = {
  name?: string;
};

type FavoriteItemBody = {
  folderId?: string;
};

type TagBody = {
  name?: string;
};

const app = Fastify({ logger: true });
await app.register(cors, {
  origin: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
});

const db = getSqlite();

app.get("/health", async () => ({
  ok: true,
  name: "Hilihili API",
  now: nowIso()
}));

app.get("/fs/roots", async () => ({
  roots: getBrowsableRoots()
}));

app.get<{ Querystring: { path?: string } }>("/fs/list", async (request, reply) => {
  const targetPath = request.query.path ? resolve(request.query.path) : getBrowsableRoots()[0]?.path;
  if (!targetPath || !isPathAllowed(targetPath) || !existsSync(targetPath)) {
    return reply.code(404).send({ error: "Path not found" });
  }

  const stat = statSync(targetPath);
  if (!stat.isDirectory()) {
    return reply.code(400).send({ error: "Path is not a directory" });
  }

  const entries: DirectoryEntry[] = readdirSync(targetPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: join(targetPath, entry.name),
      isDirectory: true
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parentCandidate = resolve(targetPath, "..");
  return { path: targetPath, parent: isPathAllowed(parentCandidate) ? parentCandidate : null, entries };
});

app.get("/libraries", async () => ({
  libraries: db.prepare("SELECT id, name, root_path AS rootPath, enabled, created_at AS createdAt FROM libraries ORDER BY created_at DESC").all()
}));

app.post<{ Body: AddLibraryBody }>("/libraries", async (request, reply) => {
  const rootPath = request.body.rootPath ? resolve(request.body.rootPath) : null;
  if (!rootPath || !isPathAllowed(rootPath) || !existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
    return reply.code(400).send({ error: "Choose an existing directory" });
  }

  const id = createId("lib");
  const name = request.body.name?.trim() || basename(rootPath) || rootPath;
  db.prepare("INSERT INTO libraries (id, name, root_path, enabled, created_at) VALUES (?, ?, ?, 1, ?)")
    .run(id, name, rootPath, nowIso());
  const scanRunId = enqueueScan(id);

  return reply.code(201).send({ id, name, rootPath, scanRunId });
});

app.post<{ Body: { libraryId?: string } }>("/scan/runs", async (request, reply) => {
  const scanRunId = enqueueScan(request.body.libraryId);
  return reply.code(202).send({ scanRunId, status: "queued" });
});

app.get("/scan/runs", async () => ({
  runs: db.prepare(`
    SELECT id, library_id AS libraryId, status, message, started_at AS startedAt, finished_at AS finishedAt,
      items_indexed AS itemsIndexed, thumbnails_total AS thumbnailsTotal,
      thumbnails_ready AS thumbnailsReady, thumbnails_failed AS thumbnailsFailed
    FROM scan_runs ORDER BY started_at DESC LIMIT 20
  `).all()
}));

app.get<{ Params: { id: string } }>("/scan/runs/:id", async (request, reply) => {
  const run = db.prepare(`
    SELECT id, library_id AS libraryId, status, message, started_at AS startedAt, finished_at AS finishedAt,
      items_indexed AS itemsIndexed, thumbnails_total AS thumbnailsTotal,
      thumbnails_ready AS thumbnailsReady, thumbnails_failed AS thumbnailsFailed
    FROM scan_runs WHERE id = ?
  `).get(request.params.id);
  return run ?? reply.code(404).send({ error: "Scan run not found" });
});

app.get<{ Querystring: { seed?: string; limit?: string; offset?: string; mode?: string } }>("/feeds/home", async (request) => ({
  items: getRecommendedFeed({
    seed: request.query.seed ?? String(Date.now()),
    limit: Number(request.query.limit ?? 30),
    offset: Number(request.query.offset ?? 0),
    mode: request.query.mode === "shuffle" ? "shuffle" : "recommended"
  })
}));

app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>("/search", async (request) => {
  const query = (request.query.q?.trim() ?? "").slice(0, 200);
  const requestedLimit = Number(request.query.limit ?? 36);
  const requestedOffset = Number(request.query.offset ?? 0);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 80) : 36;
  const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
  if (!query) return { query, items: [] as FeedItem[], total: 0, hasMore: false };

  const pattern = `%${query}%`;
  const matchSql = `
    FROM media_items mi
    LEFT JOIN categories c ON c.id = mi.category_id
    LEFT JOIN creators cr ON cr.id = mi.creator_id
    WHERE mi.hidden = 0
      AND NOT EXISTS (
        SELECT 1 FROM creator_preferences cp
        WHERE cp.creator_id = mi.creator_id AND cp.blacklisted = 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM interactions bi
        WHERE bi.target_type = 'creator' AND bi.target_id = mi.creator_id AND bi.kind = 'blacklist_up'
      )
      AND (
        mi.title LIKE ? COLLATE NOCASE
        OR COALESCE(mi.post_body, '') LIKE ? COLLATE NOCASE
        OR COALESCE(cr.name, '') LIKE ? COLLATE NOCASE
        OR COALESCE(cr.alias, '') LIKE ? COLLATE NOCASE
        OR COALESCE(c.name, '') LIKE ? COLLATE NOCASE
        OR EXISTS (
          SELECT 1 FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
          WHERE mt.media_item_id = mi.id AND t.name LIKE ? COLLATE NOCASE
        )
        OR EXISTS (
          SELECT 1 FROM media_parts mp
          WHERE mp.item_id = mi.id AND mp.title LIKE ? COLLATE NOCASE
        )
      )`;
  const params = Array.from({ length: 7 }, () => pattern);
  const total = (db.prepare(`SELECT COUNT(*) AS count ${matchSql}`).get(...params) as { count: number }).count;
  const rows = db.prepare(`
    SELECT mi.id ${matchSql}
    ORDER BY
      CASE
        WHEN mi.title = ? COLLATE NOCASE THEN 0
        WHEN mi.title LIKE ? COLLATE NOCASE THEN 1
        WHEN COALESCE(cr.name, '') LIKE ? COLLATE NOCASE OR COALESCE(cr.alias, '') LIKE ? COLLATE NOCASE THEN 2
        ELSE 3
      END,
      COALESCE(mi.content_published_at, mi.file_modified_at, mi.first_seen_at) DESC
    LIMIT ? OFFSET ?
  `).all(...params, query, `${query}%`, pattern, pattern, limit, offset) as { id: string }[];
  const items = getFeedItemsByIds(rows.map((row) => row.id));
  return { query, items, total, hasMore: offset + items.length < total };
});

app.get<{ Querystring: { limit?: string } }>("/me/activity", async (request) => {
  const limit = Math.min(Math.max(Number(request.query.limit ?? 60), 1), 80);
  const historyRows = db.prepare(`
    SELECT wp.item_id AS itemId, wp.part_id AS resumePartId,
      mp.part_index AS resumePartIndex, mp.title AS resumePartTitle,
      wp.position_seconds AS positionSeconds, mp.duration_seconds AS durationSeconds,
      wp.finished, wp.started_at AS startedAt, wp.completed_at AS completedAt,
      wp.updated_at AS updatedAt, ip.updated_at AS likedAt
    FROM watch_progress wp
    JOIN media_items mi ON mi.id = wp.item_id AND mi.hidden = 0
    LEFT JOIN media_parts mp ON mp.id = wp.part_id
    LEFT JOIN item_preferences ip ON ip.item_id = wp.item_id AND ip.reaction = 'like'
    ORDER BY wp.updated_at DESC
    LIMIT ?
  `).all(limit) as ActivityRow[];
  const likedRows = db.prepare(`
    SELECT ip.item_id AS itemId, wp.part_id AS resumePartId,
      mp.part_index AS resumePartIndex, mp.title AS resumePartTitle,
      COALESCE(wp.position_seconds, 0) AS positionSeconds, mp.duration_seconds AS durationSeconds,
      COALESCE(wp.finished, 0) AS finished, wp.started_at AS startedAt,
      wp.completed_at AS completedAt, wp.updated_at AS updatedAt, ip.updated_at AS likedAt
    FROM item_preferences ip
    JOIN media_items mi ON mi.id = ip.item_id AND mi.hidden = 0
    LEFT JOIN watch_progress wp ON wp.item_id = ip.item_id
    LEFT JOIN media_parts mp ON mp.id = wp.part_id
    WHERE ip.reaction = 'like'
    ORDER BY ip.updated_at DESC
    LIMIT ?
  `).all(limit) as ActivityRow[];
  const coinedRows = db.prepare(`
    SELECT ip.item_id AS itemId, wp.part_id AS resumePartId,
      mp.part_index AS resumePartIndex, mp.title AS resumePartTitle,
      COALESCE(wp.position_seconds, 0) AS positionSeconds, mp.duration_seconds AS durationSeconds,
      COALESCE(wp.finished, 0) AS finished, wp.started_at AS startedAt,
      wp.completed_at AS completedAt, wp.updated_at AS updatedAt,
      ip.coined_at AS coinedAt, ip2.updated_at AS likedAt
    FROM item_preferences ip
    JOIN media_items mi ON mi.id = ip.item_id AND mi.hidden = 0
    LEFT JOIN watch_progress wp ON wp.item_id = ip.item_id
    LEFT JOIN media_parts mp ON mp.id = wp.part_id
    LEFT JOIN item_preferences ip2 ON ip2.item_id = ip.item_id AND ip2.reaction = 'like'
    WHERE ip.coined = 1
    ORDER BY ip.coined_at DESC
    LIMIT ?
  `).all(limit) as ActivityRow[];
  const feedItems = getFeedItemsByIds([...historyRows, ...likedRows, ...coinedRows].map((row) => row.itemId));
  const itemsById = new Map(feedItems.map((item) => [item.id, item]));
  const toEntry = (row: ActivityRow) => {
    const item = itemsById.get(row.itemId);
    if (!item) return null;
    const progressPercent = row.durationSeconds && row.durationSeconds > 0
      ? Math.min(100, Math.round((row.positionSeconds / row.durationSeconds) * 100))
      : 0;
    return {
      item,
      resumePartId: row.resumePartId,
      resumePartIndex: row.resumePartIndex,
      resumePartTitle: row.resumePartTitle,
      positionSeconds: row.positionSeconds,
      durationSeconds: row.durationSeconds,
      progressPercent,
      finished: Boolean(row.finished),
      liked: Boolean(row.likedAt),
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      updatedAt: row.updatedAt,
      likedAt: row.likedAt,
      coinedAt: row.coinedAt
    };
  };
  const history = historyRows.map(toEntry).filter((entry) => entry !== null);
  const recentLikes = likedRows.map(toEntry).filter((entry) => entry !== null);
  const recentCoins = coinedRows.map(toEntry).filter((entry) => entry !== null);
  return {
    history,
    continueWatching: history.filter((entry) => !entry.finished && entry.positionSeconds > 0),
    completed: history.filter((entry) => entry.finished),
    recentLikes,
    recentCoins,
    stats: {
      history: (db.prepare("SELECT COUNT(*) AS count FROM watch_progress").get() as { count: number }).count,
      completed: (db.prepare("SELECT COUNT(*) AS count FROM watch_progress WHERE finished = 1").get() as { count: number }).count,
      likes: (db.prepare("SELECT COUNT(*) AS count FROM item_preferences WHERE reaction = 'like'").get() as { count: number }).count,
      coins: (db.prepare("SELECT COUNT(*) AS count FROM item_preferences WHERE coined = 1").get() as { count: number }).count
    }
  };
});

app.get<{ Querystring: { seed?: string; limit?: string; sort?: string; kind?: string } }>("/feeds/dynamic", async (request) => ({
  items: getRecommendedFeed({
    seed: request.query.seed ?? "dynamic",
    limit: Number(request.query.limit ?? 36),
    includeImages: request.query.kind !== "video",
    kind: request.query.kind === "image" ? "image" : request.query.kind === "video" ? "video" : request.query.kind === "post" ? "post" : undefined,
    includeFinished: true,
    mode: request.query.sort === "oldest" ? "oldest" : request.query.sort === "random" ? "shuffle" : "latest"
  })
}));

app.get<{ Params: { id: string }; Querystring: { seed?: string } }>("/feeds/category/:id", async (request) => ({
  items: getRecommendedFeed({
    categoryId: request.params.id,
    seed: request.query.seed ?? request.params.id,
    includeImages: false,
    limit: 48
  })
}));

app.get<{ Params: { id: string }; Querystring: { seed?: string } }>("/feeds/creator/:id", async (request) => ({
  items: getRecommendedFeed({
    creatorId: request.params.id,
    seed: request.query.seed ?? request.params.id,
    includeImages: false,
    limit: 48
  })
}));

app.get("/categories", async () => ({
  categories: db.prepare(`
    SELECT c.id, c.name, COUNT(mi.id) AS itemCount
    FROM categories c
    LEFT JOIN media_items mi ON mi.category_id = c.id
    GROUP BY c.id
    ORDER BY itemCount DESC, c.name ASC
  `).all()
}));

app.get("/creators", async () => ({
  creators: db.prepare(`
    SELECT cr.id, cr.name, cr.alias, c.name AS categoryName, COUNT(mi.id) AS itemCount
    FROM creators cr
    LEFT JOIN categories c ON c.id = cr.category_id
    LEFT JOIN media_items mi ON mi.creator_id = cr.id
    GROUP BY cr.id
    ORDER BY itemCount DESC, cr.name ASC
  `).all()
}));

app.get<{ Params: { id: string } }>("/items/:id", async (request, reply) => {
  const item = db.prepare(`
    SELECT mi.*, c.name AS categoryName, cr.name AS creatorName, cr.alias AS creatorAlias,
      ip.reaction, ip.coined, ip.coined_at AS coinedAt,
      COALESCE(cp.blacklisted, 0) AS creatorBlacklisted,
      wp.part_id AS resumePartId, wp.position_seconds AS resumePositionSeconds
    FROM media_items mi
    LEFT JOIN categories c ON c.id = mi.category_id
    LEFT JOIN creators cr ON cr.id = mi.creator_id
    LEFT JOIN item_preferences ip ON ip.item_id = mi.id
    LEFT JOIN creator_preferences cp ON cp.creator_id = mi.creator_id
    LEFT JOIN watch_progress wp ON wp.item_id = mi.id
    WHERE mi.id = ?
  `).get(request.params.id);
  if (!item) {
    return reply.code(404).send({ error: "Item not found" });
  }

  const parts = db.prepare(`
    SELECT id, title, part_index AS partIndex, size_bytes AS sizeBytes,
      duration_seconds AS durationSeconds,
      compatibility_status AS compatibilityStatus,
      compatibility_error AS compatibilityError,
      preview_sprite_path AS previewSpritePath,
      preview_sprite_cols AS previewSpriteCols,
      preview_sprite_rows AS previewSpriteRows,
      preview_sprite_interval AS previewSpriteInterval,
      preview_thumb_w AS previewThumbW,
      preview_thumb_h AS previewThumbH
    FROM media_parts WHERE item_id = ? ORDER BY part_index ASC
  `).all(request.params.id) as {
    id: string;
    title: string;
    partIndex: number;
    sizeBytes: number;
    durationSeconds: number | null;
    compatibilityStatus: string;
    compatibilityError: string | null;
    previewSpritePath: string | null;
    previewSpriteCols: number | null;
    previewSpriteRows: number | null;
    previewSpriteInterval: number | null;
    previewThumbW: number | null;
    previewThumbH: number | null;
  }[];

  const partIds = parts.map((part) => part.id);
  const subtitlesRows = partIds.length > 0
    ? db.prepare(`
        SELECT id, part_id AS partId, language, label, is_default AS isDefault, sort_index AS sortIndex
        FROM media_subtitles WHERE part_id IN (${partIds.map(() => "?").join(",")})
        ORDER BY sort_index ASC
      `).all(...partIds) as {
        id: string;
        partId: string;
        language: string;
        label: string;
        isDefault: number;
        sortIndex: number;
      }[]
    : [];
  const subtitlesByPart = new Map<string, { id: string; language: string; label: string; isDefault: boolean; url: string }[]>();
  for (const row of subtitlesRows) {
    const list = subtitlesByPart.get(row.partId) ?? [];
    list.push({ id: row.id, language: row.language, label: row.label, isDefault: Boolean(row.isDefault), url: `/media/parts/${row.partId}/subtitles/${row.id}` });
    subtitlesByPart.set(row.partId, list);
  }
  const partsWithSubtitles = parts.map((part) => ({ ...part, subtitles: subtitlesByPart.get(part.id) ?? [] }));

  const comments = db.prepare("SELECT id, body, at_seconds AS atSeconds, created_at AS createdAt FROM comments WHERE item_id = ? ORDER BY created_at DESC")
    .all(request.params.id);
  const images = db.prepare(`
    SELECT id, sort_index AS sortIndex, width, height
    FROM media_images WHERE item_id = ? ORDER BY sort_index ASC
  `).all(request.params.id) as { id: string; sortIndex: number; width: number | null; height: number | null }[];
  const imageAssets = images.map((image) => ({
    ...image,
    thumbnailUrl: `/media/images/${image.id}/thumbnail`,
    originalUrl: `/media/images/${image.id}/original`
  }));
  const tagDetails = listItemTags(request.params.id);
  const related = getRecommendedFeed({ limit: 12, seed: request.params.id, includeFinished: false, excludeId: request.params.id });
  const favoritedFolderIds = db.prepare("SELECT folder_id AS folderId FROM favorites WHERE item_id = ?")
    .all(request.params.id).map((row: any) => row.folderId);

  return { item, parts: partsWithSubtitles, images: imageAssets, tags: tagDetails.map((tag) => tag.name), tagDetails, comments, related, favoritedFolderIds };
});

app.post<{ Params: { id: string }; Body: TagBody }>("/items/:id/tags", async (request, reply) => {
  try {
    const tags = addManualTagToItem(request.params.id, request.body.name ?? "");
    return reply.code(201).send({ tags });
  } catch (error) {
    return reply.code(error instanceof Error && error.message === "Item not found" ? 404 : 400)
      .send({ error: error instanceof Error ? error.message : "Unable to add tag" });
  }
});

app.delete<{ Params: { id: string; tagId: string } }>("/items/:id/tags/:tagId", async (request, reply) => {
  try {
    const tags = removeTagFromItem(request.params.id, request.params.tagId);
    return { tags };
  } catch (error) {
    return reply.code(error instanceof Error && (error.message === "Item not found" || error.message === "Tag not found") ? 404 : 400)
      .send({ error: error instanceof Error ? error.message : "Unable to remove tag" });
  }
});

app.get<{ Params: { id: string; variant: string } }>("/media/images/:id/:variant", async (request, reply) => {
  if (request.params.variant !== "thumbnail" && request.params.variant !== "original") {
    return reply.code(404).send({ error: "Image variant not found" });
  }
  const row = db.prepare("SELECT path, thumbnail_path FROM media_images WHERE id = ?").get(request.params.id) as
    | { path: string; thumbnail_path: string | null }
    | undefined;
  const selected = request.params.variant === "thumbnail" && row?.thumbnail_path && existsSync(row.thumbnail_path)
    ? row.thumbnail_path
    : row?.path && existsSync(row.path) ? row.path : null;
  if (!selected) return reply.code(404).send({ error: "Image not found" });
  reply.header("Content-Type", lookup(selected) || "application/octet-stream");
  reply.header("Cache-Control", "public, max-age=604800");
  reply.header("X-Content-Type-Options", "nosniff");
  return reply.send(createReadStream(selected));
});

app.get<{ Params: { id: string } }>("/media/items/:id/cover", async (request, reply) => {
  const row = db.prepare("SELECT cover_path, generated_cover_path FROM media_items WHERE id = ?").get(request.params.id) as
    | { cover_path: string | null; generated_cover_path: string | null }
    | undefined;
  const coverPath = row?.cover_path && existsSync(row.cover_path)
    ? row.cover_path
    : row?.generated_cover_path && existsSync(row.generated_cover_path) ? row.generated_cover_path : null;
  if (!coverPath) {
    return reply.code(404).send({ error: "Cover not found" });
  }

  reply.header("Content-Type", lookup(coverPath) || "application/octet-stream");
  reply.header("Cache-Control", "public, max-age=86400");
  return reply.send(createReadStream(coverPath));
});

app.get<{ Params: { id: string } }>("/media/parts/:id/sprite", async (request, reply) => {
  const row = db.prepare("SELECT preview_sprite_path FROM media_parts WHERE id = ?").get(request.params.id) as
    | { preview_sprite_path: string | null }
    | undefined;
  const spritePath = row?.preview_sprite_path && existsSync(row.preview_sprite_path) ? row.preview_sprite_path : null;
  if (!spritePath) {
    return reply.code(404).send({ error: "Preview sprite not found" });
  }
  reply.header("Content-Type", "image/webp");
  reply.header("Cache-Control", "public, max-age=604800");
  return reply.send(createReadStream(spritePath));
});

app.get<{ Params: { id: string; subId: string } }>("/media/parts/:id/subtitles/:subId", async (request, reply) => {
  const row = db.prepare("SELECT path FROM media_subtitles WHERE id = ? AND part_id = ?")
    .get(request.params.subId, request.params.id) as { path: string } | undefined;
  if (!row || !existsSync(row.path)) {
    return reply.code(404).send({ error: "Subtitle not found" });
  }
  const ext = extname(row.path).toLowerCase();
  const contentType = ext === ".vtt" ? "text/vtt" : ext === ".srt" ? "text/plain" : "application/octet-stream";
  reply.header("Content-Type", contentType);
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  reply.header("Pragma", "no-cache");
  reply.header("Expires", "0");
  return reply.send(createReadStream(row.path));
});

app.put<{ Params: { id: string }; Body: { reaction?: "like" | "dislike" | null } }>("/items/:id/reaction", async (request, reply) => {
  if (request.body.reaction !== null && request.body.reaction !== "like" && request.body.reaction !== "dislike") {
    return reply.code(400).send({ error: "Invalid reaction" });
  }
  const timestamp = nowIso();
  if (request.body.reaction === null) {
    db.prepare("UPDATE item_preferences SET reaction = NULL, updated_at = ? WHERE item_id = ?").run(timestamp, request.params.id);
    db.prepare("DELETE FROM item_preferences WHERE item_id = ? AND reaction IS NULL AND coined = 0").run(request.params.id);
  } else {
    db.prepare(`
      INSERT INTO item_preferences (item_id, reaction, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET reaction = excluded.reaction, updated_at = excluded.updated_at
    `).run(request.params.id, request.body.reaction, timestamp);
    recordRecommendationSignals(request.params.id, request.body.reaction, 1, timestamp);
  }
  return { reaction: request.body.reaction ?? null };
});

app.put<{ Params: { id: string }; Body: Record<string, never> | undefined }>("/items/:id/coin", async (request) => {
  const itemId = request.params.id;
  const current = db.prepare("SELECT coined FROM item_preferences WHERE item_id = ?").get(itemId) as
    | { coined: number }
    | undefined;
  const nextCoined = current?.coined ? 0 : 1;
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO item_preferences (item_id, coined, coined_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET coined = excluded.coined, coined_at = excluded.coined_at, updated_at = excluded.updated_at
  `).run(itemId, nextCoined, nextCoined ? timestamp : null, timestamp);

  if (nextCoined === 1) {
    recordRecommendationSignals(itemId, "coin", 1, timestamp);
  }

  return { coined: Boolean(nextCoined) };
});

app.put<{ Params: { id: string }; Body: { blacklisted?: boolean } }>("/creators/:id/blacklist", async (request) => {
  const blacklisted = Boolean(request.body.blacklisted);
  db.prepare(`
    INSERT INTO creator_preferences (creator_id, blacklisted, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(creator_id) DO UPDATE SET blacklisted = excluded.blacklisted, updated_at = excluded.updated_at
  `).run(request.params.id, blacklisted ? 1 : 0, nowIso());
  return { blacklisted };
});

app.get<{ Params: { id: string }; Headers: { range?: string } }>("/media/parts/:id/stream", async (request, reply) => {
  const row = db.prepare("SELECT path, size_bytes, stream_path, stream_size_bytes FROM media_parts WHERE id = ?").get(request.params.id) as
    | { path: string; size_bytes: number; stream_path: string | null; stream_size_bytes: number | null }
    | undefined;
  if (!row || !existsSync(row.path)) {
    return reply.code(404).send({ error: "Media part not found" });
  }

  const mediaPath = row.stream_path && existsSync(row.stream_path) ? row.stream_path : row.path;
  const total = statSync(mediaPath).size;
  const range = request.headers.range;
  const contentType = lookup(extname(mediaPath)) || "application/octet-stream";

  reply.header("Accept-Ranges", "bytes");
  reply.header("Cache-Control", "public, max-age=3600");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Connection", "keep-alive");

  if (!range) {
    reply.header("Content-Length", total);
    reply.header("Content-Type", contentType);
    return reply.send(createReadStream(mediaPath));
  }

  const match = range.match(/bytes=(\d+)-(\d*)/);
  if (!match) {
    return reply.code(416).send();
  }

  const start = Number(match[1]);
  const end = Math.min(match[2] ? Number(match[2]) : total - 1, total - 1);
  if (start >= total || end < start) {
    return reply.code(416).send();
  }
  const chunkSize = end - start + 1;

  reply.code(206);
  reply.header("Content-Range", `bytes ${start}-${end}/${total}`);
  reply.header("Content-Length", chunkSize);
  reply.header("Content-Type", contentType);
  return reply.send(createReadStream(mediaPath, { start, end }));
});

app.post<{ Params: { id: string }; Body: InteractionBody }>("/items/:id/interactions", async (request, reply) => {
  const item = db.prepare("SELECT id, creator_id, category_id FROM media_items WHERE id = ?").get(request.params.id) as
    | { id: string; creator_id: string | null; category_id: string | null }
    | undefined;
  if (!item || !request.body.kind) {
    return reply.code(400).send({ error: "Invalid interaction" });
  }

  const value = request.body.value ?? 1;
  if (request.body.kind === "finish" || request.body.kind === "watch") {
    const part = request.body.partId ? db.prepare(`
      SELECT mp.id, mp.part_index AS partIndex, mp.duration_seconds AS durationSeconds,
        (SELECT MAX(last_part.part_index) FROM media_parts last_part WHERE last_part.item_id = mp.item_id) AS lastPartIndex
      FROM media_parts mp WHERE mp.id = ? AND mp.item_id = ?
    `).get(request.body.partId, request.params.id) as
      | { id: string; partIndex: number; durationSeconds: number | null; lastPartIndex: number }
      | undefined : undefined;
    if (!part) return reply.code(400).send({ error: "Invalid media part" });
    const positionSeconds = Math.max(0, Number(request.body.positionSeconds ?? 0));
    const reportedDuration = Number(request.body.durationSeconds ?? 0);
    const durationSeconds = part.durationSeconds && part.durationSeconds > 0 ? part.durationSeconds : reportedDuration;
    const finished = part.partIndex === part.lastPartIndex
      && durationSeconds > 0
      && positionSeconds >= durationSeconds * 0.9;
    const timestamp = nowIso();
    if ((!part.durationSeconds || part.durationSeconds <= 0) && reportedDuration > 0) {
      db.prepare("UPDATE media_parts SET duration_seconds = ? WHERE id = ?").run(reportedDuration, part.id);
    }
    db.prepare(`
      INSERT INTO watch_progress (item_id, part_id, position_seconds, finished, started_at, completed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        part_id = excluded.part_id,
        position_seconds = excluded.position_seconds,
        finished = MAX(watch_progress.finished, excluded.finished),
        completed_at = CASE
          WHEN watch_progress.finished = 1 THEN watch_progress.completed_at
          WHEN excluded.finished = 1 THEN excluded.completed_at
          ELSE NULL
        END,
        updated_at = excluded.updated_at
    `).run(request.params.id, part.id, positionSeconds, finished ? 1 : 0, timestamp, finished ? timestamp : null, timestamp);
  }

  if (request.body.kind === "blacklist_up" && item.creator_id) {
    db.prepare("INSERT INTO interactions (id, target_type, target_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(createId("int"), "creator", item.creator_id, "blacklist_up", value, nowIso());
  } else {
    db.prepare("INSERT INTO interactions (id, target_type, target_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(createId("int"), "item", request.params.id, request.body.kind, value, nowIso());
    if ((request.body.kind === "like" || request.body.kind === "dislike") && item.creator_id) {
      db.prepare("INSERT INTO interactions (id, target_type, target_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(createId("int"), "creator", item.creator_id, request.body.kind, value, nowIso());
    }
    if ((request.body.kind === "like" || request.body.kind === "dislike") && item.category_id) {
      db.prepare("INSERT INTO interactions (id, target_type, target_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(createId("int"), "category", item.category_id, request.body.kind, value, nowIso());
    }
  }

  return { ok: true };
});

app.post<{ Params: { id: string }; Body: CommentBody }>("/items/:id/comments", async (request, reply) => {
  const body = request.body.body?.trim();
  if (!body) {
    return reply.code(400).send({ error: "Comment cannot be empty" });
  }
  const id = createId("comment");
  db.prepare("INSERT INTO comments (id, item_id, body, at_seconds, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, request.params.id, body, request.body.atSeconds ?? null, nowIso());
  return reply.code(201).send({ id });
});

app.get("/me/favorites", async () => ({
  folders: db.prepare(`
    SELECT ff.id, ff.name, ff.created_at AS createdAt,
      COUNT(f.id) AS itemCount,
      COALESCE(MAX(f.created_at), ff.created_at) AS updatedAt
    FROM favorite_folders ff
    LEFT JOIN favorites f ON f.folder_id = ff.id
    GROUP BY ff.id
    ORDER BY updatedAt DESC
  `).all()
}));

app.post<{ Body: FavoriteFolderBody }>("/me/favorites/folders", async (request, reply) => {
  const name = request.body.name?.trim() ?? "";
  if (!name || name.length > 50) {
    return reply.code(400).send({ error: "Invalid folder name" });
  }
  const id = createId("favfolder");
  const createdAt = nowIso();
  db.prepare("INSERT INTO favorite_folders (id, name, created_at) VALUES (?, ?, ?)").run(id, name, createdAt);
  return reply.code(201).send({ id, name, createdAt });
});

app.delete<{ Params: { id: string } }>("/me/favorites/folders/:id", async (request) => {
  db.prepare("DELETE FROM favorite_folders WHERE id = ?").run(request.params.id);
  return { ok: true };
});

app.post<{ Params: { id: string }; Body: FavoriteItemBody }>("/items/:id/favorites", async (request, reply) => {
  const itemId = request.params.id;
  const item = db.prepare("SELECT id FROM media_items WHERE id = ?").get(itemId);
  if (!item) {
    return reply.code(404).send({ error: "Item not found" });
  }

  let folderId = request.body.folderId;
  if (!folderId) {
    const existing = db.prepare("SELECT id FROM favorite_folders LIMIT 1").get() as { id: string } | undefined;
    if (existing) {
      folderId = existing.id;
    } else {
      folderId = createId("favfolder");
      db.prepare("INSERT INTO favorite_folders (id, name, created_at) VALUES (?, ?, ?)")
        .run(folderId, "默认收藏夹", nowIso());
    }
  }

  const favoriteId = createId("fav");
  const createdAt = nowIso();
  const result = db.prepare(`
    INSERT INTO favorites (id, folder_id, item_id, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(folder_id, item_id) DO NOTHING
  `).run(favoriteId, folderId, itemId, createdAt);
  if (result.changes > 0) {
    recordRecommendationSignals(itemId, "favorite", 1, createdAt);
  }
  return reply.code(201).send({ folderId, favorited: true });
});

app.delete<{ Params: { id: string }; Querystring: { folderId?: string } }>("/items/:id/favorites", async (request) => {
  if (request.query.folderId) {
    db.prepare("DELETE FROM favorites WHERE item_id = ? AND folder_id = ?").run(request.params.id, request.query.folderId);
  } else {
    db.prepare("DELETE FROM favorites WHERE item_id = ?").run(request.params.id);
  }
  return { ok: true };
});

app.get<{ Params: { id: string } }>("/me/favorites/folders/:id/items", async (request) => {
  const rows = db.prepare(`
    SELECT f.id AS favoriteId, f.created_at AS favoritedAt, f.folder_id AS folderId, f.item_id AS itemId
    FROM favorites f WHERE f.folder_id = ? ORDER BY f.created_at DESC
  `).all(request.params.id) as { favoriteId: string; favoritedAt: string; folderId: string; itemId: string }[];
  const feedItems = getFeedItemsByIds(rows.map((row) => row.itemId));
  const itemsById = new Map(feedItems.map((item) => [item.id, item]));
  const items = rows
    .map((row) => {
      const item = itemsById.get(row.itemId);
      if (!item) return null;
      return { item, favoritedAt: row.favoritedAt, folderId: row.folderId };
    })
    .filter((entry) => entry !== null);
  return { items };
});

app.delete<{ Params: { id: string } }>("/items/:id/watch-progress", async (request) => {
  db.prepare("DELETE FROM watch_progress WHERE item_id = ?").run(request.params.id);
  return { ok: true };
});

function recordRecommendationSignals(itemId: string, kind: InteractionKind, value: number, timestamp = nowIso()) {
  const item = db.prepare("SELECT id, creator_id, category_id FROM media_items WHERE id = ?").get(itemId) as
    | { id: string; creator_id: string | null; category_id: string | null }
    | undefined;
  if (!item) return;

  insertInteraction("item", itemId, kind, value, timestamp);
  if (item.creator_id && (kind === "like" || kind === "dislike" || kind === "coin" || kind === "favorite")) {
    insertInteraction("creator", item.creator_id, kind, value, timestamp);
  }
  if (item.category_id && (kind === "like" || kind === "dislike" || kind === "coin" || kind === "favorite")) {
    insertInteraction("category", item.category_id, kind, value, timestamp);
  }

  const tags = db.prepare(`
    SELECT tag_id AS tagId, source, sort_order AS sortOrder
    FROM media_tags WHERE media_item_id = ?
    ORDER BY CASE source WHEN 'manual' THEN 0 ELSE 1 END, sort_order ASC
  `).all(itemId) as { tagId: string; source: "scan" | "manual"; sortOrder: number }[];
  for (const tag of tags) {
    insertInteraction("tag", tag.tagId, kind, value * tagSignalMultiplier(tag.source, tag.sortOrder), timestamp);
  }
}

function insertInteraction(targetType: "item" | "creator" | "category" | "tag", targetId: string, kind: InteractionKind, value: number, timestamp: string) {
  db.prepare("INSERT INTO interactions (id, target_type, target_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(createId("int"), targetType, targetId, kind, value, timestamp);
}

function tagSignalMultiplier(source: "scan" | "manual", sortOrder: number) {
  const sourceBoost = source === "manual" ? 1.75 : 1;
  const positionBoost = Math.max(0.45, 1 - Math.max(0, sortOrder) * 0.08);
  return sourceBoost * positionBoost;
}

const host = process.env.HILI_API_HOST ?? "0.0.0.0";
const port = Number(process.env.HILI_API_PORT ?? 4141);

await app.listen({ host, port });

function getBrowsableRoots(): DirectoryEntry[] {
  const allowedRoot = getAllowedRoot();
  if (allowedRoot) {
    return [{ name: basename(allowedRoot) || "安全演示库", path: allowedRoot, isDirectory: true }];
  }
  if (platform() === "win32") {
    const roots: DirectoryEntry[] = [];
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (existsSync(drive)) {
        roots.push({ name: drive, path: drive, isDirectory: true });
      }
    }
    return roots;
  }

  return ["/", "/mnt", "/media", "/volume1"]
    .filter((path) => existsSync(path))
    .map((path) => ({ name: path, path, isDirectory: true }));
}

function getAllowedRoot() {
  if (process.env.HILI_TEST_MODE !== "1" || !process.env.HILI_ALLOWED_MEDIA_ROOT) {
    return null;
  }
  return resolve(process.env.HILI_ALLOWED_MEDIA_ROOT);
}

function isPathAllowed(targetPath: string) {
  const allowedRoot = getAllowedRoot();
  if (!allowedRoot) {
    return true;
  }
  const pathFromRoot = relative(allowedRoot, resolve(targetPath));
  return pathFromRoot === "" || (!isAbsolute(pathFromRoot) && !pathFromRoot.startsWith("..") && !pathFromRoot.includes(`..${sep}`));
}
