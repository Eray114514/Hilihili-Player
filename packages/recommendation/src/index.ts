import { getSqlite } from "@hilihili/db";
import type { FeedItem, MediaKind } from "@hilihili/shared";

type CandidateRow = {
  id: string;
  kind: MediaKind;
  title: string;
  post_body: string | null;
  description: string | null;
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
  creator_avatar_path: string | null;
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
      mi.id, mi.kind, mi.title, mi.post_body, mi.description, mi.creator_id, mi.category_id, mi.first_seen_at,
      mi.content_published_at, mi.file_modified_at, mi.cover_path, mi.generated_cover_path, mi.thumbnail_status,
      c.name AS category_name,
      cr.name AS creator_name, cr.alias AS creator_alias, cr.avatar_path AS creator_avatar_path,
      COALESCE(pc.part_count, 0) AS part_count,
      (SELECT mp.id FROM media_parts mp WHERE mp.item_id = mi.id ORDER BY mp.part_index ASC LIMIT 1) AS preview_part_id,
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
      SELECT item_id, COUNT(*) AS part_count
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
        : diversityRerank(scored.sort((a, b) => b.score - a.score));

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
    SELECT kind, value, created_at FROM interactions
    WHERE target_type = ? AND target_id = ?
  `).all(targetType, targetId) as { kind: string; value: number; created_at: string }[];

  return rows.reduce((score, row) => score + kindWeight(row.kind, row.value, row.created_at), 0);
}

function tagInteractionWeight(db: ReturnType<typeof getSqlite>, itemId: string) {
  const rows = db.prepare(`
    SELECT i.kind, i.value, i.created_at, mt.source, mt.sort_order AS sortOrder
    FROM media_tags mt
    JOIN interactions i ON i.target_type = 'tag' AND i.target_id = mt.tag_id
    WHERE mt.media_item_id = ?
  `).all(itemId) as { kind: string; value: number; created_at: string; source: "scan" | "manual"; sortOrder: number }[];

  return rows.reduce((score, row) => score + kindWeight(row.kind, row.value, row.created_at) * tagPlacementWeight(row.source, row.sortOrder), 0);
}

function kindWeight(kind: string, value: number, createdAt: string) {
  const parsed = Date.parse(createdAt);
  const decay = Number.isFinite(parsed) ? Math.exp(-((Date.now() - parsed) / 86400000) / 45) : 1;
  switch (kind) {
    case "coin":
      return value * 4 * decay;
    case "favorite":
      return value * 2.4 * decay;
    case "like":
      return value * 2 * decay;
    case "finish":
      return value * 1.5 * decay;
    case "watch":
      return value * 0.15 * decay;
    case "dislike":
      return -value * 3 * decay;
    default:
      return 0;
  }
}

function tagPlacementWeight(source: "scan" | "manual", sortOrder: number) {
  const sourceBoost = source === "manual" ? 1.7 : 1;
  const positionBoost = Math.max(0.45, 1 - Math.max(0, sortOrder) * 0.08);
  return sourceBoost * positionBoost;
}

function diversityRerank(scored: { row: CandidateRow; score: number }[]): { row: CandidateRow; score: number }[] {
  const result: { row: CandidateRow; score: number }[] = [];
  const deferred: { row: CandidateRow; score: number }[] = [];
  const creatorCount = new Map<string, number>();

  const violates = (creatorId: string | null): boolean => {
    if (creatorId === null) return false;
    const len = result.length;
    if (len >= 2 && result[len - 1].row.creator_id === creatorId && result[len - 2].row.creator_id === creatorId) {
      return true;
    }
    if ((creatorCount.get(creatorId) ?? 0) >= 3) {
      return true;
    }
    return false;
  };

  const add = (item: { row: CandidateRow; score: number }) => {
    result.push(item);
    if (item.row.creator_id !== null) {
      creatorCount.set(item.row.creator_id, (creatorCount.get(item.row.creator_id) ?? 0) + 1);
    }
  };

  for (const item of scored) {
    if (violates(item.row.creator_id)) {
      deferred.push({ row: item.row, score: item.score * 0.65 });
    } else {
      add(item);
    }
  }

  while (deferred.length > 0) {
    let added = false;
    const remaining: { row: CandidateRow; score: number }[] = [];
    for (const item of deferred) {
      if (violates(item.row.creator_id)) {
        remaining.push(item);
      } else {
        add(item);
        added = true;
      }
    }
    deferred.length = 0;
    deferred.push(...remaining);
    if (!added) break;
  }

  for (const item of deferred) {
    add(item);
  }

  return result;
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
    creatorAvatarUrl: row.creator_id && row.creator_avatar_path ? `/media/creators/${row.creator_id}/avatar` : null,
    coverUrl: row.cover_path || row.generated_cover_path ? `/media/items/${row.id}/cover` : null,
    thumbnailStatus: row.thumbnail_status,
    firstSeenAt: row.first_seen_at,
    displayDate: row.content_published_at ?? row.file_modified_at ?? row.first_seen_at,
    postExcerpt: row.post_body ? excerpt(row.post_body) : row.description ? excerpt(row.description) : null,
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
