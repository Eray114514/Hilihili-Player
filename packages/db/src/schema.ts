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
    kind: text("kind", { enum: ["video", "image"] }).notNull(),
    title: text("title").notNull(),
    libraryId: text("library_id").notNull().references(() => libraries.id),
    categoryId: text("category_id").references(() => categories.id),
    creatorId: text("creator_id").references(() => creators.id),
    sourcePath: text("source_path").notNull(),
    relativePath: text("relative_path").notNull(),
    folderPath: text("folder_path"),
    fingerprint: text("fingerprint").notNull(),
    coverPath: text("cover_path"),
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

export const mediaParts = sqliteTable(
  "media_parts",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => mediaItems.id),
    title: text("title").notNull(),
    partIndex: integer("part_index").notNull(),
    path: text("path").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    durationSeconds: real("duration_seconds"),
    fingerprint: text("fingerprint").notNull()
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
  status: text("status", { enum: ["running", "complete", "failed"] }).notNull(),
  message: text("message"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  itemsIndexed: integer("items_indexed").notNull().default(0)
});
