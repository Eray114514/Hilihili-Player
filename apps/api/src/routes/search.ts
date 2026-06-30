import type { FastifyInstance } from "fastify";
import { upsertSearchHistory } from "@hilihili/db";
import { getFeedItemsByIds } from "@hilihili/recommendation";
import type { FeedItem } from "@hilihili/shared";
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
          OR COALESCE(mi.description, '') LIKE ? COLLATE NOCASE
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
    const params = Array.from({ length: 8 }, () => pattern);
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
