import { createId, nowIso, interactions, mediaTags } from "@hilihili/db";
import type { InteractionKind } from "@hilihili/shared";
import { eq, sql } from "drizzle-orm";
import { db } from "./db.js";

export type ItemRef = { id: string; creator_id: string | null; category_id: string | null };

// Drizzle 的 better-sqlite3 driver 内部仍复用 prepared statement 缓存，
// 直接 insert 与显式 prepare 性能等价；代码更简洁，故用方案 B。
export function recordRecommendationSignals(item: ItemRef, kind: InteractionKind, value: number, timestamp = nowIso()) {
  const signalTargets = kind === "like" || kind === "dislike" || kind === "coin" || kind === "favorite";
  // Drizzle 的 transaction 接收 tx 参数并直接返回回调返回值，无需 better-sqlite3 末尾的 () 调用
  db.transaction((tx) => {
    tx.insert(interactions).values({
      id: createId("int"),
      targetType: "item",
      targetId: item.id,
      kind,
      value,
      createdAt: timestamp
    }).run();
    if (signalTargets && item.creator_id) {
      tx.insert(interactions).values({
        id: createId("int"),
        targetType: "creator",
        targetId: item.creator_id,
        kind,
        value,
        createdAt: timestamp
      }).run();
    }
    if (signalTargets && item.category_id) {
      tx.insert(interactions).values({
        id: createId("int"),
        targetType: "category",
        targetId: item.category_id,
        kind,
        value,
        createdAt: timestamp
      }).run();
    }
    // ORDER BY CASE source ... 用 sql 模板表达，引用 schema 列
    const tags = tx.select({
      tagId: mediaTags.tagId,
      source: mediaTags.source,
      sortOrder: mediaTags.sortOrder
    })
      .from(mediaTags)
      .where(eq(mediaTags.mediaItemId, item.id))
      .orderBy(sql`CASE ${mediaTags.source} WHEN 'content' THEN 0 WHEN 'creator' THEN 1 WHEN 'category' THEN 2 ELSE 3 END, ${mediaTags.sortOrder} ASC`)
      .all();
    for (const tag of tags) {
      tx.insert(interactions).values({
        id: createId("int"),
        targetType: "tag",
        targetId: tag.tagId,
        kind,
        value: value * tagSignalMultiplier(tag.source, tag.sortOrder),
        createdAt: timestamp
      }).run();
    }
  });
}

export function insertInteraction(targetType: "item" | "creator" | "category" | "tag", targetId: string, kind: InteractionKind, value: number, timestamp: string) {
  db.insert(interactions).values({
    id: createId("int"),
    targetType,
    targetId,
    kind,
    value,
    createdAt: timestamp
  }).run();
}

export function tagSignalMultiplier(source: "legacy" | "category" | "creator" | "content", sortOrder: number) {
  const sourceBoost = source === "content" ? 1.75 : source === "creator" ? 1.2 : source === "category" ? 0.8 : 1;
  const positionBoost = Math.max(0.45, 1 - Math.max(0, sortOrder) * 0.08);
  return sourceBoost * positionBoost;
}
