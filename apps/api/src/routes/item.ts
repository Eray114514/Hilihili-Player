import { createId, nowIso, categories, comments, creatorPreferences, creators, favoriteFolders, favorites, interactions, itemPreferences, mediaImages, mediaItems, mediaParts, mediaSubtitles, mediaTags, watchProgress } from "@hilihili/db";
import { addManualTagToItem, listItemTags, removeTagFromItem } from "@hilihili/media";
import { getRecommendedFeed } from "@hilihili/recommendation";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../lib/db.js";
import { recordRecommendationSignals } from "../lib/signals.js";
import {
  commentSchema,
  emptySchema,
  favoriteItemSchema,
  idParamSchema,
  interactionSchema,
  reactionSchema,
  tagSchema,
  type ZodFastifyInstance
} from "../lib/types.js";

export async function itemRoutes(app: ZodFastifyInstance) {
  app.get<{ Params: { id: string } }>("/items/:id", async (request, reply) => {
    // wire format 统一用 camelCase（web 的 ItemDetail 类型按 camelCase 读取 postBody/creatorId 等）
    // 用 Drizzle 链式 + 显式别名让类型从 schema 推导，JSON 字段名与 TS 属性名一致
    const item = db.select({
      id: mediaItems.id,
      kind: mediaItems.kind,
      title: mediaItems.title,
      postBody: mediaItems.postBody,
      description: mediaItems.description,
      libraryId: mediaItems.libraryId,
      categoryId: mediaItems.categoryId,
      creatorId: mediaItems.creatorId,
      sourcePath: mediaItems.sourcePath,
      relativePath: mediaItems.relativePath,
      folderPath: mediaItems.folderPath,
      fingerprint: mediaItems.fingerprint,
      coverPath: mediaItems.coverPath,
      generatedCoverPath: mediaItems.generatedCoverPath,
      thumbnailStatus: mediaItems.thumbnailStatus,
      thumbnailError: mediaItems.thumbnailError,
      contentPublishedAt: mediaItems.contentPublishedAt,
      fileModifiedAt: mediaItems.fileModifiedAt,
      hidden: mediaItems.hidden,
      structureStatus: mediaItems.structureStatus,
      firstSeenAt: mediaItems.firstSeenAt,
      lastScannedAt: mediaItems.lastScannedAt,
      updatedAt: mediaItems.updatedAt,
      categoryName: categories.name,
      creatorName: creators.name,
      creatorAlias: creators.alias,
      creatorAvatarUrl: sql<string | null>`CASE WHEN ${creators.avatarPath} IS NOT NULL THEN '/media/creators/' || ${creators.id} || '/avatar' ELSE NULL END`,
      reaction: itemPreferences.reaction,
      coined: itemPreferences.coined,
      coinedAt: itemPreferences.coinedAt,
      creatorBlacklisted: sql<number>`COALESCE(${creatorPreferences.blacklisted}, 0)`,
      resumePartId: watchProgress.partId,
      resumePositionSeconds: watchProgress.positionSeconds
    })
      .from(mediaItems)
      .leftJoin(categories, eq(categories.id, mediaItems.categoryId))
      .leftJoin(creators, eq(creators.id, mediaItems.creatorId))
      .leftJoin(itemPreferences, eq(itemPreferences.itemId, mediaItems.id))
      .leftJoin(creatorPreferences, eq(creatorPreferences.creatorId, mediaItems.creatorId))
      .leftJoin(watchProgress, eq(watchProgress.itemId, mediaItems.id))
      .where(eq(mediaItems.id, request.params.id))
      .get();
    if (!item) {
      return reply.code(404).send({ error: "Item not found" });
    }

    // parts + subtitles 一次 JOIN 查询后按 part 分组（保持原行为）
    const joinRows = db.select({
      id: mediaParts.id,
      title: mediaParts.title,
      partIndex: mediaParts.partIndex,
      sizeBytes: mediaParts.sizeBytes,
      durationSeconds: mediaParts.durationSeconds,
      compatibilityStatus: mediaParts.compatibilityStatus,
      compatibilityError: mediaParts.compatibilityError,
      previewSpritePath: mediaParts.previewSpritePath,
      previewSpriteCols: mediaParts.previewSpriteCols,
      previewSpriteRows: mediaParts.previewSpriteRows,
      previewSpriteInterval: mediaParts.previewSpriteInterval,
      previewThumbW: mediaParts.previewThumbW,
      previewThumbH: mediaParts.previewThumbH,
      subtitleId: mediaSubtitles.id,
      subtitleLanguage: mediaSubtitles.language,
      subtitleLabel: mediaSubtitles.label,
      subtitleIsDefault: mediaSubtitles.isDefault,
      subtitleSortIndex: mediaSubtitles.sortIndex
    })
      .from(mediaParts)
      .leftJoin(mediaSubtitles, eq(mediaSubtitles.partId, mediaParts.id))
      .where(eq(mediaParts.itemId, request.params.id))
      .orderBy(asc(mediaParts.partIndex), asc(mediaSubtitles.sortIndex))
      .all();
    // 把 JOIN 出的扁平行按 part 分组，subtitles 嵌套进对应 part（2 次查询合并为 1 次）
    type PartRow = {
      id: string;
      title: string;
      partIndex: number;
      sizeBytes: number;
      durationSeconds: number | null;
      compatibilityStatus: "pending" | "ready" | "failed";
      compatibilityError: string | null;
      previewSpritePath: string | null;
      previewSpriteCols: number | null;
      previewSpriteRows: number | null;
      previewSpriteInterval: number | null;
      previewThumbW: number | null;
      previewThumbH: number | null;
      subtitles: { id: string; language: string; label: string; isDefault: boolean; url: string }[];
    };
    type Subtitle = { id: string; language: string; label: string; isDefault: boolean; url: string };
    const partsWithSubtitles: PartRow[] = [];
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
        const subtitle: Subtitle = {
          id: row.subtitleId,
          language: row.subtitleLanguage ?? "",
          label: row.subtitleLabel ?? "",
          isDefault: Boolean(row.subtitleIsDefault),
          url: `/media/parts/${row.id}/subtitles/${row.subtitleId}`
        };
        partsWithSubtitles[idx].subtitles.push(subtitle);
      }
    }

    const commentsRows = db.select({
      id: comments.id,
      body: comments.body,
      atSeconds: comments.atSeconds,
      createdAt: comments.createdAt
    })
      .from(comments)
      .where(eq(comments.itemId, request.params.id))
      .orderBy(sql`${comments.createdAt} DESC`)
      .all();
    const images = db.select({
      id: mediaImages.id,
      sortIndex: mediaImages.sortIndex,
      width: mediaImages.width,
      height: mediaImages.height,
      isAnimated: mediaImages.isAnimated,
      frameCount: mediaImages.frameCount,
      durationMs: mediaImages.durationMs
    })
      .from(mediaImages)
      .where(eq(mediaImages.itemId, request.params.id))
      .orderBy(asc(mediaImages.sortIndex))
      .all();
    const imageAssets = images.map((image) => ({
      ...image,
      isAnimated: Boolean(image.isAnimated),
      thumbnailUrl: `/media/images/${image.id}/thumbnail`,
      originalUrl: `/media/images/${image.id}/original`
    }));
    const tagDetails = listItemTags(request.params.id);
    const related = getRecommendedFeed({ limit: 12, seed: request.params.id, includeFinished: false, excludeId: request.params.id });
    // 消除原 (row: any) => row.folderId 的 any 断言：Drizzle 推导出 { folderId: string }[]
    const favoritedFolderIds = db.select({ folderId: favorites.folderId })
      .from(favorites)
      .where(eq(favorites.itemId, request.params.id))
      .all()
      .map((row) => row.folderId);

    return { item, parts: partsWithSubtitles, images: imageAssets, tags: tagDetails.map((tag) => tag.name), tagDetails, comments: commentsRows, related, favoritedFolderIds };
  });

  app.post("/items/:id/tags", { schema: { params: idParamSchema, body: tagSchema } }, async (request, reply) => {
    try {
      const body = request.body;
      const tags = addManualTagToItem(request.params.id, body.name ?? "");
      return reply.code(201).send({ tags });
    } catch (error) {
      return reply.code(error instanceof Error && error.message === "Item not found" ? 404 : 400)
        .send({ error: error instanceof Error ? error.message : "Unable to add tag" });
    }
  });

  app.delete<{ Params: { id: string; tagId: string } }>("/items/:id/tags/:tagId", async (request, reply) => {
    try {
      // 先检查 (itemId, tagId) 是否真的关联，未关联（含 tag 不存在/不属于该 item）返 404。
      // removeTagFromItem 走 metadata 文件重建流程，无法用 changes 判断，故用预检 SELECT。
      const existing = db.select({ tagId: mediaTags.tagId })
        .from(mediaTags)
        .where(and(eq(mediaTags.mediaItemId, request.params.id), eq(mediaTags.tagId, request.params.tagId)))
        .get();
      if (!existing) {
        return reply.code(404).send({ error: "Tag not found" });
      }
      const tags = removeTagFromItem(request.params.id, request.params.tagId);
      return { tags };
    } catch (error) {
      return reply.code(error instanceof Error && (error.message === "Item not found" || error.message === "Tag not found") ? 404 : 400)
        .send({ error: error instanceof Error ? error.message : "Unable to remove tag" });
    }
  });

  app.put("/items/:id/reaction", { schema: { params: idParamSchema, body: reactionSchema } }, async (request, reply) => {
    const body = request.body;
    const timestamp = nowIso();
    if (body.reaction === null) {
      db.transaction((tx) => {
        tx.update(itemPreferences).set({ reaction: null, updatedAt: timestamp }).where(eq(itemPreferences.itemId, request.params.id)).run();
        tx.delete(itemPreferences).where(and(eq(itemPreferences.itemId, request.params.id), sql`${itemPreferences.reaction} IS NULL`, eq(itemPreferences.coined, false))).run();
      });
    } else {
      const item = db.select({
        id: mediaItems.id,
        creatorId: mediaItems.creatorId,
        categoryId: mediaItems.categoryId
      })
        .from(mediaItems)
        .where(eq(mediaItems.id, request.params.id))
        .get();
      if (!item) return reply.code(404).send({ error: "Item not found" });
      db.insert(itemPreferences).values({
        itemId: request.params.id,
        reaction: body.reaction,
        updatedAt: timestamp
      })
        .onConflictDoUpdate({
          target: itemPreferences.itemId,
          set: {
            reaction: sql`excluded.reaction`,
            updatedAt: sql`excluded.updated_at`
          }
        })
        .run();
      recordRecommendationSignals(item, body.reaction, 1, timestamp);
    }
    return { reaction: body.reaction ?? null };
  });

  app.patch("/items/:id/coin", { schema: { params: idParamSchema, body: emptySchema } }, async (request, reply) => {
    const itemId = request.params.id;
    const timestamp = nowIso();
    const item = db.select({
      id: mediaItems.id,
      creatorId: mediaItems.creatorId,
      categoryId: mediaItems.categoryId
    })
      .from(mediaItems)
      .where(eq(mediaItems.id, itemId))
      .get();
    if (!item) return reply.code(404).send({ error: "Item not found" });
    // 单语句 toggle：用 CASE 翻转当前值，消除 SELECT-then-UPDATE 竞态
    db.insert(itemPreferences).values({
      itemId,
      coined: true,
      coinedAt: timestamp,
      updatedAt: timestamp
    })
      .onConflictDoUpdate({
        target: itemPreferences.itemId,
        set: {
          coined: sql`1 - ${itemPreferences.coined}`,
          coinedAt: sql`CASE WHEN 1 - ${itemPreferences.coined} = 1 THEN ${timestamp} ELSE NULL END`,
          updatedAt: timestamp
        }
      })
      .run();
    const current = db.select({ coined: itemPreferences.coined })
      .from(itemPreferences)
      .where(eq(itemPreferences.itemId, itemId))
      .get();
    const coined = Boolean(current?.coined);
    if (coined) recordRecommendationSignals(item, "coin", 1, timestamp);
    return { coined };
  });

  app.post("/items/:id/interactions", { schema: { params: idParamSchema, body: interactionSchema } }, async (request, reply) => {
    const body = request.body;
    const item = db.select({
      id: mediaItems.id,
      creatorId: mediaItems.creatorId,
      categoryId: mediaItems.categoryId
    })
      .from(mediaItems)
      .where(eq(mediaItems.id, request.params.id))
      .get();
    if (!item) {
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
      if (body.partId) {
        const partRow = db.select({
          id: mediaParts.id,
          partIndex: mediaParts.partIndex,
          durationSeconds: mediaParts.durationSeconds,
          lastPartIndex: sql<number>`(SELECT MAX(${mediaParts.partIndex}) FROM media_parts last_part WHERE last_part.${mediaParts.itemId} = ${mediaParts.itemId})`
        })
          .from(mediaParts)
          .where(and(eq(mediaParts.id, body.partId), eq(mediaParts.itemId, request.params.id)))
          .get();
        part = partRow;
      }
      if (!part) return reply.code(400).send({ error: "Invalid media part" });
      positionSeconds = Math.max(0, Number(body.positionSeconds ?? 0));
      reportedDuration = Number(body.durationSeconds ?? 0);
      const durationSeconds = part.durationSeconds && part.durationSeconds > 0 ? part.durationSeconds : reportedDuration;
      finished = part.partIndex === part.lastPartIndex
        && durationSeconds > 0
        && positionSeconds >= durationSeconds * 0.9;
    }

    db.transaction((tx) => {
      const timestamp = nowIso();
      if (part && (kind === "finish" || kind === "watch")) {
        if ((!part.durationSeconds || part.durationSeconds <= 0) && reportedDuration > 0) {
          tx.update(mediaParts).set({ durationSeconds: reportedDuration }).where(eq(mediaParts.id, part.id)).run();
        }
        tx.insert(watchProgress).values({
          itemId: request.params.id,
          partId: part.id,
          positionSeconds,
          finished,
          startedAt: timestamp,
          completedAt: finished ? timestamp : null,
          updatedAt: timestamp
        })
          .onConflictDoUpdate({
            target: watchProgress.itemId,
            set: {
              partId: sql`excluded.part_id`,
              positionSeconds: sql`excluded.position_seconds`,
              finished: sql`MAX(${watchProgress.finished}, excluded.finished)`,
              completedAt: sql`CASE WHEN ${watchProgress.finished} = 1 THEN ${watchProgress.completedAt} WHEN excluded.finished = 1 THEN excluded.completed_at ELSE NULL END`,
              updatedAt: sql`excluded.updated_at`
            }
          })
          .run();
      }

      if (kind === "blacklist_up" && item.creatorId) {
        tx.insert(interactions).values({
          id: createId("int"),
          targetType: "creator",
          targetId: item.creatorId,
          kind: "blacklist_up",
          value,
          createdAt: timestamp
        }).run();
      } else {
        tx.insert(interactions).values({
          id: createId("int"),
          targetType: "item",
          targetId: request.params.id,
          kind,
          value,
          createdAt: timestamp
        }).run();
        if ((kind === "like" || kind === "dislike") && item.creatorId) {
          tx.insert(interactions).values({
            id: createId("int"),
            targetType: "creator",
            targetId: item.creatorId,
            kind,
            value,
            createdAt: timestamp
          }).run();
        }
        if ((kind === "like" || kind === "dislike") && item.categoryId) {
          tx.insert(interactions).values({
            id: createId("int"),
            targetType: "category",
            targetId: item.categoryId,
            kind,
            value,
            createdAt: timestamp
          }).run();
        }
      }
    });

    return { ok: true };
  });

  app.post("/items/:id/comments", { schema: { params: idParamSchema, body: commentSchema } }, async (request, reply) => {
    const body = request.body;
    const text = body.body?.trim();
    if (!text) {
      return reply.code(400).send({ error: "Comment cannot be empty" });
    }
    const id = createId("comment");
    db.insert(comments).values({
      id,
      itemId: request.params.id,
      body: text,
      atSeconds: body.atSeconds ?? null,
      createdAt: nowIso()
    }).run();
    return reply.code(201).send({ id });
  });

  app.post("/items/:id/favorites", { schema: { params: idParamSchema, body: favoriteItemSchema } }, async (request, reply) => {
    const body = request.body;
    const itemId = request.params.id;
    const item = db.select({
      id: mediaItems.id,
      creatorId: mediaItems.creatorId,
      categoryId: mediaItems.categoryId
    })
      .from(mediaItems)
      .where(eq(mediaItems.id, itemId))
      .get();
    if (!item) {
      return reply.code(404).send({ error: "Item not found" });
    }

    const folderId = db.transaction((tx) => {
      let resolvedFolderId = body.folderId;
      if (!resolvedFolderId) {
        const existing = tx.select({ id: favoriteFolders.id }).from(favoriteFolders).limit(1).get();
        if (existing) {
          resolvedFolderId = existing.id;
        } else {
          resolvedFolderId = createId("favfolder");
          tx.insert(favoriteFolders).values({
            id: resolvedFolderId,
            name: "默认收藏夹",
            createdAt: nowIso()
          }).run();
        }
      }

      const favoriteId = createId("fav");
      const createdAt = nowIso();
      const result = tx.insert(favorites).values({
        id: favoriteId,
        folderId: resolvedFolderId,
        itemId,
        createdAt
      })
        .onConflictDoNothing()
        .run();
      if (result.changes > 0) {
        recordRecommendationSignals(item, "favorite", 1, createdAt);
      }
      return resolvedFolderId;
    });

    return reply.code(201).send({ folderId, favorited: true });
  });

  app.delete<{ Params: { id: string }; Querystring: { folderId?: string } }>("/items/:id/favorites", async (request, reply) => {
    if (request.query.folderId) {
      const result = db.delete(favorites).where(and(eq(favorites.itemId, request.params.id), eq(favorites.folderId, request.query.folderId))).run();
      if (result.changes === 0) {
        return reply.code(404).send({ error: "Favorite not found" });
      }
    } else {
      db.delete(favorites).where(eq(favorites.itemId, request.params.id)).run();
    }
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/items/:id/watch-progress", async (request, reply) => {
    const result = db.delete(watchProgress).where(eq(watchProgress.itemId, request.params.id)).run();
    if (result.changes === 0) {
      return reply.code(404).send({ error: "Watch progress not found" });
    }
    return { ok: true };
  });
}
