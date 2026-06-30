import { creatorMessages, creatorPreferences, creators, categories, mediaItems, nowIso } from "@hilihili/db";
import { getRecommendedFeed } from "@hilihili/recommendation";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../lib/db.js";
import { clampLimit } from "../lib/clamp.js";
import { blacklistSchema, followSchema, idParamSchema, type ZodFastifyInstance } from "../lib/types.js";

export async function creatorRoutes(app: ZodFastifyInstance) {
  app.get("/creators", async () => ({
    creators: db.select({
      id: creators.id,
      name: creators.name,
      alias: creators.alias,
      description: creators.description,
      categoryName: categories.name,
      itemCount: count(mediaItems.id)
    })
      .from(creators)
      .leftJoin(categories, eq(categories.id, creators.categoryId))
      .leftJoin(mediaItems, eq(mediaItems.creatorId, creators.id))
      .groupBy(creators.id)
      .orderBy(desc(count(mediaItems.id)), asc(creators.name))
      .all()
  }));

  app.get<{ Params: { id: string } }>("/creators/:id", async (request, reply) => {
    // CASE WHEN 用 sql 模板；COALESCE 包裹的 boolean 列保留 0/1 整数 wire format 以匹配原 SQL
    const creator = db.select({
      id: creators.id,
      name: creators.name,
      alias: creators.alias,
      description: creators.description,
      avatarUrl: sql<string | null>`CASE WHEN ${creators.avatarPath} IS NOT NULL THEN '/media/creators/' || ${creators.id} || '/avatar' ELSE NULL END`,
      bannerUrl: sql<string | null>`CASE WHEN ${creators.bannerPath} IS NOT NULL THEN '/media/creators/' || ${creators.id} || '/banner' ELSE NULL END`,
      followed: sql<number>`COALESCE(${creatorPreferences.followed}, 0)`,
      blacklisted: sql<number>`COALESCE(${creatorPreferences.blacklisted}, 0)`
    })
      .from(creators)
      .leftJoin(creatorPreferences, eq(creatorPreferences.creatorId, creators.id))
      .where(eq(creators.id, request.params.id))
      .get();
    if (!creator) return reply.code(404).send({ error: "Creator not found" });
    const stats = db.select({
      itemCount: count(),
      videoCount: sql<number>`SUM(CASE WHEN ${mediaItems.kind} = 'video' THEN 1 ELSE 0 END)`,
      postCount: sql<number>`SUM(CASE WHEN ${mediaItems.kind} = 'post' THEN 1 ELSE 0 END)`,
      imageCount: sql<number>`SUM(CASE WHEN ${mediaItems.kind} = 'image' THEN 1 ELSE 0 END)`
    })
      .from(mediaItems)
      .where(and(eq(mediaItems.creatorId, request.params.id), eq(mediaItems.hidden, false)))
      .get();
    const categoriesRows = db.select({
      id: categories.id,
      name: categories.name,
      itemCount: count(mediaItems.id)
    })
      .from(mediaItems)
      .innerJoin(categories, eq(categories.id, mediaItems.categoryId))
      .where(and(eq(mediaItems.creatorId, request.params.id), eq(mediaItems.hidden, false)))
      .groupBy(categories.id)
      .orderBy(desc(count(mediaItems.id)), asc(categories.name))
      .all();
    return { creator, stats, categories: categoriesRows };
  });

  app.get<{ Params: { id: string }; Querystring: { kind?: "video" | "post" | "image"; limit?: string; offset?: string } }>("/creators/:id/items", async (request, reply) => {
    // 用 .select().from().get() 让 Drizzle 推导存在性查询的返回类型（无需 as 断言）
    const exists = db.select({ id: creators.id }).from(creators).where(eq(creators.id, request.params.id)).get();
    if (!exists) return reply.code(404).send({ error: "Creator not found" });
    const limit = clampLimit(Number(request.query.limit ?? 24), 24);
    const offset = Math.max(Number(request.query.offset ?? 0), 0);
    const kind = request.query.kind;
    const conditions = [eq(mediaItems.creatorId, request.params.id), eq(mediaItems.hidden, false)];
    if (kind) conditions.push(eq(mediaItems.kind, kind));
    const countResult = db.select({ count: count() })
      .from(mediaItems)
      .where(and(...conditions))
      .get();
    const total = countResult?.count ?? 0;
    const items = getRecommendedFeed({ creatorId: request.params.id, kind, limit, offset, includeImages: true, includeFinished: true, includeBlacklisted: true, mode: "latest" });
    return { items, total, hasMore: offset + items.length < total };
  });

  app.put("/creators/:id/follow", { schema: { params: idParamSchema, body: followSchema } }, async (request, reply) => {
    const exists = db.select({ id: creators.id }).from(creators).where(eq(creators.id, request.params.id)).get();
    if (!exists) return reply.code(404).send({ error: "Creator not found" });
    const body = request.body;
    const followed = Boolean(body.followed);
    const current = db.select({ blacklisted: creatorPreferences.blacklisted })
      .from(creatorPreferences)
      .where(eq(creatorPreferences.creatorId, request.params.id))
      .get();
    if (followed && current?.blacklisted) return reply.code(409).send({ error: "Unblock this creator before following" });
    const timestamp = nowIso();
    // ON CONFLICT(creator_id) DO UPDATE：set 中引用 excluded.<column> 与原 SQL 等价
    db.insert(creatorPreferences).values({
      creatorId: request.params.id,
      blacklisted: false,
      followed,
      followedAt: followed ? timestamp : null,
      updatedAt: timestamp
    })
      .onConflictDoUpdate({
        target: creatorPreferences.creatorId,
        set: {
          followed: sql`excluded.followed`,
          followedAt: sql`CASE WHEN excluded.followed = 1 THEN excluded.followed_at ELSE NULL END`,
          updatedAt: sql`excluded.updated_at`
        }
      })
      .run();
    return { followed };
  });

  app.put("/creators/:id/blacklist", { schema: { params: idParamSchema, body: blacklistSchema } }, async (request, reply) => {
    const exists = db.select({ id: creators.id }).from(creators).where(eq(creators.id, request.params.id)).get();
    if (!exists) return reply.code(404).send({ error: "Creator not found" });
    const body = request.body;
    const blacklisted = Boolean(body.blacklisted);
    const timestamp = nowIso();
    db.transaction((tx) => {
      tx.insert(creatorPreferences).values({
        creatorId: request.params.id,
        blacklisted,
        followed: false,
        followedAt: null,
        updatedAt: timestamp
      })
        .onConflictDoUpdate({
          target: creatorPreferences.creatorId,
          set: {
            blacklisted: sql`excluded.blacklisted`,
            followed: sql`CASE WHEN excluded.blacklisted = 1 THEN 0 ELSE ${creatorPreferences.followed} END`,
            followedAt: sql`CASE WHEN excluded.blacklisted = 1 THEN NULL ELSE ${creatorPreferences.followedAt} END`,
            updatedAt: sql`excluded.updated_at`
          }
        })
        .run();
      if (blacklisted) tx.delete(creatorMessages).where(eq(creatorMessages.creatorId, request.params.id)).run();
    });
    return { blacklisted };
  });
}
