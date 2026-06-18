import { getSqlite } from "@hilihili/db";
import type { FeedItem } from "@hilihili/shared";

type CandidateRow = {
  id: string;
  kind: "video" | "image";
  title: string;
  creator_id: string | null;
  category_id: string | null;
  first_seen_at: string;
  cover_path: string | null;
  category_name: string | null;
  creator_name: string | null;
  part_count: number;
  finished: number | null;
  creator_blacklisted: number;
};

export type FeedOptions = {
  limit?: number;
  seed?: string;
  categoryId?: string;
  creatorId?: string;
  includeImages?: boolean;
  includeFinished?: boolean;
  mode?: "recommended" | "latest" | "shuffle";
};

export function getRecommendedFeed(options: FeedOptions = {}): FeedItem[] {
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 80);
  const db = getSqlite();
  const params: (string | number)[] = [];
  const filters = ["mi.hidden = 0"];

  if (!options.includeImages) {
    filters.push("mi.kind = 'video'");
  }
  if (!options.includeFinished) {
    filters.push("COALESCE(wp.finished, 0) = 0");
  }
  if (options.categoryId) {
    filters.push("mi.category_id = ?");
    params.push(options.categoryId);
  }
  if (options.creatorId) {
    filters.push("mi.creator_id = ?");
    params.push(options.creatorId);
  }

  const rows = db.prepare(`
    SELECT
      mi.id, mi.kind, mi.title, mi.creator_id, mi.category_id, mi.first_seen_at, mi.cover_path,
      c.name AS category_name,
      cr.name AS creator_name,
      COALESCE(pc.part_count, 0) AS part_count,
      wp.finished,
      CASE WHEN EXISTS (
        SELECT 1 FROM interactions i
        WHERE i.kind = 'blacklist_up' AND i.target_type = 'creator' AND i.target_id = mi.creator_id
      ) THEN 1 ELSE 0 END AS creator_blacklisted
    FROM media_items mi
    LEFT JOIN categories c ON c.id = mi.category_id
    LEFT JOIN creators cr ON cr.id = mi.creator_id
    LEFT JOIN watch_progress wp ON wp.item_id = mi.id
    LEFT JOIN (
      SELECT item_id, COUNT(*) AS part_count FROM media_parts GROUP BY item_id
    ) pc ON pc.item_id = mi.id
    WHERE ${filters.join(" AND ")}
  `).all(...params) as CandidateRow[];

  const candidates = rows.filter((row) => row.creator_blacklisted === 0);
  const scored = candidates.map((row) => ({
    row,
    score: scoreCandidate(db, row, options.seed)
  }));

  const sorted = options.mode === "latest"
    ? scored.sort((a, b) => b.row.first_seen_at.localeCompare(a.row.first_seen_at))
    : scored.sort((a, b) => b.score - a.score);

  return sorted.slice(0, limit).map(({ row, score }) => toFeedItem(row, score));
}

function scoreCandidate(db: ReturnType<typeof getSqlite>, row: CandidateRow, seed = "home") {
  const itemWeight = interactionWeight(db, "item", row.id);
  const creatorWeight = row.creator_id ? interactionWeight(db, "creator", row.creator_id) : 0;
  const categoryWeight = row.category_id ? interactionWeight(db, "category", row.category_id) : 0;
  const tagWeight = tagInteractionWeight(db, row.id);
  const ageBoost = Math.max(0, 1 - (Date.now() - Date.parse(row.first_seen_at)) / 1000 / 60 / 60 / 24 / 30);
  const exploration = seededRandom(`${seed}:${row.id}`) * 2.5;
  const imagePenalty = row.kind === "image" ? -0.25 : 0;

  return 1 + itemWeight + creatorWeight * 0.8 + categoryWeight * 0.45 + tagWeight * 0.35 + ageBoost + exploration + imagePenalty;
}

function interactionWeight(db: ReturnType<typeof getSqlite>, targetType: string, targetId: string) {
  const rows = db.prepare(`
    SELECT kind, SUM(value) AS value FROM interactions
    WHERE target_type = ? AND target_id = ?
    GROUP BY kind
  `).all(targetType, targetId) as { kind: string; value: number }[];

  return rows.reduce((score, row) => {
    if (row.kind === "like") {
      return score + row.value * 2;
    }
    if (row.kind === "dislike") {
      return score - row.value * 2.5;
    }
    if (row.kind === "watch") {
      return score + row.value * 0.1;
    }
    return score;
  }, 0);
}

function tagInteractionWeight(db: ReturnType<typeof getSqlite>, itemId: string) {
  const rows = db.prepare(`
    SELECT i.kind, SUM(i.value) AS value
    FROM media_tags mt
    JOIN interactions i ON i.target_type = 'tag' AND i.target_id = mt.tag_id
    WHERE mt.media_item_id = ?
    GROUP BY i.kind
  `).all(itemId) as { kind: string; value: number }[];

  return rows.reduce((score, row) => row.kind === "like" ? score + row.value : score - row.value, 0);
}

function toFeedItem(row: CandidateRow, score: number): FeedItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    categoryName: row.category_name ?? "未归类",
    creatorName: row.creator_name ?? "未知UP",
    coverUrl: row.cover_path ? `/media/items/${row.id}/cover` : null,
    firstSeenAt: row.first_seen_at,
    partCount: row.part_count,
    score
  };
}

function seededRandom(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}
