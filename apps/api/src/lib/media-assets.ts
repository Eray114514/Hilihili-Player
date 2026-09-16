import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyReply } from "fastify";

export type FileStat = { size: number; modifiedMs: number };

/**
 * 异步取文件信息；不存在或不是普通文件返回 null。
 *
 * 替代原先各处同步的 existsSync + statSync：那些调用会阻塞事件循环，
 * 而媒体库常挂在网络盘上，同步 stat 的延迟直接拖慢整个 API 的并发响应。
 */
export async function statFile(target: string | null | undefined): Promise<FileStat | null> {
  if (!target) return null;
  try {
    const info = await stat(target);
    return info.isFile() ? { size: info.size, modifiedMs: info.mtimeMs } : null;
  } catch {
    return null;
  }
}

/**
 * 由若干稳定输入派生缓存键（creator 资产没有 fingerprint 列，用 path+size+mtime 派生）。
 * 截断到 20 位十六进制，足够避免碰撞又不会让缓存文件名过长。
 */
export function stableCacheKey(...parts: (string | number)[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 20);
}

/** 解析 `?w=` 图片变体宽度；非法或缺省返回 null，表示按原样发源文件。 */
export function parseVariantWidth(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 流式发送文件，并接管错误。
 *
 * 原先各处的 createReadStream 都没有 error 监听：文件在传输中途被删除或权限变化时，
 * 流会 emit error 而无人处理，请求就那样挂到超时。这里统一销毁连接让客户端立刻失败。
 */
export function sendFileStream(reply: FastifyReply, target: string, range?: { start: number; end: number }) {
  const stream = range ? createReadStream(target, { start: range.start, end: range.end }) : createReadStream(target);
  stream.on("error", (error) => {
    reply.log.error({ err: error, target }, "media stream failed");
    // 响应头可能已经发出，改不了状态码；销毁 socket 让客户端立即感知失败而不是空等
    reply.raw.destroy();
  });
  return reply.send(stream);
}