import cors from "@fastify/cors";
import Fastify from "fastify";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, parse, resolve } from "node:path";
import { platform } from "node:os";
import { lookup } from "mime-types";
import { createId, getSqlite, nowIso } from "@hilihili/db";
import { scanEnabledLibraries, scanLibrary } from "@hilihili/media";
import { getRecommendedFeed } from "@hilihili/recommendation";
import type { DirectoryEntry, InteractionKind } from "@hilihili/shared";

type AddLibraryBody = {
  name?: string;
  rootPath?: string;
};

type InteractionBody = {
  kind?: InteractionKind;
  value?: number;
  positionSeconds?: number;
  partId?: string;
};

type CommentBody = {
  body?: string;
  atSeconds?: number | null;
};

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const db = getSqlite();

app.get("/health", async () => ({
  ok: true,
  name: "Hilihili API",
  now: nowIso()
}));

app.get("/fs/roots", async () => ({
  roots: getBrowsableRoots()
}));

app.get<{ Querystring: { path?: string } }>("/fs/list", async (request, reply) => {
  const targetPath = request.query.path ? resolve(request.query.path) : getBrowsableRoots()[0]?.path;
  if (!targetPath || !existsSync(targetPath)) {
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

  return { path: targetPath, parent: parse(targetPath).root === targetPath ? null : resolve(targetPath, ".."), entries };
});

app.get("/libraries", async () => ({
  libraries: db.prepare("SELECT id, name, root_path AS rootPath, enabled, created_at AS createdAt FROM libraries ORDER BY created_at DESC").all()
}));

app.post<{ Body: AddLibraryBody }>("/libraries", async (request, reply) => {
  const rootPath = request.body.rootPath ? resolve(request.body.rootPath) : null;
  if (!rootPath || !existsSync(rootPath) || !statSync(rootPath).isDirectory()) {
    return reply.code(400).send({ error: "Choose an existing directory" });
  }

  const id = createId("lib");
  const name = request.body.name?.trim() || basename(rootPath) || rootPath;
  db.prepare("INSERT INTO libraries (id, name, root_path, enabled, created_at) VALUES (?, ?, ?, 1, ?)")
    .run(id, name, rootPath, nowIso());

  return reply.code(201).send({ id, name, rootPath });
});

app.post<{ Body: { libraryId?: string } }>("/scan/runs", async (request, reply) => {
  try {
    const itemsIndexed = request.body.libraryId
      ? await scanLibrary(request.body.libraryId)
      : await scanEnabledLibraries();
    return { status: "complete", itemsIndexed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(500).send({ error: message });
  }
});

app.get("/scan/runs", async () => ({
  runs: db.prepare("SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 20").all()
}));

app.get<{ Querystring: { seed?: string; limit?: string } }>("/feeds/home", async (request) => ({
  items: getRecommendedFeed({
    seed: request.query.seed ?? String(Date.now()),
    limit: Number(request.query.limit ?? 30),
    mode: "recommended"
  })
}));

app.get<{ Querystring: { seed?: string; limit?: string } }>("/feeds/dynamic", async (request) => ({
  items: getRecommendedFeed({
    seed: request.query.seed ?? "dynamic",
    limit: Number(request.query.limit ?? 36),
    includeImages: true,
    includeFinished: true,
    mode: "latest"
  })
}));

app.get<{ Params: { id: string }; Querystring: { seed?: string } }>("/feeds/category/:id", async (request) => ({
  items: getRecommendedFeed({
    categoryId: request.params.id,
    seed: request.query.seed ?? request.params.id,
    includeImages: false,
    limit: 48
  })
}));

app.get<{ Params: { id: string }; Querystring: { seed?: string } }>("/feeds/creator/:id", async (request) => ({
  items: getRecommendedFeed({
    creatorId: request.params.id,
    seed: request.query.seed ?? request.params.id,
    includeImages: false,
    limit: 48
  })
}));

app.get("/categories", async () => ({
  categories: db.prepare(`
    SELECT c.id, c.name, COUNT(mi.id) AS itemCount
    FROM categories c
    LEFT JOIN media_items mi ON mi.category_id = c.id
    GROUP BY c.id
    ORDER BY itemCount DESC, c.name ASC
  `).all()
}));

app.get("/creators", async () => ({
  creators: db.prepare(`
    SELECT cr.id, cr.name, c.name AS categoryName, COUNT(mi.id) AS itemCount
    FROM creators cr
    LEFT JOIN categories c ON c.id = cr.category_id
    LEFT JOIN media_items mi ON mi.creator_id = cr.id
    GROUP BY cr.id
    ORDER BY itemCount DESC, cr.name ASC
  `).all()
}));

app.get<{ Params: { id: string } }>("/items/:id", async (request, reply) => {
  const item = db.prepare(`
    SELECT mi.*, c.name AS categoryName, cr.name AS creatorName
    FROM media_items mi
    LEFT JOIN categories c ON c.id = mi.category_id
    LEFT JOIN creators cr ON cr.id = mi.creator_id
    WHERE mi.id = ?
  `).get(request.params.id);
  if (!item) {
    return reply.code(404).send({ error: "Item not found" });
  }

  const parts = db.prepare("SELECT id, title, part_index AS partIndex, size_bytes AS sizeBytes FROM media_parts WHERE item_id = ? ORDER BY part_index ASC")
    .all(request.params.id);
  const comments = db.prepare("SELECT id, body, at_seconds AS atSeconds, created_at AS createdAt FROM comments WHERE item_id = ? ORDER BY created_at DESC")
    .all(request.params.id);
  const related = getRecommendedFeed({ limit: 12, seed: request.params.id, includeFinished: false });

  return { item, parts, comments, related };
});

app.get<{ Params: { id: string } }>("/media/items/:id/cover", async (request, reply) => {
  const row = db.prepare("SELECT cover_path FROM media_items WHERE id = ?").get(request.params.id) as { cover_path: string | null } | undefined;
  if (!row?.cover_path || !existsSync(row.cover_path)) {
    return reply.code(404).send({ error: "Cover not found" });
  }

  reply.header("Content-Type", lookup(row.cover_path) || "application/octet-stream");
  return reply.send(createReadStream(row.cover_path));
});

app.get<{ Params: { id: string }; Headers: { range?: string } }>("/media/parts/:id/stream", async (request, reply) => {
  const row = db.prepare("SELECT path, size_bytes FROM media_parts WHERE id = ?").get(request.params.id) as { path: string; size_bytes: number } | undefined;
  if (!row || !existsSync(row.path)) {
    return reply.code(404).send({ error: "Media part not found" });
  }

  const total = row.size_bytes;
  const range = request.headers.range;
  const contentType = lookup(extname(row.path)) || "application/octet-stream";

  if (!range) {
    reply.header("Content-Length", total);
    reply.header("Content-Type", contentType);
    reply.header("Accept-Ranges", "bytes");
    return reply.send(createReadStream(row.path));
  }

  const match = range.match(/bytes=(\d+)-(\d*)/);
  if (!match) {
    return reply.code(416).send();
  }

  const start = Number(match[1]);
  const end = Math.min(match[2] ? Number(match[2]) : total - 1, total - 1);
  if (start >= total || end < start) {
    return reply.code(416).send();
  }
  const chunkSize = end - start + 1;

  reply.code(206);
  reply.header("Content-Range", `bytes ${start}-${end}/${total}`);
  reply.header("Accept-Ranges", "bytes");
  reply.header("Content-Length", chunkSize);
  reply.header("Content-Type", contentType);
  return reply.send(createReadStream(row.path, { start, end }));
});

app.post<{ Params: { id: string }; Body: InteractionBody }>("/items/:id/interactions", async (request, reply) => {
  const item = db.prepare("SELECT id, creator_id, category_id FROM media_items WHERE id = ?").get(request.params.id) as
    | { id: string; creator_id: string | null; category_id: string | null }
    | undefined;
  if (!item || !request.body.kind) {
    return reply.code(400).send({ error: "Invalid interaction" });
  }

  const value = request.body.value ?? 1;
  if (request.body.kind === "finish" || request.body.kind === "watch") {
    db.prepare(`
      INSERT INTO watch_progress (item_id, part_id, position_seconds, finished, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        part_id = excluded.part_id,
        position_seconds = excluded.position_seconds,
        finished = MAX(watch_progress.finished, excluded.finished),
        updated_at = excluded.updated_at
    `).run(request.params.id, request.body.partId ?? null, request.body.positionSeconds ?? 0, request.body.kind === "finish" ? 1 : 0, nowIso());
  }

  if (request.body.kind === "blacklist_up" && item.creator_id) {
    db.prepare("INSERT INTO interactions (id, target_type, target_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(createId("int"), "creator", item.creator_id, "blacklist_up", value, nowIso());
  } else {
    db.prepare("INSERT INTO interactions (id, target_type, target_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(createId("int"), "item", request.params.id, request.body.kind, value, nowIso());
    if ((request.body.kind === "like" || request.body.kind === "dislike") && item.creator_id) {
      db.prepare("INSERT INTO interactions (id, target_type, target_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(createId("int"), "creator", item.creator_id, request.body.kind, value, nowIso());
    }
    if ((request.body.kind === "like" || request.body.kind === "dislike") && item.category_id) {
      db.prepare("INSERT INTO interactions (id, target_type, target_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(createId("int"), "category", item.category_id, request.body.kind, value, nowIso());
    }
  }

  return { ok: true };
});

app.post<{ Params: { id: string }; Body: CommentBody }>("/items/:id/comments", async (request, reply) => {
  const body = request.body.body?.trim();
  if (!body) {
    return reply.code(400).send({ error: "Comment cannot be empty" });
  }
  const id = createId("comment");
  db.prepare("INSERT INTO comments (id, item_id, body, at_seconds, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, request.params.id, body, request.body.atSeconds ?? null, nowIso());
  return reply.code(201).send({ id });
});

app.delete<{ Params: { id: string } }>("/items/:id/watch-progress", async (request) => {
  db.prepare("DELETE FROM watch_progress WHERE item_id = ?").run(request.params.id);
  return { ok: true };
});

const host = process.env.HILI_API_HOST ?? "0.0.0.0";
const port = Number(process.env.HILI_API_PORT ?? 4141);

await app.listen({ host, port });

function getBrowsableRoots(): DirectoryEntry[] {
  if (platform() === "win32") {
    const roots: DirectoryEntry[] = [];
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (existsSync(drive)) {
        roots.push({ name: drive, path: drive, isDirectory: true });
      }
    }
    return roots;
  }

  return ["/", "/mnt", "/media", "/volume1"]
    .filter((path) => existsSync(path))
    .map((path) => ({ name: path, path, isDirectory: true }));
}
