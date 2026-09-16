import type { FastifyInstance } from "fastify";
import { extname } from "node:path";
import { lookup } from "mime-types";
import { creators, mediaImages, mediaItems, mediaParts, mediaSubtitles } from "@hilihili/db";
import { getImageVariant } from "@hilihili/media";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../lib/db.js";
import { CACHE_DAY, CACHE_HOUR, CACHE_LONG } from "../lib/constants.js";
import { fileEtag, isNotModified } from "../lib/http-cache.js";
import { parseVariantWidth, sendFileStream, stableCacheKey, statFile } from "../lib/media-assets.js";

/**
 * 图片资产的统一出口。
 *
 * 支持 `?w=<px>` 按需出指定宽度的 webp 变体（宽档由 packages/media 的
 * IMAGE_VARIANT_WIDTHS 吸附），供前端 srcset 使用——远程访问时这是最大的一笔字节节省：
 * 原来 250px 的卡片槽位也要下载 640px 的图、56px 的头像槽位直接拉原图。
 * 不带 `w` 时行为与改造前一致，老客户端不受影响。
 */
export async function mediaRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string; variant: string }; Querystring: { w?: string } }>("/media/images/:id/:variant", async (request, reply) => {
    if (request.params.variant !== "thumbnail" && request.params.variant !== "original") {
      return reply.code(404).send({ error: "Image variant not found" });
    }
    const row = db.select({
      path: mediaImages.path,
      thumbnailPath: mediaImages.thumbnailPath,
      fingerprint: mediaImages.fingerprint,
      isAnimated: mediaImages.isAnimated
    })
      .from(mediaImages)
      .where(eq(mediaImages.id, request.params.id))
      .get();

    // 缩略图缺失/文件丢失时回退到原图（保持既有兜底语义）
    const preferred = request.params.variant === "thumbnail" && row?.thumbnailPath ? row.thumbnailPath : row?.path ?? null;
    let selected = preferred;
    let fileStat = await statFile(selected);
    if (!fileStat && selected !== row?.path) {
      selected = row?.path ?? null;
      fileStat = await statFile(selected);
    }
    if (!selected || !fileStat || !row) {
      return reply.code(404).send({ error: "Image not found" });
    }

    const width = parseVariantWidth(request.query.w);
    if (width) {
      const variantPath = await getImageVariant(selected, row.fingerprint, width, row.isAnimated === true);
      if (await statFile(variantPath)) {
        reply.header("Content-Type", "image/webp");
        reply.header("Cache-Control", `public, max-age=${CACHE_LONG}`);
        reply.header("X-Content-Type-Options", "nosniff");
        return sendFileStream(reply, variantPath);
      }
    }

    reply.header("Content-Type", lookup(selected) || "application/octet-stream");
    reply.header("Cache-Control", `public, max-age=${CACHE_LONG}`);
    reply.header("X-Content-Type-Options", "nosniff");
    return sendFileStream(reply, selected);
  });

  app.get<{ Params: { id: string }; Querystring: { w?: string } }>("/media/items/:id/cover", async (request, reply) => {
    const row = db.select({
      kind: mediaItems.kind,
      coverPath: mediaItems.coverPath,
      generatedCoverPath: mediaItems.generatedCoverPath,
      fingerprint: mediaItems.fingerprint
    })
      .from(mediaItems)
      .where(eq(mediaItems.id, request.params.id))
      .get();
    if (!row) {
      return reply.code(404).send({ error: "Cover not found" });
    }

    let source: string | null = null;
    let isAnimated = false;
    // 纯图片集：用首图的（动图）缩略图而不是原图——体积小得多，且保留动图语义
    if (row.kind === "image") {
      const img = db.select({
        thumbnailPath: mediaImages.thumbnailPath,
        path: mediaImages.path,
        isAnimated: mediaImages.isAnimated
      })
        .from(mediaImages)
        .where(eq(mediaImages.itemId, request.params.id))
        .orderBy(asc(mediaImages.sortIndex))
        .limit(1)
        .get();
      if (img) {
        source = (await statFile(img.thumbnailPath)) ? img.thumbnailPath : img.path;
        isAnimated = img.isAnimated === true;
      }
    }
    if (!source) {
      // 注意：item 自带的 cover.jpg 可能是数 MB 的原图，所以一律先看生成封面；
      // 只有在没有生成封面时才退回原图，且原图路径同样会被下面的变体处理裁剪尺寸。
      source = (await statFile(row.generatedCoverPath)) ? row.generatedCoverPath : row.coverPath;
    }
    const fileStat = await statFile(source);
    if (!source || !fileStat) {
      return reply.code(404).send({ error: "Cover not found" });
    }

    const width = parseVariantWidth(request.query.w);
    if (width) {
      const variantPath = await getImageVariant(source, row.fingerprint, width, isAnimated);
      if (await statFile(variantPath)) {
        reply.header("Content-Type", "image/webp");
        reply.header("Cache-Control", `public, max-age=${CACHE_DAY}`);
        return sendFileStream(reply, variantPath);
      }
    }

    reply.header("Content-Type", lookup(source) || "application/octet-stream");
    reply.header("Cache-Control", `public, max-age=${CACHE_DAY}`);
    return sendFileStream(reply, source);
  });

  app.get<{ Params: { id: string; variant: "avatar" | "banner" }; Querystring: { w?: string } }>("/media/creators/:id/:variant", async (request, reply) => {
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
    const fileStat = await statFile(assetPath);
    if (!assetPath || !fileStat) {
      return reply.code(404).send({ error: "Creator asset not found" });
    }

    const width = parseVariantWidth(request.query.w);
    if (width) {
      // creators 表没有 fingerprint 列，用 path+size+mtime 派生缓存键
      const cacheKey = stableCacheKey(assetPath, fileStat.size, Math.round(fileStat.modifiedMs));
      const variantPath = await getImageVariant(assetPath, cacheKey, width);
      if (await statFile(variantPath)) {
        reply.header("Content-Type", "image/webp");
        reply.header("Cache-Control", `public, max-age=${CACHE_DAY}`);
        reply.header("X-Content-Type-Options", "nosniff");
        return sendFileStream(reply, variantPath);
      }
    }

    reply.header("Content-Type", lookup(assetPath) || "application/octet-stream");
    reply.header("Cache-Control", `public, max-age=${CACHE_LONG}`);
    reply.header("X-Content-Type-Options", "nosniff");
    return sendFileStream(reply, assetPath);
  });

  app.get<{ Params: { id: string } }>("/media/parts/:id/sprite", async (request, reply) => {
    const row = db.select({ previewSpritePath: mediaParts.previewSpritePath })
      .from(mediaParts)
      .where(eq(mediaParts.id, request.params.id))
      .get();
    const spritePath = row?.previewSpritePath ?? null;
    if (!spritePath || !(await statFile(spritePath))) {
      return reply.code(404).send({ error: "Preview sprite not found" });
    }
    reply.header("Content-Type", "image/webp");
    reply.header("Cache-Control", `public, max-age=${CACHE_LONG}`);
    return sendFileStream(reply, spritePath);
  });

  app.get<{ Params: { id: string; subId: string } }>("/media/parts/:id/subtitles/:subId", async (request, reply) => {
    const row = db.select({ path: mediaSubtitles.path })
      .from(mediaSubtitles)
      .where(and(eq(mediaSubtitles.id, request.params.subId), eq(mediaSubtitles.partId, request.params.id)))
      .get();
    const fileStat = await statFile(row?.path);
    if (!row || !fileStat) {
      return reply.code(404).send({ error: "Subtitle not found" });
    }
    // 原先是 no-store，逼着客户端每次（含播放器每 60s 的重拉）都整份重下。
    // 字幕是内容不变的小文本资产，用 ETag 做条件请求即可，命中时只回 304。
    const etag = fileEtag(fileStat.size, Math.round(fileStat.modifiedMs));
    reply.header("Cache-Control", `public, max-age=${CACHE_LONG}`);
    reply.header("ETag", etag);
    if (isNotModified(request, etag)) {
      return reply.code(304).send();
    }
    const ext = extname(row.path).toLowerCase();
    reply.header("Content-Type", ext === ".vtt" ? "text/vtt; charset=utf-8" : ext === ".srt" ? "text/plain; charset=utf-8" : "application/octet-stream");
    return sendFileStream(reply, row.path);
  });

  // compress: false —— Range 响应必须按原字节发出，任何重新编码都会破坏 seek 与 Content-Length
  app.get<{ Params: { id: string }; Headers: { range?: string } }>("/media/parts/:id/stream", { compress: false }, async (request, reply) => {
    const row = db.select({ path: mediaParts.path, streamPath: mediaParts.streamPath })
      .from(mediaParts)
      .where(eq(mediaParts.id, request.params.id))
      .get();
    const originalStat = await statFile(row?.path);
    if (!row || !originalStat) {
      return reply.code(404).send({ error: "Media part not found" });
    }

    // 优先发兼容流（remux/转码产物），物理文件缺失时回退原片
    let mediaPath = row.path;
    let total = originalStat.size;
    const streamStat = await statFile(row.streamPath);
    if (row.streamPath && streamStat) {
      mediaPath = row.streamPath;
      total = streamStat.size;
    }
    const contentType = lookup(extname(mediaPath)) || "application/octet-stream";

    reply.header("Accept-Ranges", "bytes");
    reply.header("Cache-Control", `public, max-age=${CACHE_HOUR}`);
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Connection", "keep-alive");

    const range = request.headers.range;
    if (!range) {
      reply.header("Content-Length", total);
      reply.header("Content-Type", contentType);
      return sendFileStream(reply, mediaPath);
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
    return sendFileStream(reply, mediaPath, { start, end });
  });
}