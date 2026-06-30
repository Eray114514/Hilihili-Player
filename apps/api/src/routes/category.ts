import type { FastifyInstance } from "fastify";
import { categories, mediaItems } from "@hilihili/db";
import { asc, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../lib/db.js";

export async function categoryRoutes(app: FastifyInstance) {
  app.get("/categories", async () => ({
    // HAVING COUNT(mi.id) > 0 排除空分类；用 count(mediaItems.id) 保持 COUNT(<column>) 语义（跳过 NULL 行）
    categories: db.select({
      id: categories.id,
      name: categories.name,
      itemCount: count(mediaItems.id)
    })
      .from(categories)
      .leftJoin(mediaItems, eq(mediaItems.categoryId, categories.id))
      .groupBy(categories.id)
      .having(sql`COUNT(${mediaItems.id}) > 0`)
      .orderBy(desc(count(mediaItems.id)), asc(categories.name))
      .all()
  }));
}
