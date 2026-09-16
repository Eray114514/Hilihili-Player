import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const libraries = sqliteTable("libraries", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull()
});

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    libraryId: text("library_id").references(() => libraries.id),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    byName: uniqueIndex("categories_library_name_idx").on(table.libraryId, table.name)
  })
);

export const creators = sqliteTable(
  "creators",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    alias: text("alias"),
    description: text("description"),
    avatarPath: text("avatar_path"),
    bannerPath: text("banner_path"),
    libraryId: text("library_id").references(() => libraries.id),
    categoryId: text("category_id").references(() => categories.id),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at")
  },
  (table) => ({
    byName: uniqueIndex("creators_category_name_idx").on(table.categoryId, table.name),
    byLibraryName: uniqueIndex("creators_library_name_idx").on(table.libraryId, table.name)
  })
);

export const mediaItems = sqliteTable(
  "media_items",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["video", "image", "post"] }).notNull(),
    title: text("title").notNull(),
    postBody: text("post_body"),
    description: text("description"),
    libraryId: text("library_id").notNull().references(() => libraries.id),
    categoryId: text("category_id").references(() => categories.id),
    creatorId: text("creator_id").references(() => creators.id),
    sourcePath: text("source_path").notNull(),
    relativePath: text("relative_path").notNull(),
    folderPath: text("folder_path"),
    fingerprint: text("fingerprint").notNull(),
    coverPath: text("cover_path"),
    generatedCoverPath: text("generated_cover_path"),
    thumbnailStatus: text("thumbnail_status", { enum: ["pending", "ready", "failed"] }).notNull().default("pending"),
    thumbnailError: text("thumbnail_error"),
    contentPublishedAt: text("content_published_at"),
    fileModifiedAt: text("file_modified_at"),
    hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
    structureStatus: text("structure_status", { enum: ["standard", "fallback"] }).notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
    lastScannedAt: text("last_scanned_at"),
    updatedAt: text("updated_at").notNull()
  },
  (table) => ({
    byFingerprint: uniqueIndex("media_items_fingerprint_idx").on(table.fingerprint),
    byLibrary: index("media_items_library_idx").on(table.libraryId),
    byCategory: index("media_items_category_idx").on(table.categoryId),
    byCreator: index("media_items_creator_idx").on(table.creatorId)
  })
);

export const mediaImages = sqliteTable(
  "media_images",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => mediaItems.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sortIndex: integer("sort_index").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    fingerprint: text("fingerprint").notNull(),
    thumbnailPath: text("thumbnail_path"),
    isAnimated: integer("is_animated", { mode: "boolean" }),
    frameCount: integer("frame_count"),
    durationMs: integer("duration_ms")
  },
  (table) => ({
    byItem: index("media_images_item_idx").on(table.itemId),
    byPath: uniqueIndex("media_images_path_idx").on(table.path)
  })
);

export const mediaParts = sqliteTable(
  "media_parts",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => mediaItems.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    partIndex: integer("part_index").notNull(),
    path: text("path").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    streamPath: text("stream_path"),
    streamSizeBytes: integer("stream_size_bytes"),
    compatibilityStatus: text("compatibility_status", { enum: ["pending", "ready", "failed"] }).notNull().default("pending"),
    compatibilityError: text("compatibility_error"),
    compatibilityAttempts: integer("compatibility_attempts").notNull().default(0),
    lastCompatibilityAttemptAt: text("last_compatibility_attempt_at"),
    durationSeconds: real("duration_seconds"),
    fingerprint: text("fingerprint").notNull(),
    previewSpritePath: text("preview_sprite_path"),
    previewSpriteCols: integer("preview_sprite_cols"),
    previewSpriteRows: integer("preview_sprite_rows"),
    previewSpriteInterval: real("preview_sprite_interval"),
    previewThumbW: integer("preview_thumb_w"),
    previewThumbH: integer("preview_thumb_h"),
    // HLS 远程播放产物（可切片的低码率版本）。这些列由 migration v7 补齐，
    // 基线 CREATE TABLE 里不声明——与 items_failed 等列的处理方式一致。
    hlsPath: text("hls_path"),
    /** 生成 HLS 时源文件的指纹；与 fingerprint 不一致即视为失效（换文件后必须重建） */
    hlsFingerprint: text("hls_fingerprint"),
    hlsStatus: text("hls_status", { enum: ["none", "queued", "running", "ready", "stale", "failed"] }).notNull().default("none"),
    hlsError: text("hls_error"),
    /** 实际生成的档位清单（JSON），供 master playlist 与画质菜单使用 */
    hlsLadder: text("hls_ladder"),
    hlsUpdatedAt: text("hls_updated_at"),
    hlsAttempts: integer("hls_attempts").notNull().default(0),
    /** 供缓存 LRU 淘汰使用 */
    lastPlayedAt: text("last_played_at"),
    playCount: integer("play_count").notNull().default(0)
  },
  (table) => ({
    byItem: index("media_parts_item_idx").on(table.itemId),
    byPath: uniqueIndex("media_parts_path_idx").on(table.path)
  })
);

/**
 * 转码任务队列。
 *
 * 不复用 scan_runs：那张表是 library 粒度的整轮扫描 + 缩略图计数器，
 * 既没有 part 粒度，enqueueScan 还会按 library 去重。转码需要按分P、按档位、
 * 可重试、可中断、可断点续跑，所以单独建表。
 */
export const transcodeTasks = sqliteTable(
  "transcode_tasks",
  {
    id: text("id").primaryKey(),
    partId: text("part_id").notNull().references(() => mediaParts.id, { onDelete: "cascade" }),
    /** 入队时的源文件指纹，用于判断任务是否已过期（源文件被替换） */
    fingerprint: text("fingerprint").notNull(),
    profile: text("profile").notNull(),
    status: text("status", { enum: ["queued", "running", "complete", "failed", "canceled"] }).notNull(),
    /** 越大越先跑：点播请求 100，扫描预热 0 */
    priority: integer("priority").notNull().default(0),
    /** 0-1，由 ffmpeg 输出解析 */
    progress: real("progress").notNull().default(0),
    encoder: text("encoder"),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    error: text("error"),
    queuedAt: text("queued_at").notNull(),
    startedAt: text("started_at"),
    finishedAt: text("finished_at"),
    /** 失败退避：到点之前不取该任务 */
    nextAttemptAt: text("next_attempt_at"),
    bytesOut: integer("bytes_out"),
    durationMs: integer("duration_ms")
  },
  (table) => ({
    // 幂等入队：同一个分P 的同一个档位只会有一条任务
    byPartProfile: uniqueIndex("transcode_tasks_part_profile_idx").on(table.partId, table.profile),
    byQueue: index("transcode_tasks_queue_idx").on(table.status, table.priority, table.queuedAt),
    byFingerprint: index("transcode_tasks_fingerprint_idx").on(table.fingerprint)
  })
);

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique()
});

export const mediaTags = sqliteTable(
  "media_tags",
  {
    mediaItemId: text("media_item_id").notNull().references(() => mediaItems.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["legacy", "category", "creator", "content"] }).notNull().default("legacy"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at")
  },
  (table) => ({
    byPair: uniqueIndex("media_tags_pair_idx").on(table.mediaItemId, table.tagId)
  })
);

export const interactions = sqliteTable(
  "interactions",
  {
    id: text("id").primaryKey(),
    targetType: text("target_type", { enum: ["item", "creator", "category", "tag"] }).notNull(),
    targetId: text("target_id").notNull(),
    kind: text("kind", { enum: ["like", "dislike", "watch", "finish", "blacklist_up", "coin", "favorite"] }).notNull(),
    value: real("value").notNull().default(1),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    byTarget: index("interactions_target_idx").on(table.targetType, table.targetId)
  })
);

export const watchProgress = sqliteTable("watch_progress", {
  itemId: text("item_id").primaryKey().references(() => mediaItems.id, { onDelete: "cascade" }),
  partId: text("part_id").references(() => mediaParts.id),
  positionSeconds: real("position_seconds").notNull().default(0),
  finished: integer("finished", { mode: "boolean" }).notNull().default(false),
  startedAt: text("started_at").notNull().default(""),
  completedAt: text("completed_at"),
  updatedAt: text("updated_at").notNull()
});

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => mediaItems.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    atSeconds: real("at_seconds"),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    byItem: index("comments_item_idx").on(table.itemId)
  })
);

export const scanRuns = sqliteTable("scan_runs", {
  id: text("id").primaryKey(),
  libraryId: text("library_id").references(() => libraries.id),
  status: text("status", { enum: ["queued", "running", "complete", "failed"] }).notNull(),
  message: text("message"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  itemsIndexed: integer("items_indexed").notNull().default(0),
  itemsFailed: integer("items_failed").notNull().default(0),
  itemsSkipped: integer("items_skipped").notNull().default(0),
  thumbnailsTotal: integer("thumbnails_total").notNull().default(0),
  thumbnailsReady: integer("thumbnails_ready").notNull().default(0),
  thumbnailsFailed: integer("thumbnails_failed").notNull().default(0)
});

export const mediaSubtitles = sqliteTable(
  "media_subtitles",
  {
    id: text("id").primaryKey(),
    partId: text("part_id").notNull().references(() => mediaParts.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    language: text("language").notNull(),
    label: text("label").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    sortIndex: integer("sort_index").notNull().default(0)
  },
  (table) => ({
    byPart: index("media_subtitles_part_idx").on(table.partId)
  })
);

export const itemPreferences = sqliteTable("item_preferences", {
  itemId: text("item_id").primaryKey().references(() => mediaItems.id, { onDelete: "cascade" }),
  reaction: text("reaction", { enum: ["like", "dislike"] }),
  coined: integer("coined", { mode: "boolean" }).notNull().default(false),
  coinedAt: text("coined_at"),
  updatedAt: text("updated_at").notNull()
});

export const creatorPreferences = sqliteTable("creator_preferences", {
  creatorId: text("creator_id").primaryKey().references(() => creators.id, { onDelete: "cascade" }),
  blacklisted: integer("blacklisted", { mode: "boolean" }).notNull().default(false),
  followed: integer("followed", { mode: "boolean" }).notNull().default(false),
  followedAt: text("followed_at"),
  updatedAt: text("updated_at").notNull()
});

export const creatorMessages = sqliteTable(
  "creator_messages",
  {
    id: text("id").primaryKey(),
    creatorId: text("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull().references(() => mediaItems.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
    readAt: text("read_at")
  },
  (table) => ({
    byCreator: index("creator_messages_creator_idx").on(table.creatorId),
    byCreated: index("creator_messages_created_idx").on(table.createdAt),
    byItem: uniqueIndex("creator_messages_item_idx").on(table.itemId)
  })
);

export const favoriteFolders = sqliteTable("favorite_folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull()
});

export const favorites = sqliteTable(
  "favorites",
  {
    id: text("id").primaryKey(),
    folderId: text("folder_id").notNull().references(() => favoriteFolders.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull().references(() => mediaItems.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    byFolder: index("favorites_folder_idx").on(table.folderId),
    byItem: index("favorites_item_idx").on(table.itemId),
    byPair: uniqueIndex("favorites_pair_idx").on(table.folderId, table.itemId)
  })
);

export const searchHistory = sqliteTable(
  "search_history",
  {
    id: text("id").primaryKey(),
    query: text("query").notNull(),
    searchedAt: text("searched_at").notNull()
  },
  (table) => ({
    byQuery: uniqueIndex("search_history_query_idx").on(table.query)
  })
);
