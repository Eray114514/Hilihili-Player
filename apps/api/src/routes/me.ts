import { clearSearchHistory, createId, deleteSearchHistory, listSearchHistory, nowIso } from "@hilihili/db";
import { getFeedItemsByIds } from "@hilihili/recommendation";
import type { FeedItem } from "@hilihili/shared";
import { db } from "../lib/db.js";
import { clampLimit } from "../lib/clamp.js";
import { type ActivityRow, emptySchema, favoriteFolderSchema, type ZodFastifyInstance } from "../lib/types.js";

export async function meRoutes(app: ZodFastifyInstance) {
  app.get<{ Querystring: { limit?: string } }>("/me/activity", async (request) => {
    const limit = clampLimit(Number(request.query.limit ?? 60), 60);
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
    return {
      history,
      continueWatching: history.filter((entry) => !entry.finished && entry.positionSeconds > 0),
      completed: history.filter((entry) => entry.finished),
      recentLikes,
      recentCoins,
      stats: db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM watch_progress) AS history,
          (SELECT COUNT(*) FROM watch_progress WHERE finished = 1) AS completed,
          (SELECT COUNT(*) FROM item_preferences WHERE reaction = 'like') AS likes,
          (SELECT COUNT(*) FROM item_preferences WHERE coined = 1) AS coins
      `).get() as { history: number; completed: number; likes: number; coins: number }
    };
  });

  app.get("/me/messages/unread-count", async () => ({
    unreadCount: (db.prepare("SELECT COUNT(*) AS count FROM creator_messages WHERE read_at IS NULL").get() as { count: number }).count
  }));

  app.get<{ Querystring: { limit?: string; offset?: string } }>("/me/messages", async (request) => {
    const limit = clampLimit(Number(request.query.limit ?? 40), 40);
    const offset = Math.max(Number(request.query.offset ?? 0), 0);
    const rows = db.prepare(`
      SELECT cm.id, cm.item_id AS itemId, cm.creator_id AS creatorId, cm.created_at AS createdAt, cm.read_at AS readAt
      FROM creator_messages cm JOIN media_items mi ON mi.id = cm.item_id
      WHERE mi.hidden = 0 ORDER BY cm.created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset) as { id: string; itemId: string; creatorId: string; createdAt: string; readAt: string | null }[];
    const feedItems = getFeedItemsByIds(rows.map((row) => row.itemId));
    const byId = new Map(feedItems.map((item) => [item.id, item]));
    const messages = rows.flatMap((row) => {
      const item = byId.get(row.itemId);
      return item ? [{ ...row, item }] : [];
    });
    const total = (db.prepare("SELECT COUNT(*) AS count FROM creator_messages").get() as { count: number }).count;
    const unreadCount = (db.prepare("SELECT COUNT(*) AS count FROM creator_messages WHERE read_at IS NULL").get() as { count: number }).count;
    return { messages, total, unreadCount, hasMore: offset + rows.length < total };
  });

  app.post("/me/messages:read", { schema: { body: emptySchema } }, async () => {
    const timestamp = nowIso();
    db.prepare("UPDATE creator_messages SET read_at = ? WHERE read_at IS NULL").run(timestamp);
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
    folders: db.prepare(`
      SELECT ff.id, ff.name, ff.created_at AS createdAt,
        COUNT(f.id) AS itemCount
      FROM favorite_folders ff
      LEFT JOIN favorites f ON f.folder_id = ff.id
      GROUP BY ff.id
      ORDER BY COALESCE(MAX(f.created_at), ff.created_at) DESC
    `).all()
  }));

  app.post("/me/favorites/folders", { schema: { body: favoriteFolderSchema } }, async (request, reply) => {
    const body = request.body;
    const name = body.name?.trim() ?? "";
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
}
