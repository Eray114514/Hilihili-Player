import type { FastifyInstance } from "fastify";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DirectoryEntry } from "@hilihili/shared";
import { getBrowsableRoots, isPathAllowed } from "../lib/fs-roots.js";

export async function fsRoutes(app: FastifyInstance) {
  app.get("/fs/roots", async () => ({
    roots: getBrowsableRoots()
  }));

  app.get<{ Querystring: { path?: string } }>("/fs/list", async (request, reply) => {
    const targetPath = request.query.path ? resolve(request.query.path) : getBrowsableRoots()[0]?.path;
    if (!targetPath || !isPathAllowed(targetPath) || !existsSync(targetPath)) {
      return reply.code(404).send({ error: "Path not found" });
    }

    const stat = statSync(targetPath);
    if (!stat.isDirectory()) {
      return reply.code(400).send({ error: "Path is not a directory" });
    }

    const entries: DirectoryEntry[] = readdirSync(targetPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: join(targetPath, entry.name),
        isDirectory: true
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parentCandidate = resolve(targetPath, "..");
    return { path: targetPath, parent: isPathAllowed(parentCandidate) ? parentCandidate : null, entries };
  });
}
