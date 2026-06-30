import { clearSearchHistory, createId, creatorMessages, deleteSearchHistory, favoriteFolders, favorites, itemPreferences, listSearchHistory, mediaItems, mediaParts, nowIso, watchProgress } from "@hilihili/db";
import { getFeedItemsByIds } from "@hilihili/recommendation";
import type { FeedItem } from "@hilihili/shared";
import { alias } from "drizzle-orm/sqlite-core";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../lib/db.js";
import { clampLimit } from "../lib/clamp.js";
import { type ActivityRow, emptySchema, favoriteFolderSchema, type ZodFastifyInstance } from "../lib/types.js";

export async function meRoutes(app: ZodFastifyInstance) {
  app.get<{ Querystring: { limit?: string } }>("/me/activity", async (request) => {
    const limit = clampLimit(Number(request.query.limit ?? 60), 60);
    // history: watch_progress JOIN media_items LEFT JOIN media_parts LEFT JOIN item_preferences(reaction='like')
    // 注意 ip.updated_at AS likedAt 用 reaction='like' 的 LEFT JOIN，保留原语义
    // finished 用 sql<number> 保留 0/1 wire format（ActivityRow.finished 为 number），coinedAt 填 NULL 保持行形状一致
    const historyRows = db.select({
      itemId: watchProgress.itemId,
      resumePartId: watchProgress.partId,
      resumePartIndex: mediaParts.partIndex,
      resumePartTitle: mediaParts.title,
      positionSeconds: watchProgress.positionSeconds,
      durationSeconds: mediaParts.durationSeconds,
      finished: sql<number>`COALESCE(${watchProgress.finished}, 0)`,
      startedAt: watchProgress.startedAt,
      completedAt: watchProgress.completedAt,
      updatedAt: watchProgress.updatedAt,
      likedAt: itemPreferences.updatedAt,
      coinedAt: sql<string | null>`NULL`
    })
      .from(watchProgress)
      .innerJoin(mediaItems, and(eq(mediaItems.id, watchProgress.itemId), eq(mediaItems.hidden, false)))
      .leftJoin(mediaParts, eq(mediaParts.id, watchProgress.partId))
      .leftJoin(itemPreferences, and(eq(itemPreferences.itemId, watchProgress.itemId), eq(itemPreferences.reaction, "like")))
      .orderBy(desc(watchProgress.updatedAt))
      .limit(limit)
      .all();
    // likedRows: item_preferences(reaction='like') JOIN media_items LEFT JOIN watch_progress LEFT JOIN media_parts
    // COALESCE(wp.position_seconds, 0) 和 COALESCE(wp.finished, 0) 用 sql 表达式保留 0/1 wire format
    // coinedAt 填 NULL 保持行形状一致（likedRows 无 coined 信息）
    const likedRows = db.select({
      itemId: itemPreferences.itemId,
      resumePartId: watchProgress.partId,
      resumePartIndex: mediaParts.partIndex,
      resumePartTitle: mediaParts.title,
      positionSeconds: sql<number>`COALESCE(${watchProgress.positionSeconds}, 0)`,
      durationSeconds: mediaParts.durationSeconds,
      finished: sql<number>`COALESCE(${watchProgress.finished}, 0)`,
      startedAt: watchProgress.startedAt,
      completedAt: watchProgress.completedAt,
      updatedAt: watchProgress.updatedAt,
      likedAt: itemPreferences.updatedAt,
      coinedAt: sql<string | null>`NULL`
    })
      .from(itemPreferences)
      .innerJoin(mediaItems, and(eq(mediaItems.id, itemPreferences.itemId), eq(mediaItems.hidden, false)))
      .leftJoin(watchProgress, eq(watchProgress.itemId, itemPreferences.itemId))
      .leftJoin(mediaParts, eq(mediaParts.id, watchProgress.partId))
      .where(eq(itemPreferences.reaction, "like"))
      .orderBy(desc(itemPreferences.updatedAt))
      .limit(limit)
      .all();
    // coinedRows: 类似 likedRows，但 WHERE coined = 1，ORDER BY coined_at DESC，再 LEFT JOIN 一次 ip2 取 like 的 likedAt
    // 用 alias(itemPreferences, "ip2") 实现同表自引用 JOIN（drizzle-orm/sqlite-core 的 alias 函数）
    const ip2 = alias(itemPreferences, "ip2");
    const coinedRows = db.select({
      itemId: itemPreferences.itemId,
      resumePartId: watchProgress.partId,
      resumePartIndex: mediaParts.partIndex,
      resumePartTitle: mediaParts.title,
      positionSeconds: sql<number>`COALESCE(${watchProgress.positionSeconds}, 0)`,
      durationSeconds: mediaParts.durationSeconds,
      finished: sql<number>`COALESCE(${watchProgress.finished}, 0)`,
      startedAt: watchProgress.startedAt,
      completedAt: watchProgress.completedAt,
      updatedAt: watchProgress.updatedAt,
      coinedAt: itemPreferences.coinedAt,
      likedAt: ip2.updatedAt
    })
      .from(itemPreferences)
      .innerJoin(mediaItems, and(eq(mediaItems.id, itemPreferences.itemId), eq(mediaItems.hidden, false)))
      .leftJoin(watchProgress, eq(watchProgress.itemId, itemPreferences.itemId))
      .leftJoin(mediaParts, eq(mediaParts.id, watchProgress.partId))
      .leftJoin(ip2, and(eq(ip2.itemId, itemPreferences.itemId), eq(ip2.reaction, "like")))
      .where(eq(itemPreferences.coined, true))
      .orderBy(desc(itemPreferences.coinedAt))
      .limit(limit)
      .all();
    // 分 3 次调用，避免 getFeedItemsByIds 内部 slice(0, 80) 截断 240 条 id
    const itemsById = new Map<string, FeedItem>();
    for (const item of getFeedItemsByIds(historyRows.map((row) => row.itemId))) itemsById.set(item.id, item);
    for (const item of getFeedItemsByIds(likedRows.map((row) => row.itemId))) itemsById.set(item.id, item);
    for (const item of getFeedItemsByIds(coinedRows.map((row) => row.itemId))) itemsById.set(item.id, item);
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
    // stats: 4 个子查询 COUNT，保留为单条 sql 模板（4 次 COUNT 一条返回，比 4 次 select 更高效）
    return {
      history,
      continueWatching: history.filter((entry) => !entry.finished && entry.positionSeconds > 0),
      completed: history.filter((entry) => entry.finished),
      recentLikes,
      recentCoins,
      stats: db.get<{
        history: number;
        completed: number;
        likes: number;
        coins: number;
      }>(sql`SELECT
        (SELECT COUNT(*) FROM ${watchProgress}) AS history,
        (SELECT COUNT(*) FROM ${watchProgress} WHERE ${watchProgress.finished} = 1) AS completed,
        (SELECT COUNT(*) FROM ${itemPreferences} WHERE ${itemPreferences.reaction} = 'like') AS likes,
        (SELECT COUNT(*) FROM ${itemPreferences} WHERE ${itemPreferences.coined} = 1) AS coins
      `)
    };
  });

  app.get("/me/messages/unread-count", async () => ({
    unreadCount: db.select({ count: count() })
      .from(creatorMessages)
      .where(isNull(creatorMessages.readAt))
      .get()?.count ?? 0
  }));

  app.get<{ Querystring: { limit?: string; offset?: string } }>("/me/messages", async (request) => {
    const limit = clampLimit(Number(request.query.limit ?? 40), 40);
    const offset = Math.max(Number(request.query.offset ?? 0), 0);
    const rows = db.select({
      id: creatorMessages.id,
      itemId: creatorMessages.itemId,
      creatorId: creatorMessages.creatorId,
      createdAt: creatorMessages.createdAt,
      readAt: creatorMessages.readAt
    })
      .from(creatorMessages)
      .innerJoin(mediaItems, eq(mediaItems.id, creatorMessages.itemId))
      .where(eq(mediaItems.hidden, false))
      .orderBy(desc(creatorMessages.createdAt))
      .limit(limit)
      .offset(offset)
      .all();
    const feedItems = getFeedItemsByIds(rows.map((row) => row.itemId));
    const byId = new Map(feedItems.map((item) => [item.id, item]));
    const messages = rows.flatMap((row) => {
      const item = byId.get(row.itemId);
      return item ? [{ ...row, item }] : [];
    });
    const total = db.select({ count: count() }).from(creatorMessages).get()?.count ?? 0;
    const unreadCount = db.select({ count: count() })
      .from(creatorMessages)
      .where(isNull(creatorMessages.readAt))
      .get()?.count ?? 0;
    return { messages, total, unreadCount, hasMore: offset + rows.length < total };
  });

  app.post("/me/messages:read", { schema: { body: emptySchema } }, async () => {
    const timestamp = nowIso();
    db.update(creatorMessages).set({ readAt: timestamp }).where(isNull(creatorMessages.readAt)).run();
    return { readAt: timestamp };
  });

  app.get("/me/search-history", async () => ({
    items: listSearchHistory(20)
  }));

  app.delete("/me/search-history", async () => {
    clearSearchHistory();
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/me/search-history/:id", async (request) => {
    deleteSearchHistory(request.params.id);
    return { ok: true };
  });

  app.get("/me/favorites", async () => ({
    folders: db.select({
      id: favoriteFolders.id,
      name: favoriteFolders.name,
      createdAt: favoriteFolders.createdAt,
      itemCount: count(favorites.id)
    })
      .from(favoriteFolders)
      .leftJoin(favorites, eq(favorites.folderId, favoriteFolders.id))
      .groupBy(favoriteFolders.id)
      .orderBy(sql`COALESCE(MAX(${favorites.createdAt}), ${favoriteFolders.createdAt}) DESC`)
      .all()
  }));

  app.post("/me/favorites/folders", { schema: { body: favoriteFolderSchema } }, async (request, reply) => {
    const body = request.body;
    const name = body.name?.trim() ?? "";
    if (!name || name.length > 50) {
      return reply.code(400).send({ error: "Invalid folder name" });
    }
    const id = createId("favfolder");
    const createdAt = nowIso();
    db.insert(favoriteFolders).values({ id, name, createdAt }).run();
    return reply.code(201).send({ id, name, createdAt });
  });

  app.delete<{ Params: { id: string } }>("/me/favorites/folders/:id", async (request) => {
    db.delete(favoriteFolders).where(eq(favoriteFolders.id, request.params.id)).run();
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>("/me/favorites/folders/:id/items", async (request) => {
    const rows = db.select({
      favoriteId: favorites.id,
      favoritedAt: favorites.createdAt,
      folderId: favorites.folderId,
      itemId: favorites.itemId
    })
      .from(favorites)
      .where(eq(favorites.folderId, request.params.id))
      .orderBy(desc(favorites.createdAt))
      .all();
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
}
