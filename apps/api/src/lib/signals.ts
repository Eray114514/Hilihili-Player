import { createId, nowIso } from "@hilihili/db";
import type { InteractionKind } from "@hilihili/shared";
import { db } from "./db.js";

export type ItemRef = { id: string; creator_id: string | null; category_id: string | null };

const insertInteractionStmt = db.prepare(
  "INSERT INTO interactions (id, target_type, target_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?, ?)"
);

const tagStmt = db.prepare(`
  SELECT tag_id AS tagId, source, sort_order AS sortOrder
  FROM media_tags WHERE media_item_id = ?
  ORDER BY CASE source WHEN 'content' THEN 0 WHEN 'creator' THEN 1 WHEN 'category' THEN 2 ELSE 3 END, sort_order ASC
`);

export function recordRecommendationSignals(item: ItemRef, kind: InteractionKind, value: number, timestamp = nowIso()) {
  const signalTargets = kind === "like" || kind === "dislike" || kind === "coin" || kind === "favorite";
  db.transaction(() => {
    insertInteractionStmt.run(createId("int"), "item", item.id, kind, value, timestamp);
    if (signalTargets && item.creator_id) {
      insertInteractionStmt.run(createId("int"), "creator", item.creator_id, kind, value, timestamp);
    }
    if (signalTargets && item.category_id) {
      insertInteractionStmt.run(createId("int"), "category", item.category_id, kind, value, timestamp);
    }
    const tags = tagStmt.all(item.id) as { tagId: string; source: "legacy" | "category" | "creator" | "content"; sortOrder: number }[];
    for (const tag of tags) {
      insertInteractionStmt.run(createId("int"), "tag", tag.tagId, kind, value * tagSignalMultiplier(tag.source, tag.sortOrder), timestamp);
    }
  })();
}

export function insertInteraction(targetType: "item" | "creator" | "category" | "tag", targetId: string, kind: InteractionKind, value: number, timestamp: string) {
  insertInteractionStmt.run(createId("int"), targetType, targetId, kind, value, timestamp);
}

export function tagSignalMultiplier(source: "legacy" | "category" | "creator" | "content", sortOrder: number) {
  const sourceBoost = source === "content" ? 1.75 : source === "creator" ? 1.2 : source === "category" ? 0.8 : 1;
  const positionBoost = Math.max(0.45, 1 - Math.max(0, sortOrder) * 0.08);
  return sourceBoost * positionBoost;
}
