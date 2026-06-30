import type { FastifyInstance } from "fastify";
import { categories, creatorPreferences, creators, interactions, mediaItems, mediaParts, mediaTags, tags, upsertSearchHistory } from "@hilihili/db";
import { getFeedItemsByIds } from "@hilihili/recommendation";
import type { FeedItem } from "@hilihili/shared";
import { eq, sql } from "drizzle-orm";
import { db } from "../lib/db.js";
import { clampLimit } from "../lib/clamp.js";

export async function searchRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>("/search", async (request) => {
    const query = (request.query.q?.trim() ?? "").slice(0, 200);
    const requestedOffset = Number(request.query.offset ?? 0);
    const limit = clampLimit(Number(request.query.limit ?? 36), 36);
    const offset = Number.isFinite(requestedOffset) ? Math.max(requestedOffset, 0) : 0;
    if (!query) return { query, items: [] as FeedItem[], total: 0, hasMore: false };

    const pattern = `%${query}%`;
    const prefixPattern = `${query}%`;
    // 8 个 LIKE 模式 + COUNT(*) OVER() + 多 CASE WHEN + 多 EXISTS 子查询。
    // SELECT 投影由 Drizzle 推导类型（id/total）；复杂 WHERE/ORDER BY 用 sql 模板引用 schema 列，
    // 消除裸 SQL 字段名与 schema 脱节的风险。语义与原 SQL 完全等价。
    const rows = db.select({
      id: mediaItems.id,
      total: sql<number>`COUNT(*) OVER()`
    })
      .from(mediaItems)
      .leftJoin(categories, eq(categories.id, mediaItems.categoryId))
      .leftJoin(creators, eq(creators.id, mediaItems.creatorId))
      .where(sql`${mediaItems.hidden} = 0
        AND NOT EXISTS (
          SELECT 1 FROM ${creatorPreferences}
          WHERE ${creatorPreferences.creatorId} = ${mediaItems.creatorId} AND ${creatorPreferences.blacklisted} = 1
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${interactions}
          WHERE ${interactions.targetType} = 'creator' AND ${interactions.targetId} = ${mediaItems.creatorId} AND ${interactions.kind} = 'blacklist_up'
        )
        AND (
          ${mediaItems.title} LIKE ${pattern} COLLATE NOCASE
          OR COALESCE(${mediaItems.postBody}, '') LIKE ${pattern} COLLATE NOCASE
          OR COALESCE(${mediaItems.description}, '') LIKE ${pattern} COLLATE NOCASE
          OR COALESCE(${creators.name}, '') LIKE ${pattern} COLLATE NOCASE
          OR COALESCE(${creators.alias}, '') LIKE ${pattern} COLLATE NOCASE
          OR COALESCE(${categories.name}, '') LIKE ${pattern} COLLATE NOCASE
          OR EXISTS (
            SELECT 1 FROM ${mediaTags} JOIN ${tags} ON ${tags.id} = ${mediaTags.tagId}
            WHERE ${mediaTags.mediaItemId} = ${mediaItems.id} AND ${tags.name} LIKE ${pattern} COLLATE NOCASE
          )
          OR EXISTS (
            SELECT 1 FROM ${mediaParts}
            WHERE ${mediaParts.itemId} = ${mediaItems.id} AND ${mediaParts.title} LIKE ${pattern} COLLATE NOCASE
          )
        )`)
      .orderBy(
        sql`CASE
          WHEN ${mediaItems.title} = ${query} COLLATE NOCASE THEN 0
          WHEN ${mediaItems.title} LIKE ${prefixPattern} COLLATE NOCASE THEN 1
          WHEN COALESCE(${creators.name}, '') LIKE ${pattern} COLLATE NOCASE OR COALESCE(${creators.alias}, '') LIKE ${pattern} COLLATE NOCASE THEN 2
          ELSE 3
        END`,
        sql`COALESCE(${mediaItems.contentPublishedAt}, ${mediaItems.fileModifiedAt}, ${mediaItems.firstSeenAt}) DESC`
      )
      .limit(limit)
      .offset(offset)
      .all();
    const total = rows.length > 0 ? rows[0].total : 0;
    const items = getFeedItemsByIds(rows.map((row) => row.id));
    if (total > 0 && query) {
      try {
        upsertSearchHistory(query);
      } catch (error) {
        request.log.error({ err: error }, "Failed to record search history");
      }
    }
    return { query, items, total, hasMore: offset + items.length < total };
  });
}
