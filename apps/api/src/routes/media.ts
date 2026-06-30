import type { FastifyInstance } from "fastify";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname } from "node:path";
import { lookup } from "mime-types";
import { creators, mediaImages, mediaItems, mediaParts, mediaSubtitles } from "@hilihili/db";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../lib/db.js";
import { CACHE_DAY, CACHE_HOUR, CACHE_LONG } from "../lib/constants.js";

export async function mediaRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string; variant: string } }>("/media/images/:id/:variant", async (request, reply) => {
    if (request.params.variant !== "thumbnail" && request.params.variant !== "original") {
      return reply.code(404).send({ error: "Image variant not found" });
    }
    const row = db.select({
      path: mediaImages.path,
      thumbnailPath: mediaImages.thumbnailPath
    })
      .from(mediaImages)
      .where(eq(mediaImages.id, request.params.id))
      .get();
    const selected = request.params.variant === "thumbnail" && row?.thumbnailPath && existsSync(row.thumbnailPath)
      ? row.thumbnailPath
      : row?.path && existsSync(row.path) ? row.path : null;
    if (!selected) return reply.code(404).send({ error: "Image not found" });
    reply.header("Content-Type", lookup(selected) || "application/octet-stream");
    reply.header("Cache-Control", `public, max-age=${CACHE_LONG}`);
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.send(createReadStream(selected));
  });

  app.get<{ Params: { id: string } }>("/media/items/:id/cover", async (request, reply) => {
    const row = db.select({
      kind: mediaItems.kind,
      coverPath: mediaItems.coverPath,
      generatedCoverPath: mediaItems.generatedCoverPath
    })
      .from(mediaItems)
      .where(eq(mediaItems.id, request.params.id))
      .get();
    let coverPath: string | null = null;
    // For pure image galleries, serve the first image's (animated) thumbnail instead of the
    // original — much lighter on the feed and preserves animation for animated images.
    if (row?.kind === "image") {
      const img = db.select({ thumbnailPath: mediaImages.thumbnailPath, path: mediaImages.path })
        .from(mediaImages)
        .where(eq(mediaImages.itemId, request.params.id))
        .orderBy(asc(mediaImages.sortIndex))
        .limit(1)
        .get();
      if (img) {
        coverPath = img.thumbnailPath && existsSync(img.thumbnailPath) ? img.thumbnailPath : (existsSync(img.path) ? img.path : null);
      }
    }
    if (!coverPath) {
      coverPath = row?.coverPath && existsSync(row.coverPath)
        ? row.coverPath
        : row?.generatedCoverPath && existsSync(row.generatedCoverPath) ? row.generatedCoverPath : null;
    }
    if (!coverPath) {
      return reply.code(404).send({ error: "Cover not found" });
    }

    reply.header("Content-Type", lookup(coverPath) || "application/octet-stream");
    reply.header("Cache-Control", `public, max-age=${CACHE_DAY}`);
    return reply.send(createReadStream(coverPath));
  });

  app.get<{ Params: { id: string; variant: "avatar" | "banner" } }>("/media/creators/:id/:variant", async (request, reply) => {
    if (request.params.variant !== "avatar" && request.params.variant !== "banner") {
      return reply.code(404).send({ error: "Creator asset not found" });
    }
    const row = db.select({
      avatarPath: creators.avatarPath,
      bannerPath: creators.bannerPath
    })
      .from(creators)
      .where(eq(creators.id, request.params.id))
      .get();
    const assetPath = request.params.variant === "avatar" ? row?.avatarPath : row?.bannerPath;
    if (!assetPath || !existsSync(assetPath)) return reply.code(404).send({ error: "Creator asset not found" });
    reply.header("Content-Type", lookup(assetPath) || "application/octet-stream");
    reply.header("Cache-Control", `public, max-age=${CACHE_LONG}`);
    reply.header("X-Content-Type-Options", "nosniff");
    return reply.send(createReadStream(assetPath));
  });

  app.get<{ Params: { id: string } }>("/media/parts/:id/sprite", async (request, reply) => {
    const row = db.select({ previewSpritePath: mediaParts.previewSpritePath })
      .from(mediaParts)
      .where(eq(mediaParts.id, request.params.id))
      .get();
    const spritePath = row?.previewSpritePath && existsSync(row.previewSpritePath) ? row.previewSpritePath : null;
    if (!spritePath) {
      return reply.code(404).send({ error: "Preview sprite not found" });
    }
    reply.header("Content-Type", "image/webp");
    reply.header("Cache-Control", `public, max-age=${CACHE_LONG}`);
    return reply.send(createReadStream(spritePath));
  });

  app.get<{ Params: { id: string; subId: string } }>("/media/parts/:id/subtitles/:subId", async (request, reply) => {
    const row = db.select({ path: mediaSubtitles.path })
      .from(mediaSubtitles)
      .where(and(eq(mediaSubtitles.id, request.params.subId), eq(mediaSubtitles.partId, request.params.id)))
      .get();
    if (!row || !existsSync(row.path)) {
      return reply.code(404).send({ error: "Subtitle not found" });
    }
    const ext = extname(row.path).toLowerCase();
    const contentType = ext === ".vtt" ? "text/vtt" : ext === ".srt" ? "text/plain" : "application/octet-stream";
    reply.header("Content-Type", contentType);
    reply.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    reply.header("Pragma", "no-cache");
    reply.header("Expires", "0");
    return reply.send(createReadStream(row.path));
  });

  app.get<{ Params: { id: string }; Headers: { range?: string } }>("/media/parts/:id/stream", async (request, reply) => {
    const row = db.select({ path: mediaParts.path, streamPath: mediaParts.streamPath })
      .from(mediaParts)
      .where(eq(mediaParts.id, request.params.id))
      .get();
    if (!row || !existsSync(row.path)) {
      return reply.code(404).send({ error: "Media part not found" });
    }

    const mediaPath = row.streamPath && existsSync(row.streamPath) ? row.streamPath : row.path;
    const total = statSync(mediaPath).size;
    const range = request.headers.range;
    const contentType = lookup(extname(mediaPath)) || "application/octet-stream";

    reply.header("Accept-Ranges", "bytes");
    reply.header("Cache-Control", `public, max-age=${CACHE_HOUR}`);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Connection", "keep-alive");

    if (!range) {
      reply.header("Content-Length", total);
      reply.header("Content-Type", contentType);
      return reply.send(createReadStream(mediaPath));
    }

    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      reply.header("Content-Range", `bytes */${total}`);
      return reply.code(416).send();
    }

    const start = Number(match[1]);
    const end = Math.min(match[2] ? Number(match[2]) : total - 1, total - 1);
    if (start >= total || end < start) {
      reply.header("Content-Range", `bytes */${total}`);
      return reply.code(416).send();
    }
    const chunkSize = end - start + 1;

    reply.code(206);
    reply.header("Content-Range", `bytes ${start}-${end}/${total}`);
    reply.header("Content-Length", chunkSize);
    reply.header("Content-Type", contentType);
    return reply.send(createReadStream(mediaPath, { start, end }));
  });
}
