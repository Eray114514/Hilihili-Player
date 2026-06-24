import { getSqlite } from "@hilihili/db";
import type { FeedItem, MediaKind } from "@hilihili/shared";

type CandidateRow = {
  id: string;
  kind: MediaKind;
  title: string;
  post_body: string | null;
  creator_id: string | null;
  category_id: string | null;
  first_seen_at: string;
  content_published_at: string | null;
  file_modified_at: string | null;
  cover_path: string | null;
  generated_cover_path: string | null;
  thumbnail_status: "pending" | "ready" | "failed";
  category_name: string | null;
  creator_name: string | null;
  creator_alias: string | null;
  part_count: number;
  preview_part_id: string | null;
  finished: number | null;
  creator_blacklisted: number;
};

export type FeedOptions = {
  limit?: number;
  offset?: number;
  seed?: string;
  categoryId?: string;
  creatorId?: string;
  includeImages?: boolean;
  includeFinished?: boolean;
  kind?: MediaKind;
  excludeId?: string;
  itemIds?: string[];
  includeBlacklisted?: boolean;
  mode?: "recommended" | "latest" | "oldest" | "shuffle";
};

export function getRecommendedFeed(options: FeedOptions = {}): FeedItem[] {
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 80);
  const offset = Math.min(Math.max(options.offset ?? 0, 0), 10000);
  const db = getSqlite();
  const params: (string | number)[] = [];
  const filters = ["mi.hidden = 0"];

  if (!options.includeImages) {
    filters.push("(mi.kind = 'video' OR (mi.kind = 'post' AND EXISTS (SELECT 1 FROM media_parts playable WHERE playable.item_id = mi.id)))");
  }
  if (options.kind) {
    filters.push("mi.kind = ?");
    params.push(options.kind);
  }
  if (options.excludeId) {
    filters.push("mi.id != ?");
    params.push(options.excludeId);
  }
  if (options.itemIds) {
    if (options.itemIds.length === 0) return [];
    const ids = options.itemIds.slice(0, 80);
    filters.push(`mi.id IN (${ids.map(() => "?").join(", ")})`);
    params.push(...ids);
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
      mi.id, mi.kind, mi.title, mi.post_body, mi.creator_id, mi.category_id, mi.first_seen_at,
      mi.content_published_at, mi.file_modified_at, mi.cover_path, mi.generated_cover_path, mi.thumbnail_status,
      c.name AS category_name,
      cr.name AS creator_name, cr.alias AS creator_alias,
      COALESCE(pc.part_count, 0) AS part_count, pc.preview_part_id,
      wp.finished,
      CASE WHEN EXISTS (
        SELECT 1 FROM interactions i
        WHERE i.kind = 'blacklist_up' AND i.target_type = 'creator' AND i.target_id = mi.creator_id
      ) OR EXISTS (
        SELECT 1 FROM creator_preferences cp
        WHERE cp.creator_id = mi.creator_id AND cp.blacklisted = 1
      ) THEN 1 ELSE 0 END AS creator_blacklisted
    FROM media_items mi
    LEFT JOIN categories c ON c.id = mi.category_id
    LEFT JOIN creators cr ON cr.id = mi.creator_id
    LEFT JOIN watch_progress wp ON wp.item_id = mi.id
    LEFT JOIN (
      SELECT item_id, COUNT(*) AS part_count,
        MAX(CASE WHEN part_index = 1 THEN id END) AS preview_part_id
      FROM media_parts GROUP BY item_id
    ) pc ON pc.item_id = mi.id
    WHERE ${filters.join(" AND ")}
  `).all(...params) as CandidateRow[];

  const candidates = options.includeBlacklisted ? rows : rows.filter((row) => row.creator_blacklisted === 0);
  const scored = candidates.map((row) => ({
    row,
    score: scoreCandidate(db, row, options.seed)
  }));

  const dateFor = (row: CandidateRow) => row.content_published_at ?? row.file_modified_at ?? row.first_seen_at;
  const sorted = options.mode === "latest"
    ? scored.sort((a, b) => dateFor(b.row).localeCompare(dateFor(a.row)))
    : options.mode === "oldest"
      ? scored.sort((a, b) => dateFor(a.row).localeCompare(dateFor(b.row)))
      : options.mode === "shuffle"
        ? scored.sort((a, b) => seededRandom(`${options.seed}:${a.row.id}`) - seededRandom(`${options.seed}:${b.row.id}`))
        : scored.sort((a, b) => b.score - a.score);

  return sorted.slice(offset, offset + limit).map(({ row, score }) => toFeedItem(db, row, score));
}

export function getFeedItemsByIds(ids: string[]): FeedItem[] {
  const uniqueIds = [...new Set(ids)].slice(0, 80);
  if (uniqueIds.length === 0) return [];
  const items = getRecommendedFeed({
    itemIds: uniqueIds,
    limit: uniqueIds.length,
    includeImages: true,
    includeFinished: true,
    includeBlacklisted: true,
    mode: "latest"
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  return uniqueIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
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

function toFeedItem(db: ReturnType<typeof getSqlite>, row: CandidateRow, score: number): FeedItem {
  const previewImages = db.prepare(`
    SELECT id, width, height FROM media_images WHERE item_id = ? ORDER BY sort_index ASC LIMIT 9
  `).all(row.id) as { id: string; width: number | null; height: number | null }[];
  const imageCount = (db.prepare("SELECT COUNT(*) AS count FROM media_images WHERE item_id = ?").get(row.id) as { count: number }).count;
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    categoryName: row.category_name ?? "未归类",
    creatorId: row.creator_id,
    creatorName: row.creator_name ?? "未知UP",
    creatorAlias: row.creator_alias,
    coverUrl: row.cover_path || row.generated_cover_path ? `/media/items/${row.id}/cover` : null,
    thumbnailStatus: row.thumbnail_status,
    firstSeenAt: row.first_seen_at,
    displayDate: row.content_published_at ?? row.file_modified_at ?? row.first_seen_at,
    postExcerpt: row.post_body ? excerpt(row.post_body) : null,
    playable: row.part_count > 0,
    previewPartId: row.preview_part_id,
    imageCount,
    previewImages: previewImages.map((image) => ({
      ...image,
      thumbnailUrl: `/media/images/${image.id}/thumbnail`,
      originalUrl: `/media/images/${image.id}/original`
    })),
    partCount: row.part_count,
    score
  };
}

function excerpt(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 220 ? `${normalized.slice(0, 220)}…` : normalized;
}

function seededRandom(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}
