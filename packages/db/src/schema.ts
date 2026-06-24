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
    categoryId: text("category_id").references(() => categories.id),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    byName: uniqueIndex("creators_category_name_idx").on(table.categoryId, table.name)
  })
);

export const mediaItems = sqliteTable(
  "media_items",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["video", "image", "post"] }).notNull(),
    title: text("title").notNull(),
    postBody: text("post_body"),
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
    itemId: text("item_id").notNull().references(() => mediaItems.id),
    path: text("path").notNull(),
    sortIndex: integer("sort_index").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    fingerprint: text("fingerprint").notNull(),
    thumbnailPath: text("thumbnail_path")
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
    itemId: text("item_id").notNull().references(() => mediaItems.id),
    title: text("title").notNull(),
    partIndex: integer("part_index").notNull(),
    path: text("path").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    streamPath: text("stream_path"),
    streamSizeBytes: integer("stream_size_bytes"),
    compatibilityStatus: text("compatibility_status", { enum: ["pending", "ready", "failed"] }).notNull().default("pending"),
    compatibilityError: text("compatibility_error"),
    durationSeconds: real("duration_seconds"),
    fingerprint: text("fingerprint").notNull(),
    previewSpritePath: text("preview_sprite_path"),
    previewSpriteCols: integer("preview_sprite_cols"),
    previewSpriteRows: integer("preview_sprite_rows"),
    previewSpriteInterval: real("preview_sprite_interval"),
    previewThumbW: integer("preview_thumb_w"),
    previewThumbH: integer("preview_thumb_h")
  },
  (table) => ({
    byItem: index("media_parts_item_idx").on(table.itemId),
    byPath: uniqueIndex("media_parts_path_idx").on(table.path)
  })
);

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique()
});

export const mediaTags = sqliteTable(
  "media_tags",
  {
    mediaItemId: text("media_item_id").notNull().references(() => mediaItems.id),
    tagId: text("tag_id").notNull().references(() => tags.id)
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
    kind: text("kind", { enum: ["like", "dislike", "watch", "finish", "blacklist_up"] }).notNull(),
    value: real("value").notNull().default(1),
    createdAt: text("created_at").notNull()
  },
  (table) => ({
    byTarget: index("interactions_target_idx").on(table.targetType, table.targetId)
  })
);

export const watchProgress = sqliteTable("watch_progress", {
  itemId: text("item_id").primaryKey().references(() => mediaItems.id),
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
    itemId: text("item_id").notNull().references(() => mediaItems.id),
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
  itemId: text("item_id").primaryKey().references(() => mediaItems.id),
  reaction: text("reaction", { enum: ["like", "dislike"] }),
  updatedAt: text("updated_at").notNull()
});

export const creatorPreferences = sqliteTable("creator_preferences", {
  creatorId: text("creator_id").primaryKey().references(() => creators.id),
  blacklisted: integer("blacklisted", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull()
});
