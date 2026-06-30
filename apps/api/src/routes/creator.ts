import type { FastifyInstance } from "fastify";
import { nowIso } from "@hilihili/db";
import { getRecommendedFeed } from "@hilihili/recommendation";
import { db } from "../lib/db.js";
import { clampLimit } from "../lib/clamp.js";

export async function creatorRoutes(app: FastifyInstance) {
  app.get("/creators", async () => ({
    creators: db.prepare(`
      SELECT cr.id, cr.name, cr.alias, cr.description, c.name AS categoryName, COUNT(mi.id) AS itemCount
      FROM creators cr
      LEFT JOIN categories c ON c.id = cr.category_id
      LEFT JOIN media_items mi ON mi.creator_id = cr.id
      GROUP BY cr.id
      ORDER BY itemCount DESC, cr.name ASC
    `).all()
  }));

  app.get<{ Params: { id: string } }>("/creators/:id", async (request, reply) => {
    const creator = db.prepare(`
      SELECT cr.id, cr.name, cr.alias, cr.description,
        CASE WHEN cr.avatar_path IS NOT NULL THEN '/media/creators/' || cr.id || '/avatar' ELSE NULL END AS avatarUrl,
        CASE WHEN cr.banner_path IS NOT NULL THEN '/media/creators/' || cr.id || '/banner' ELSE NULL END AS bannerUrl,
        COALESCE(cp.followed, 0) AS followed, COALESCE(cp.blacklisted, 0) AS blacklisted
      FROM creators cr
      LEFT JOIN creator_preferences cp ON cp.creator_id = cr.id
      WHERE cr.id = ?
    `).get(request.params.id) as Record<string, unknown> | undefined;
    if (!creator) return reply.code(404).send({ error: "Creator not found" });
    const stats = db.prepare(`
      SELECT COUNT(*) AS itemCount,
        SUM(CASE WHEN kind = 'video' THEN 1 ELSE 0 END) AS videoCount,
        SUM(CASE WHEN kind = 'post' THEN 1 ELSE 0 END) AS postCount,
        SUM(CASE WHEN kind = 'image' THEN 1 ELSE 0 END) AS imageCount
      FROM media_items WHERE creator_id = ? AND hidden = 0
    `).get(request.params.id);
    const categories = db.prepare(`
      SELECT c.id, c.name, COUNT(mi.id) AS itemCount
      FROM media_items mi JOIN categories c ON c.id = mi.category_id
      WHERE mi.creator_id = ? AND mi.hidden = 0
      GROUP BY c.id ORDER BY itemCount DESC, c.name ASC
    `).all(request.params.id);
    return { creator, stats, categories };
  });

  app.get<{ Params: { id: string }; Querystring: { kind?: "video" | "post" | "image"; limit?: string; offset?: string } }>("/creators/:id/items", async (request, reply) => {
    const exists = db.prepare("SELECT 1 FROM creators WHERE id = ?").get(request.params.id);
    if (!exists) return reply.code(404).send({ error: "Creator not found" });
    const limit = clampLimit(Number(request.query.limit ?? 24), 24);
    const offset = Math.max(Number(request.query.offset ?? 0), 0);
    const kind = request.query.kind;
    const count = db.prepare(`
      SELECT COUNT(*) AS count FROM media_items
      WHERE creator_id = ? AND hidden = 0 ${kind ? "AND kind = ?" : ""}
    `).get(...(kind ? [request.params.id, kind] : [request.params.id])) as { count: number };
    const items = getRecommendedFeed({ creatorId: request.params.id, kind, limit, offset, includeImages: true, includeFinished: true, includeBlacklisted: true, mode: "latest" });
    return { items, total: count.count, hasMore: offset + items.length < count.count };
  });

  app.put<{ Params: { id: string }; Body: { followed?: boolean } }>("/creators/:id/follow", async (request, reply) => {
    const exists = db.prepare("SELECT 1 FROM creators WHERE id = ?").get(request.params.id);
    if (!exists) return reply.code(404).send({ error: "Creator not found" });
    const body = request.body ?? ({} as typeof request.body);
    const followed = Boolean(body.followed);
    const current = db.prepare("SELECT blacklisted FROM creator_preferences WHERE creator_id = ?").get(request.params.id) as { blacklisted: number } | undefined;
    if (followed && current?.blacklisted) return reply.code(409).send({ error: "Unblock this creator before following" });
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO creator_preferences (creator_id, blacklisted, followed, followed_at, updated_at)
      VALUES (?, 0, ?, ?, ?)
      ON CONFLICT(creator_id) DO UPDATE SET
        followed = excluded.followed,
        followed_at = CASE WHEN excluded.followed = 1 THEN excluded.followed_at ELSE NULL END,
        updated_at = excluded.updated_at
    `).run(request.params.id, followed ? 1 : 0, followed ? timestamp : null, timestamp);
    return { followed };
  });

  app.put<{ Params: { id: string }; Body: { blacklisted?: boolean } }>("/creators/:id/blacklist", async (request, reply) => {
    const exists = db.prepare("SELECT 1 FROM creators WHERE id = ?").get(request.params.id);
    if (!exists) return reply.code(404).send({ error: "Creator not found" });
    const body = request.body ?? ({} as typeof request.body);
    const blacklisted = Boolean(body.blacklisted);
    const timestamp = nowIso();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO creator_preferences (creator_id, blacklisted, followed, followed_at, updated_at) VALUES (?, ?, 0, NULL, ?)
        ON CONFLICT(creator_id) DO UPDATE SET
          blacklisted = excluded.blacklisted,
          followed = CASE WHEN excluded.blacklisted = 1 THEN 0 ELSE creator_preferences.followed END,
          followed_at = CASE WHEN excluded.blacklisted = 1 THEN NULL ELSE creator_preferences.followed_at END,
          updated_at = excluded.updated_at
      `).run(request.params.id, blacklisted ? 1 : 0, timestamp);
      if (blacklisted) db.prepare("DELETE FROM creator_messages WHERE creator_id = ?").run(request.params.id);
    })();
    return { blacklisted };
  });
}
