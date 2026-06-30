import cors from "@fastify/cors";
import { validatorCompiler, ZodTypeProvider } from "@fastify/type-provider-zod";
import Fastify from "fastify";
import { healthRoutes } from "./routes/health.js";
import { fsRoutes } from "./routes/fs.js";
import { libraryRoutes } from "./routes/library.js";
import { feedRoutes } from "./routes/feed.js";
import { searchRoutes } from "./routes/search.js";
import { categoryRoutes } from "./routes/category.js";
import { creatorRoutes } from "./routes/creator.js";
import { itemRoutes } from "./routes/item.js";
import { mediaRoutes } from "./routes/media.js";
import { meRoutes } from "./routes/me.js";

const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();
// 用 zod 编译器做运行时请求体校验（withTypeProvider 只负责 TS 类型推导）
app.setValidatorCompiler(validatorCompiler);
await app.register(cors, {
  origin: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
});

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
await app.register(meRoutes);

const host = process.env.HILI_API_HOST ?? "0.0.0.0";
const port = Number(process.env.HILI_API_PORT ?? 4141);

await app.listen({ host, port });
