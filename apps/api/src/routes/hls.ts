import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { mediaParts, transcodeTasks } from "@hilihili/db";
import { enqueueTranscode, markPartPlayed } from "@hilihili/media";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db.js";
import { CACHE_LONG } from "../lib/constants.js";
import { CACHE_POLICY_PRIVATE, fileEtag, isNotModified, sendJson } from "../lib/http-cache.js";
import { sendFileStream, statFile } from "../lib/media-assets.js";

const PLAYLIST_CONTENT_TYPE = "application/vnd.apple.mpegurl";
const SEGMENT_CONTENT_TYPE = "video/mp2t";
const PROFILE_PATTERN = /^[a-z0-9_-]{1,32}$/;
// ffmpeg 用 -hls_segment_filename seg_%05d.ts 生成，名字完全可控
const SEGMENT_PATTERN = /^seg_\d{5}\.ts$/;

type LadderEntry = { name: string; height: number; width: number; videoBitrateKbps: number; copy: boolean };

function parseLadder(raw: string | null): LadderEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LadderEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadPart(partId: string) {
  return db.select({
    id: mediaParts.id,
    fingerprint: mediaParts.fingerprint,
    hlsPath: mediaParts.hlsPath,
    hlsFingerprint: mediaParts.hlsFingerprint,
    hlsStatus: mediaParts.hlsStatus,
    hlsError: mediaParts.hlsError,
    hlsLadder: mediaParts.hlsLadder
  })
    .from(mediaParts)
    .where(eq(mediaParts.id, partId))
    .get();
}

/** 只有「就绪 且 指纹与源一致」的产物才可用；源被替换后旧切片必须作废。 */
function isHlsUsable(row: ReturnType<typeof loadPart>) {
  return Boolean(row && row.hlsPath && row.hlsFingerprint && row.hlsStatus === "ready" && row.hlsFingerprint === row.fingerprint);
}

/**
 * 把播放列表里的相对 URI 改写成「绝对路径 + 版本号」。
 *
 * 这样做有两个好处：
 *  - 分片带上 ?v=<指纹>，可以放心用 immutable 长缓存，重复观看不再回源；
 *  - 避免播放器按相对路径解析时丢掉查询串，导致分片退回成每次都发条件请求。
 */
function rewritePlaylist(content: string, basePath: string, version: string) {
  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      return `${basePath}${trimmed}?v=${version}`;
    })
    .join("\n");
}

/**
 * 校验分片/播放列表路径确实落在该分P 的产物目录内。
 * 这是防目录穿越的权威手段——只靠正则挡不住各种编码花样。
 */
function resolveInside(baseDir: string, ...segments: string[]) {
  const target = resolve(join(baseDir, ...segments));
  const root = resolve(baseDir);
  return target === root || target.startsWith(root + sep) ? target : null;
}

export async function hlsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string }; Querystring: { v?: string } }>("/media/parts/:id/hls/master.m3u8", async (request, reply) => {
    const row = loadPart(request.params.id);
    if (!isHlsUsable(row) || !row?.hlsPath || !row.hlsFingerprint) {
      return reply.code(404).send({ error: "HLS not ready" });
    }
    const file = resolveInside(row.hlsPath, "master.m3u8");
    const fileStat = file ? await statFile(file) : null;
    if (!file || !fileStat) {
      return reply.code(404).send({ error: "HLS not ready" });
    }
    // master 会随着新档位完成而变化，所以始终走条件请求
    const etag = fileEtag(fileStat.size, Math.round(fileStat.modifiedMs));
    reply.header("Content-Type", PLAYLIST_CONTENT_TYPE);
    reply.header("Cache-Control", "no-cache");
    reply.header("ETag", etag);
    if (isNotModified(request, etag)) {
      return reply.code(304).send();
    }
    const content = rewritePlaylist(
      await readFile(file, "utf8"),
      `/media/parts/${request.params.id}/hls/`,
      row.hlsFingerprint
    );
    return reply.send(content);
  });

  app.get<{ Params: { id: string; profile: string }; Querystring: { v?: string } }>("/media/parts/:id/hls/:profile/index.m3u8", async (request, reply) => {
    const row = loadPart(request.params.id);
    if (!isHlsUsable(row) || !row?.hlsPath || !row.hlsFingerprint) {
      return reply.code(404).send({ error: "HLS not ready" });
    }
    const { profile } = request.params;
    // 档位必须在该分P 实际生成的清单里，避免用任意目录名探测文件系统
    if (!PROFILE_PATTERN.test(profile) || !parseLadder(row.hlsLadder).some((entry) => entry.name === profile)) {
      return reply.code(404).send({ error: "HLS profile not found" });
    }
    const file = resolveInside(row.hlsPath, profile, "index.m3u8");
    const fileStat = file ? await statFile(file) : null;
    if (!file || !fileStat) {
      return reply.code(404).send({ error: "HLS profile not ready" });
    }
    const versioned = request.query.v === row.hlsFingerprint;
    const etag = fileEtag(fileStat.size, Math.round(fileStat.modifiedMs));
    reply.header("Content-Type", PLAYLIST_CONTENT_TYPE);
    reply.header("Cache-Control", versioned ? `public, max-age=${CACHE_LONG}, immutable` : "no-cache");
    reply.header("ETag", etag);
    if (!versioned && isNotModified(request, etag)) {
      return reply.code(304).send();
    }
    const content = rewritePlaylist(
      await readFile(file, "utf8"),
      `/media/parts/${request.params.id}/hls/${profile}/`,
      row.hlsFingerprint
    );
    return reply.send(content);
  });

  app.get<{ Params: { id: string; profile: string; segment: string }; Querystring: { v?: string } }>("/media/parts/:id/hls/:profile/:segment", async (request, reply) => {
    const row = loadPart(request.params.id);
    if (!isHlsUsable(row) || !row?.hlsPath || !row.hlsFingerprint) {
      return reply.code(404).send({ error: "HLS not ready" });
    }
    const { profile, segment } = request.params;
    if (!PROFILE_PATTERN.test(profile) || !SEGMENT_PATTERN.test(segment)) {
      return reply.code(404).send({ error: "HLS segment not found" });
    }
    const file = resolveInside(row.hlsPath, profile, segment);
    const fileStat = file ? await statFile(file) : null;
    if (!file || !fileStat) {
      return reply.code(404).send({ error: "HLS segment not found" });
    }
    reply.header("Content-Type", SEGMENT_CONTENT_TYPE);
    // 分片内容由指纹决定，带上版本号即可长期缓存
    reply.header("Cache-Control", request.query.v === row.hlsFingerprint
      ? `public, max-age=${CACHE_LONG}, immutable`
      : "no-cache");
    return sendFileStream(reply, file);
  });

  app.get<{ Params: { id: string } }>("/media/parts/:id/hls/status", async (request, reply) => {
    const row = loadPart(request.params.id);
    if (!row) {
      return reply.code(404).send({ error: "Media part not found" });
    }
    const task = db.select({
      status: transcodeTasks.status,
      progress: transcodeTasks.progress,
      encoder: transcodeTasks.encoder,
      error: transcodeTasks.error
    })
      .from(transcodeTasks)
      .where(and(eq(transcodeTasks.partId, request.params.id), eq(transcodeTasks.profile, "main")))
      .get();
    const usable = isHlsUsable(row);
    // 源文件换过 → 旧产物作废，标成 stale 让前端知道要等重建
    const stale = Boolean(row.hlsFingerprint && row.hlsFingerprint !== row.fingerprint);
    return sendJson(request, reply, {
      status: usable ? "ready" : stale ? "stale" : row.hlsStatus,
      playable: usable,
      progress: usable ? 1 : task?.progress ?? 0,
      encoder: task?.encoder ?? null,
      error: row.hlsError ?? task?.error ?? null,
      ladder: parseLadder(row.hlsLadder).map((entry) => ({
        name: entry.name,
        height: entry.height,
        width: entry.width,
        bitrateKbps: entry.videoBitrateKbps,
        copy: entry.copy
      })),
      fallbackUrl: `/media/parts/${request.params.id}/stream`
    }, CACHE_POLICY_PRIVATE);
  });

  // 点播时调用：没准备好就按最高优先级入队。幂等，重复调用不会重复排队。
  app.post<{ Params: { id: string }; Querystring: { profile?: string } }>("/media/parts/:id/hls/prepare", async (request, reply) => {
    const row = loadPart(request.params.id);
    if (!row) {
      return reply.code(404).send({ error: "Media part not found" });
    }
    markPartPlayed(request.params.id);
    if (isHlsUsable(row)) {
      return sendJson(request, reply, { queued: false, status: "ready" });
    }
    const profile = request.query.profile === "saving" ? "saving" : "main";
    enqueueTranscode(request.params.id, profile, 100);
    return sendJson(request, reply, { queued: true, status: "queued" });
  });
}