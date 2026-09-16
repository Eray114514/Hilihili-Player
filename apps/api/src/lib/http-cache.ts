import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";

/**
 * JSON 接口的缓存策略。
 *
 * 远程访问（异地组网、高 RTT）下，一次 304 比一次完整重传便宜得多，
 * 所以所有读接口都应该带 ETag 走条件请求。
 */
export type JsonCachePolicy = {
  /** 秒。0 表示每次都要回源校验（配合 ETag 得到 304）。 */
  maxAge?: number;
  /** stale-while-revalidate 秒数，让客户端先用手上的旧数据。 */
  swr?: number;
  /** 个性化数据（观看进度、收藏等）用 private，避免任何中间层缓存。 */
  isPrivate?: boolean;
};

// 目录型数据（分类列表等）：全局一致、只在扫描后变化，允许短暂共享缓存
export const CACHE_POLICY_CATALOG: JsonCachePolicy = { maxAge: 60, swr: 300 };
// 推荐流：随交互变化，属个性化数据，但短时间内稳定，给一段可复用的强缓存
export const CACHE_POLICY_FEED: JsonCachePolicy = { maxAge: 15, swr: 120, isPrivate: true };
// 个性化数据（观看进度、收藏、未读数）：不进任何缓存，只靠 ETag 省流量
export const CACHE_POLICY_PRIVATE: JsonCachePolicy = { maxAge: 0, isPrivate: true };

function quoteEtag(hash: string) {
  return `W/"${hash}"`;
}

/** 按 RFC 7232 比较 If-None-Match：支持 `*`、列表、弱比较。 */
function matchesIfNoneMatch(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const raw = Array.isArray(header) ? header.join(",") : header;
  const candidates = raw.split(",").map((value) => value.trim());
  if (candidates.includes("*")) return true;
  const bare = etag.replace(/^W\//, "");
  return candidates.some((candidate) => candidate.replace(/^W\//, "") === bare);
}

/**
 * 统一的 JSON 响应出口：计算 ETag、写缓存头、必要时直接回 304。
 *
 * 返回 string 时 Fastify 会把它当 body 发出去；返回 reply 表示响应已发送（304）。
 * 只对 GET/HEAD 做 304，其他方法正常返回完整响应。
 */
export function sendJson<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: T,
  policy: JsonCachePolicy = CACHE_POLICY_PRIVATE
): string | FastifyReply {
  const body = JSON.stringify(payload);
  const etag = quoteEtag(createHash("sha1").update(body).digest("base64url"));
  const scope = policy.isPrivate ? "private" : "public";
  reply.header("Cache-Control", [
    scope,
    `max-age=${policy.maxAge ?? 0}`,
    ...(policy.swr ? [`stale-while-revalidate=${policy.swr}`] : [])
  ].join(", "));
  reply.header("ETag", etag);
  // 响应体会按 Accept-Encoding 变化，必须声明，否则共享缓存会把压缩体发给不支持压缩的客户端
  reply.header("Vary", "Accept-Encoding");
  const method = request.method;
  if ((method === "GET" || method === "HEAD") && matchesIfNoneMatch(request.headers["if-none-match"], etag)) {
    return reply.code(304).send();
  }
  reply.header("Content-Type", "application/json; charset=utf-8");
  return body;
}

/**
 * 文件类响应的 ETag：用 size + mtime 推导，避免为了算哈希把整个文件读一遍。
 * 字幕等文本资产用它做条件请求。
 */
export function fileEtag(sizeBytes: number, modifiedMs: number): string {
  return quoteEtag(createHash("sha1").update(`${sizeBytes}:${modifiedMs}`).digest("base64url"));
}

/** 判断请求带来的 If-None-Match 是否命中给定 ETag（供文件类路由使用）。 */
export function isNotModified(request: FastifyRequest, etag: string): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  return matchesIfNoneMatch(request.headers["if-none-match"], etag);
}