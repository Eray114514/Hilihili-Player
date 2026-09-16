import type { FastifyInstance } from "fastify";
import { getRecommendedFeed } from "@hilihili/recommendation";
import { CACHE_POLICY_FEED, sendJson } from "../lib/http-cache.js";

export async function feedRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { seed?: string; limit?: string; offset?: string; mode?: string } }>("/feeds/home", async (request, reply) => sendJson(request, reply, {
    items: getRecommendedFeed({
      seed: request.query.seed ?? String(Date.now()),
      limit: Number(request.query.limit ?? 30),
      offset: Number(request.query.offset ?? 0),
      mode: request.query.mode === "shuffle" ? "shuffle" : "recommended"
    })
  }, CACHE_POLICY_FEED));

  app.get<{ Querystring: { seed?: string; limit?: string; sort?: string; kind?: string } }>("/feeds/dynamic", async (request, reply) => sendJson(request, reply, {
    items: getRecommendedFeed({
      seed: request.query.seed ?? "dynamic",
      limit: Number(request.query.limit ?? 36),
      includeImages: request.query.kind !== "video",
      kind: request.query.kind === "image" ? "image" : request.query.kind === "video" ? "video" : request.query.kind === "post" ? "post" : undefined,
      includeFinished: true,
      mode: request.query.sort === "oldest" ? "oldest" : request.query.sort === "random" ? "shuffle" : "latest"
    })
  }, CACHE_POLICY_FEED));

  app.get<{ Params: { id: string }; Querystring: { seed?: string } }>("/feeds/category/:id", async (request, reply) => sendJson(request, reply, {
    items: getRecommendedFeed({
      categoryId: request.params.id,
      seed: request.query.seed ?? request.params.id,
      includeImages: false,
      limit: 48
    })
  }, CACHE_POLICY_FEED));

  app.get<{ Params: { id: string }; Querystring: { seed?: string; limit?: string; offset?: string; kind?: "video" | "post" | "image" } }>("/feeds/creator/:id", async (request, reply) => sendJson(request, reply, {
    items: getRecommendedFeed({
      creatorId: request.params.id,
      seed: request.query.seed ?? request.params.id,
      includeImages: true,
      includeFinished: true,
      kind: request.query.kind,
      limit: Number(request.query.limit ?? 48),
      offset: Number(request.query.offset ?? 0),
      mode: "latest",
      includeBlacklisted: true
    })
  }, CACHE_POLICY_FEED));
}