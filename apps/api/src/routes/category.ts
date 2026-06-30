import type { FastifyInstance } from "fastify";
import { db } from "../lib/db.js";

export async function categoryRoutes(app: FastifyInstance) {
  app.get("/categories", async () => ({
    categories: db.prepare(`
      SELECT c.id, c.name, COUNT(mi.id) AS itemCount
      FROM categories c
      LEFT JOIN media_items mi ON mi.category_id = c.id
      GROUP BY c.id
      HAVING COUNT(mi.id) > 0
      ORDER BY itemCount DESC, c.name ASC
    `).all()
  }));
}
