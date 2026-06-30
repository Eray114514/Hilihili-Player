import type { FastifyInstance } from "fastify";
import { createId, nowIso } from "@hilihili/db";
import { addManualTagToItem, listItemTags, removeTagFromItem } from "@hilihili/media";
import { getRecommendedFeed } from "@hilihili/recommendation";
import { db } from "../lib/db.js";
import { recordRecommendationSignals } from "../lib/signals.js";
import type { CommentBody, FavoriteItemBody, InteractionBody, TagBody } from "../lib/types.js";

export async function itemRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/items/:id", async (request, reply) => {
    const item = db.prepare(`
      SELECT mi.*, c.name AS categoryName, cr.name AS creatorName, cr.alias AS creatorAlias,
        CASE WHEN cr.avatar_path IS NOT NULL THEN '/media/creators/' || cr.id || '/avatar' ELSE NULL END AS creatorAvatarUrl,
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

    type PartRow = {
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
    };
    type Subtitle = { id: string; language: string; label: string; isDefault: boolean; url: string };
    const joinRows = db.prepare(`
      SELECT mp.id, mp.title, mp.part_index AS partIndex, mp.size_bytes AS sizeBytes,
        mp.duration_seconds AS durationSeconds,
        mp.compatibility_status AS compatibilityStatus,
        mp.compatibility_error AS compatibilityError,
        mp.preview_sprite_path AS previewSpritePath,
        mp.preview_sprite_cols AS previewSpriteCols,
        mp.preview_sprite_rows AS previewSpriteRows,
        mp.preview_sprite_interval AS previewSpriteInterval,
        mp.preview_thumb_w AS previewThumbW,
        mp.preview_thumb_h AS previewThumbH,
        ms.id AS subtitleId, ms.language AS subtitleLanguage, ms.label AS subtitleLabel,
        ms.is_default AS subtitleIsDefault, ms.sort_index AS subtitleSortIndex
      FROM media_parts mp
      LEFT JOIN media_subtitles ms ON ms.part_id = mp.id
      WHERE mp.item_id = ?
      ORDER BY mp.part_index ASC, ms.sort_index ASC
    `).all(request.params.id) as (PartRow & {
      subtitleId: string | null;
      subtitleLanguage: string | null;
      subtitleLabel: string | null;
      subtitleIsDefault: number | null;
      subtitleSortIndex: number | null;
    })[];
    // 把 JOIN 出的扁平行按 part 分组，subtitles 嵌套进对应 part（2 次查询合并为 1 次）
    const partsWithSubtitles: (PartRow & { subtitles: Subtitle[] })[] = [];
    const partIndexById = new Map<string, number>();
    for (const row of joinRows) {
      let idx = partIndexById.get(row.id);
      if (idx === undefined) {
        idx = partsWithSubtitles.length;
        partIndexById.set(row.id, idx);
        partsWithSubtitles.push({
          id: row.id,
          title: row.title,
          partIndex: row.partIndex,
          sizeBytes: row.sizeBytes,
          durationSeconds: row.durationSeconds,
          compatibilityStatus: row.compatibilityStatus,
          compatibilityError: row.compatibilityError,
          previewSpritePath: row.previewSpritePath,
          previewSpriteCols: row.previewSpriteCols,
          previewSpriteRows: row.previewSpriteRows,
          previewSpriteInterval: row.previewSpriteInterval,
          previewThumbW: row.previewThumbW,
          previewThumbH: row.previewThumbH,
          subtitles: []
        });
      }
      if (row.subtitleId) {
        partsWithSubtitles[idx].subtitles.push({
          id: row.subtitleId,
          language: row.subtitleLanguage ?? "",
          label: row.subtitleLabel ?? "",
          isDefault: Boolean(row.subtitleIsDefault),
          url: `/media/parts/${row.id}/subtitles/${row.subtitleId}`
        });
      }
    }

    const comments = db.prepare("SELECT id, body, at_seconds AS atSeconds, created_at AS createdAt FROM comments WHERE item_id = ? ORDER BY created_at DESC")
      .all(request.params.id);
    const images = db.prepare(`
      SELECT id, sort_index AS sortIndex, width, height, is_animated AS isAnimated, frame_count AS frameCount, duration_ms AS durationMs
      FROM media_images WHERE item_id = ? ORDER BY sort_index ASC
    `).all(request.params.id) as { id: string; sortIndex: number; width: number | null; height: number | null; isAnimated: number | null; frameCount: number | null; durationMs: number | null }[];
    const imageAssets = images.map((image) => ({
      ...image,
      isAnimated: Boolean(image.isAnimated),
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
      const body = request.body ?? ({} as typeof request.body);
      const tags = addManualTagToItem(request.params.id, body.name ?? "");
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

  app.put<{ Params: { id: string }; Body: { reaction?: "like" | "dislike" | null } }>("/items/:id/reaction", async (request, reply) => {
    const body = request.body ?? ({} as typeof request.body);
    if (body.reaction !== null && body.reaction !== "like" && body.reaction !== "dislike") {
      return reply.code(400).send({ error: "Invalid reaction" });
    }
    const timestamp = nowIso();
    if (body.reaction === null) {
      db.transaction(() => {
        db.prepare("UPDATE item_preferences SET reaction = NULL, updated_at = ? WHERE item_id = ?").run(timestamp, request.params.id);
        db.prepare("DELETE FROM item_preferences WHERE item_id = ? AND reaction IS NULL AND coined = 0").run(request.params.id);
      })();
    } else {
      const item = db.prepare("SELECT id, creator_id, category_id FROM media_items WHERE id = ?").get(request.params.id) as
        | { id: string; creator_id: string | null; category_id: string | null }
        | undefined;
      if (!item) return reply.code(404).send({ error: "Item not found" });
      db.prepare(`
        INSERT INTO item_preferences (item_id, reaction, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(item_id) DO UPDATE SET reaction = excluded.reaction, updated_at = excluded.updated_at
      `).run(request.params.id, body.reaction, timestamp);
      recordRecommendationSignals(item, body.reaction, 1, timestamp);
    }
    return { reaction: body.reaction ?? null };
  });

  app.patch<{ Params: { id: string }; Body: Record<string, never> | undefined }>("/items/:id/coin", async (request, reply) => {
    const itemId = request.params.id;
    const timestamp = nowIso();
    const item = db.prepare("SELECT id, creator_id, category_id FROM media_items WHERE id = ?").get(itemId) as
      | { id: string; creator_id: string | null; category_id: string | null }
      | undefined;
    if (!item) return reply.code(404).send({ error: "Item not found" });
    // 单语句 toggle：用 CASE 翻转当前值，消除 SELECT-then-UPDATE 竞态
    db.prepare(`
      INSERT INTO item_preferences (item_id, coined, coined_at, updated_at)
      VALUES (?, 1, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        coined = 1 - item_preferences.coined,
        coined_at = CASE WHEN 1 - item_preferences.coined = 1 THEN ? ELSE NULL END,
        updated_at = ?
    `).run(itemId, timestamp, timestamp, timestamp, timestamp);
    const current = db.prepare("SELECT coined FROM item_preferences WHERE item_id = ?").get(itemId) as { coined: number } | undefined;
    const coined = Boolean(current?.coined);
    if (coined) recordRecommendationSignals(item, "coin", 1, timestamp);
    return { coined };
  });

  app.post<{ Params: { id: string }; Body: InteractionBody }>("/items/:id/interactions", async (request, reply) => {
    const body = request.body ?? ({} as typeof request.body);
    const item = db.prepare("SELECT id, creator_id, category_id FROM media_items WHERE id = ?").get(request.params.id) as
      | { id: string; creator_id: string | null; category_id: string | null }
      | undefined;
    if (!item || !body.kind) {
      return reply.code(400).send({ error: "Invalid interaction" });
    }
    const kind = body.kind;
    const value = body.value ?? 1;

    // 预读 + 纯计算（事务外），事务内只做写
    let part: { id: string; partIndex: number; durationSeconds: number | null; lastPartIndex: number } | undefined;
    let positionSeconds = 0;
    let reportedDuration = 0;
    let finished = false;
    if (kind === "finish" || kind === "watch") {
      part = body.partId ? db.prepare(`
        SELECT mp.id, mp.part_index AS partIndex, mp.duration_seconds AS durationSeconds,
          (SELECT MAX(last_part.part_index) FROM media_parts last_part WHERE last_part.item_id = mp.item_id) AS lastPartIndex
        FROM media_parts mp WHERE mp.id = ? AND mp.item_id = ?
      `).get(body.partId, request.params.id) as
        | { id: string; partIndex: number; durationSeconds: number | null; lastPartIndex: number }
        | undefined : undefined;
      if (!part) return reply.code(400).send({ error: "Invalid media part" });
      positionSeconds = Math.max(0, Number(body.positionSeconds ?? 0));
      reportedDuration = Number(body.durationSeconds ?? 0);
      const durationSeconds = part.durationSeconds && part.durationSeconds > 0 ? part.durationSeconds : reportedDuration;
      finished = part.partIndex === part.lastPartIndex
        && durationSeconds > 0
        && positionSeconds >= durationSeconds * 0.9;
    }

    db.transaction(() => {
      const timestamp = nowIso();
      if (part && (kind === "finish" || kind === "watch")) {
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

      if (kind === "blacklist_up" && item.creator_id) {
        db.prepare("INSERT INTO interactions (id, target_type, target_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(createId("int"), "creator", item.creator_id, "blacklist_up", value, timestamp);
      } else {
        db.prepare("INSERT INTO interactions (id, target_type, target_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(createId("int"), "item", request.params.id, kind, value, timestamp);
        if ((kind === "like" || kind === "dislike") && item.creator_id) {
          db.prepare("INSERT INTO interactions (id, target_type, target_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(createId("int"), "creator", item.creator_id, kind, value, timestamp);
        }
        if ((kind === "like" || kind === "dislike") && item.category_id) {
          db.prepare("INSERT INTO interactions (id, target_type, target_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(createId("int"), "category", item.category_id, kind, value, timestamp);
        }
      }
    })();

    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: CommentBody }>("/items/:id/comments", async (request, reply) => {
    const body = request.body ?? ({} as typeof request.body);
    const text = body.body?.trim();
    if (!text) {
      return reply.code(400).send({ error: "Comment cannot be empty" });
    }
    const id = createId("comment");
    db.prepare("INSERT INTO comments (id, item_id, body, at_seconds, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, request.params.id, text, body.atSeconds ?? null, nowIso());
    return reply.code(201).send({ id });
  });

  app.post<{ Params: { id: string }; Body: FavoriteItemBody }>("/items/:id/favorites", async (request, reply) => {
    const body = request.body ?? ({} as typeof request.body);
    const itemId = request.params.id;
    const item = db.prepare("SELECT id, creator_id, category_id FROM media_items WHERE id = ?").get(itemId) as
      | { id: string; creator_id: string | null; category_id: string | null }
      | undefined;
    if (!item) {
      return reply.code(404).send({ error: "Item not found" });
    }

    const folderId = db.transaction(() => {
      let resolvedFolderId = body.folderId;
      if (!resolvedFolderId) {
        const existing = db.prepare("SELECT id FROM favorite_folders LIMIT 1").get() as { id: string } | undefined;
        if (existing) {
          resolvedFolderId = existing.id;
        } else {
          resolvedFolderId = createId("favfolder");
          db.prepare("INSERT INTO favorite_folders (id, name, created_at) VALUES (?, ?, ?)")
            .run(resolvedFolderId, "默认收藏夹", nowIso());
        }
      }

      const favoriteId = createId("fav");
      const createdAt = nowIso();
      const result = db.prepare(`
        INSERT INTO favorites (id, folder_id, item_id, created_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(folder_id, item_id) DO NOTHING
      `).run(favoriteId, resolvedFolderId, itemId, createdAt);
      if (result.changes > 0) {
        recordRecommendationSignals(item, "favorite", 1, createdAt);
      }
      return resolvedFolderId;
    })();

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

  app.delete<{ Params: { id: string } }>("/items/:id/watch-progress", async (request) => {
    db.prepare("DELETE FROM watch_progress WHERE item_id = ?").run(request.params.id);
    return { ok: true };
  });
}
