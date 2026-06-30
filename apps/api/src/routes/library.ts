import { basename, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { createId, nowIso } from "@hilihili/db";
import { enqueueScan } from "@hilihili/media";
import { db } from "../lib/db.js";
import { isPathAllowed } from "../lib/fs-roots.js";
import { addLibrarySchema, scanRunSchema, type ZodFastifyInstance } from "../lib/types.js";

export async function libraryRoutes(app: ZodFastifyInstance) {
  app.get("/libraries", async () => ({
    libraries: db.prepare("SELECT id, name, root_path AS rootPath, enabled, created_at AS createdAt FROM libraries ORDER BY created_at DESC").all()
  }));

  app.post("/libraries", { schema: { body: addLibrarySchema } }, async (request, reply) => {
    const body = request.body;
    const rootPath = body.rootPath ? resolve(body.rootPath) : null;
    if (!rootPath || !isPathAllowed(rootPath) || !existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
      return reply.code(400).send({ error: "Choose an existing directory" });
    }

    const id = createId("lib");
    const name = body.name?.trim() || basename(rootPath) || rootPath;
    const scanRunId = db.transaction(() => {
      db.prepare("INSERT INTO libraries (id, name, root_path, enabled, created_at) VALUES (?, ?, ?, 1, ?)")
        .run(id, name, rootPath, nowIso());
      return enqueueScan(id);
    })();

    return reply.code(201).send({ id, name, rootPath, scanRunId });
  });

  app.post("/scan/runs", { schema: { body: scanRunSchema } }, async (request, reply) => {
    const body = request.body;
    const scanRunId = enqueueScan(body.libraryId);
    return reply.code(202).send({ scanRunId, status: "queued" });
  });

  app.get("/scan/runs", async () => ({
    runs: db.prepare(`
      SELECT id, library_id AS libraryId, status, message, started_at AS startedAt, finished_at AS finishedAt,
        items_indexed AS itemsIndexed, thumbnails_total AS thumbnailsTotal,
        thumbnails_ready AS thumbnailsReady, thumbnails_failed AS thumbnailsFailed
      FROM scan_runs ORDER BY started_at DESC LIMIT 20
    `).all()
  }));

  app.get<{ Params: { id: string } }>("/scan/runs/:id", async (request, reply) => {
    const run = db.prepare(`
      SELECT id, library_id AS libraryId, status, message, started_at AS startedAt, finished_at AS finishedAt,
        items_indexed AS itemsIndexed, thumbnails_total AS thumbnailsTotal,
        thumbnails_ready AS thumbnailsReady, thumbnails_failed AS thumbnailsFailed
      FROM scan_runs WHERE id = ?
    `).get(request.params.id);
    return run ?? reply.code(404).send({ error: "Scan run not found" });
  });
}
