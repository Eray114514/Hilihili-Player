import { basename, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { createId, libraries, nowIso, scanRuns } from "@hilihili/db";
import { enqueueScan } from "@hilihili/media";
import { desc, eq } from "drizzle-orm";
import { db } from "../lib/db.js";
import { isPathAllowed } from "../lib/fs-roots.js";
import { addLibrarySchema, scanRunSchema, type ZodFastifyInstance } from "../lib/types.js";

export async function libraryRoutes(app: ZodFastifyInstance) {
  app.get("/libraries", async () => ({
    // enabled 字段在 schema 中是 boolean mode，JSON 序列化为 true/false（原裸 SQL 返回 0/1）
    libraries: db.select({
      id: libraries.id,
      name: libraries.name,
      rootPath: libraries.rootPath,
      enabled: libraries.enabled,
      createdAt: libraries.createdAt
    })
      .from(libraries)
      .orderBy(desc(libraries.createdAt))
      .all()
  }));

  app.post("/libraries", { schema: { body: addLibrarySchema } }, async (request, reply) => {
    const body = request.body;
    const rootPath = body.rootPath ? resolve(body.rootPath) : null;
    if (!rootPath || !isPathAllowed(rootPath) || !existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
      return reply.code(400).send({ error: "Choose an existing directory" });
    }

    const id = createId("lib");
    const name = body.name?.trim() || basename(rootPath) || rootPath;
    // Drizzle transaction 直接返回回调返回值；enqueueScan 内部用同一个 better-sqlite3 连接，能在事务内看到 INSERT 的效果
    const scanRunId = db.transaction(() => {
      db.insert(libraries).values({
        id,
        name,
        rootPath,
        enabled: true,
        createdAt: nowIso()
      }).run();
      return enqueueScan(id);
    });

    return reply.code(201).send({ id, name, rootPath, scanRunId });
  });

  app.post("/scan/runs", { schema: { body: scanRunSchema } }, async (request, reply) => {
    const body = request.body;
    const scanRunId = enqueueScan(body.libraryId);
    return reply.code(202).send({ scanRunId, status: "queued" });
  });

  app.get("/scan/runs", async () => ({
    runs: db.select({
      id: scanRuns.id,
      libraryId: scanRuns.libraryId,
      status: scanRuns.status,
      message: scanRuns.message,
      startedAt: scanRuns.startedAt,
      finishedAt: scanRuns.finishedAt,
      itemsIndexed: scanRuns.itemsIndexed,
      thumbnailsTotal: scanRuns.thumbnailsTotal,
      thumbnailsReady: scanRuns.thumbnailsReady,
      thumbnailsFailed: scanRuns.thumbnailsFailed
    })
      .from(scanRuns)
      .orderBy(desc(scanRuns.startedAt))
      .limit(20)
      .all()
  }));

  app.get<{ Params: { id: string } }>("/scan/runs/:id", async (request, reply) => {
    const run = db.select({
      id: scanRuns.id,
      libraryId: scanRuns.libraryId,
      status: scanRuns.status,
      message: scanRuns.message,
      startedAt: scanRuns.startedAt,
      finishedAt: scanRuns.finishedAt,
      itemsIndexed: scanRuns.itemsIndexed,
      thumbnailsTotal: scanRuns.thumbnailsTotal,
      thumbnailsReady: scanRuns.thumbnailsReady,
      thumbnailsFailed: scanRuns.thumbnailsFailed
    })
      .from(scanRuns)
      .where(eq(scanRuns.id, request.params.id))
      .get();
    return run ?? reply.code(404).send({ error: "Scan run not found" });
  });
}
