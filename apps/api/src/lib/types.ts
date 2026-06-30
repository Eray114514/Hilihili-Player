import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { z } from "zod/v4";

// 带 ZodTypeProvider 的 Fastify 实例类型，供 routes 文件标注 app 参数用
// 用 Parameters 推导避免手动构造 FastifyInstance 的 5 个泛型参数
export type ZodFastifyInstance = Parameters<FastifyPluginAsyncZod>[0];

// 通用 :id 路径参数 schema
// 注意：body 路由若同时带 <{ Params }>` 泛型，会破坏 type provider 对 body 的推导，
// 所以 body 路由统一用 zod schema 表达 params，不再用泛型。
export const idParamSchema = z.object({ id: z.string() });

// Body schemas
export const addLibrarySchema = z.object({
  name: z.string().trim().optional(),
  rootPath: z.string().trim().optional()
});
export type AddLibraryBody = z.infer<typeof addLibrarySchema>;

export const scanRunSchema = z.object({
  libraryId: z.string().min(1).optional()
});
export type ScanRunBody = z.infer<typeof scanRunSchema>;

export const followSchema = z.object({
  followed: z.boolean().optional()
});
export type FollowBody = z.infer<typeof followSchema>;

export const blacklistSchema = z.object({
  blacklisted: z.boolean().optional()
});
export type BlacklistBody = z.infer<typeof blacklistSchema>;

export const tagSchema = z.object({
  name: z.string().trim().optional()
});
export type TagBody = z.infer<typeof tagSchema>;

// reaction 必填（前端始终发送该字段）：null 表示清除，"like"/"dislike" 表示设置。
// 不用 .optional()——否则 undefined 会通过 zod 并被写入 DB（原手写校验亦拒绝 undefined）。
export const reactionSchema = z.object({
  reaction: z.enum(["like", "dislike"]).nullable()
});
export type ReactionBody = z.infer<typeof reactionSchema>;

// kind 枚举与 @hilihili/shared 的 InteractionKind 保持一致
export const interactionSchema = z.object({
  kind: z.enum(["like", "dislike", "watch", "finish", "blacklist_up", "coin", "favorite"]),
  value: z.number().optional(),
  positionSeconds: z.number().optional(),
  durationSeconds: z.number().optional(),
  partId: z.string().min(1).optional()
});
export type InteractionBody = z.infer<typeof interactionSchema>;

export const commentSchema = z.object({
  body: z.string().trim().optional(),
  atSeconds: z.number().nullable().optional()
});
export type CommentBody = z.infer<typeof commentSchema>;

export const favoriteFolderSchema = z.object({
  name: z.string().trim().optional()
});
export type FavoriteFolderBody = z.infer<typeof favoriteFolderSchema>;

export const favoriteItemSchema = z.object({
  folderId: z.string().min(1).optional()
});
export type FavoriteItemBody = z.infer<typeof favoriteItemSchema>;

// 接受空 body 的所有形式：{} / null / undefined。
// 用 .nullish() 而非 .optional()——Fastify 在无 body 时会把 null 传给 validator，
// .optional() 会拒绝 null 导致 400（原无 schema 时代接受空 body）。
export const emptySchema = z.object({}).nullish();
export type EmptyBody = z.infer<typeof emptySchema>;

// DB row types (not body)
export type ActivityRow = {
  itemId: string;
  resumePartId: string | null;
  resumePartIndex: number | null;
  resumePartTitle: string | null;
  positionSeconds: number;
  durationSeconds: number | null;
  finished: number;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  likedAt: string | null;
  coinedAt: string | null;
};
