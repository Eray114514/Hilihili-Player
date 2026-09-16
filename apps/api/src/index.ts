import compress from "@fastify/compress";
import cors from "@fastify/cors";
import { validatorCompiler, ZodTypeProvider } from "@fastify/type-provider-zod";
import Fastify from "fastify";
import { isIP } from "node:net";
import { healthRoutes } from "./routes/health.js";
import { fsRoutes } from "./routes/fs.js";
import { libraryRoutes } from "./routes/library.js";
import { feedRoutes } from "./routes/feed.js";
import { searchRoutes } from "./routes/search.js";
import { categoryRoutes } from "./routes/category.js";
import { creatorRoutes } from "./routes/creator.js";
import { itemRoutes } from "./routes/item.js";
import { mediaRoutes } from "./routes/media.js";
import { hlsRoutes } from "./routes/hls.js";
import { meRoutes } from "./routes/me.js";

/**
 * 允许的跨域来源。
 *
 * 原来用 `origin: true` 反射任意 Origin，等效于完全放开跨域读。
 * 这个部署只服务私有网络（局域网 / 异地组网），所以只放行：
 *   - 回环与私有网段（含 Tailscale/ZeroTier 常用的 CGNAT 100.64.0.0/10）
 *   - 显式配置的 HILI_ALLOWED_ORIGINS
 * 公网域名一律不放行，避免浏览器侧被任意站点读取数据。
 */
function isPrivateOriginHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost") return true;
  const version = isIP(host);
  if (version === 0) return false;
  if (version === 6) {
    // ::1 / fc00::/7（ULA）/ fe80::/10（链路本地）
    return host === "::1" || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host);
  }
  const [a, b] = host.split(".").map(Number);
  return a === 0 || a === 127 || a === 10
    || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 100 && b >= 64 && b <= 127);
}

function extraAllowedOrigins() {
  return (process.env.HILI_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const app = Fastify({
  logger: true,
  // 请求体接收超时（JSON 体积很小，30s 足够；不设置则慢连接可无限占用）
  requestTimeout: 30_000,
  // 建连后等待首个请求的超时，避免组网客户端的空闲连接堆积
  connectionTimeout: 60_000,
  // 显式保持长连接：异地组网 RTT 高，连接复用对分片/封面这类小请求收益明显
  keepAliveTimeout: 72_000
}).withTypeProvider<ZodTypeProvider>();
// 用 zod 编译器做运行时请求体校验（withTypeProvider 只负责 TS 类型推导）
app.setValidatorCompiler(validatorCompiler);
await app.register(cors, {
  origin: (origin, callback) => {
    // 无 Origin 头（同源请求、curl、SSR 的服务端 fetch）直接放行
    if (!origin) return callback(null, true);
    if (extraAllowedOrigins().includes(origin)) return callback(null, true);
    try {
      const { hostname } = new URL(origin);
      return callback(null, isPrivateOriginHost(hostname));
    } catch {
      return callback(null, false);
    }
  },
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
});
// 响应压缩：JSON 列表接口通常能省 70-80% 字节。
// 是否压缩由 mime-db 按 content-type 判定，视频/图片（video/*、image/webp）本身不可压缩会被自动跳过；
// 视频流路由另外显式声明 compress: false，确保 Range 响应绝不被重新编码。
await app.register(compress, { global: true, threshold: 1024 });

app.setErrorHandler((error, _request, reply) => {
  const err = error as { statusCode?: number; message?: string };
  const statusCode = err.statusCode ?? 500;
  if (statusCode >= 500) {
    // 走 Fastify 内置 pino，与请求日志格式统一（pino 序列化 Error 含 stack）
    app.log.error(error);
  }
  reply.code(statusCode).send({
    error: statusCode === 500 ? "Internal Server Error" : err.message ?? "Error",
    ...(statusCode < 500 && err.message ? { message: err.message } : {})
  });
});

await app.register(healthRoutes);
await app.register(fsRoutes);
await app.register(libraryRoutes);
await app.register(feedRoutes);
await app.register(searchRoutes);
await app.register(categoryRoutes);
await app.register(creatorRoutes);
await app.register(itemRoutes);
await app.register(mediaRoutes);
await app.register(hlsRoutes);
await app.register(meRoutes);

const host = process.env.HILI_API_HOST ?? "0.0.0.0";
const port = Number(process.env.HILI_API_PORT ?? 4141);

await app.listen({ host, port });