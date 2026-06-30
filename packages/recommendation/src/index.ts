import { getSqlite } from "@hilihili/db";
import type { FeedItem, InteractionKind, MediaKind } from "@hilihili/shared";

// ===== 信号权重 =====
// item 自身信号最强，creator 次之（用户对作者的偏好弱于对作品的偏好），
// category 更弱（分类是粗粒度），tag 最弱但能捕捉细粒度兴趣
const WEIGHT_ITEM = 1;
const WEIGHT_CREATOR = 0.8;
const WEIGHT_CATEGORY = 0.45;
const WEIGHT_TAG = 0.35;

// exploration 是探索性随机扰动，用于打破完全确定性排序。
// 调到 0.5 与单项 watch（KIND_WATCH * 1 = 0.15）同量级，避免随机性压过真实信号
const EXPLORATION_WEIGHT = 0.5;

// 图片 item 在视频为主的 feed 中略有劣势（用户更倾向视频消费）
const IMAGE_PENALTY = -0.25;

// ===== 单次交互权重系数 =====
// coin > favorite > like > finish > watch，dislike 强负向
const KIND_COIN = 4;
const KIND_FAVORITE = 2.4;
const KIND_LIKE = 2;
const KIND_FINISH = 1.5;
const KIND_WATCH = 0.15;
const KIND_DISLIKE = 3;

// 时间衰减半衰期 45 天：近期交互权重更高，2 个月前的交互衰减到 ~40%
const DECAY_HALF_LIFE_DAYS = 45;

// ===== tag 排位权重 =====
// content 标签（视频自带）最强，creator 标签次之，category 标签最弱
const TAG_SOURCE_BOOST_CONTENT = 1.7;
const TAG_SOURCE_BOOST_CREATOR = 1.2;
const TAG_SOURCE_BOOST_CATEGORY = 0.8;
const TAG_SOURCE_BOOST_LEGACY = 1;
const TAG_POSITION_DECAY = 0.08; // 每后一个 tag 权重递减 8%
const TAG_POSITION_FLOOR = 0.45; // 最低不低于 45%，避免长尾 tag 完全失效

// ageBoost：新 item 加分，1 个月内线性衰减到 0
const AGE_BOOST_WINDOW_DAYS = 30;

// diversityRerank：同 creator 在结果中占比上限 15%（最少 1 个，避免小结果集过度限制）
const DIVERSITY_CAP_RATIO = 0.15;

const MS_PER_DAY = 86400000;

// ===== 类型定义 =====

// 裸 SQL 结果行：字段名保持 snake_case 与 SQL 别名对齐（非 schema camelCase），
// 每个字段后的注释标明 JOIN 来源，方便 reader 追溯关系
type CandidateRow = {
  id: string; // from media_items.id
  kind: MediaKind; // from media_items.kind
  title: string; // from media_items.title
  post_body: string | null; // from media_items.post_body
  description: string | null; // from media_items.description
  creator_id: string | null; // from media_items.creator_id
  category_id: string | null; // from media_items.category_id
  first_seen_at: string; // from media_items.first_seen_at
  content_published_at: string | null; // from media_items.content_published_at
  file_modified_at: string | null; // from media_items.file_modified_at
  cover_path: string | null; // from media_items.cover_path
  generated_cover_path: string | null; // from media_items.generated_cover_path
  thumbnail_status: "pending" | "ready" | "failed"; // from media_items.thumbnail_status
  category_name: string | null; // from categories.name
  creator_name: string | null; // from creators.name
  creator_alias: string | null; // from creators.alias
  creator_avatar_path: string | null; // from creators.avatar_path
  part_count: number; // from COALESCE(pc.part_count, 0)
  preview_part_id: string | null; // from (SELECT mp.id ... LIMIT 1)
  finished: number | null; // from watch_progress.finished
  creator_blacklisted: number; // from CASE WHEN EXISTS (blacklist) ...
};

type InteractionRow = {
  kind: InteractionKind;
  value: number;
  created_at: string;
};

type InteractionRowWithTarget = { target_id: string } & InteractionRow;

type TagInteractionRow = {
  item_id: string;
  kind: InteractionKind;
  value: number;
  created_at: string;
  source: "legacy" | "category" | "creator" | "content";
  sortOrder: number;
};

type PreviewImageRow = {
  item_id: string;
  id: string;
  width: number | null;
  height: number | null;
  is_animated: number | null;
};

type PreloadedInteractions = {
  item: Map<string, InteractionRow[]>;
  creator: Map<string, InteractionRow[]>;
  category: Map<string, InteractionRow[]>;
  tag: Map<string, TagInteractionRow[]>;
};

type PreloadedImages = Map<string, { images: PreviewImageRow[]; count: number }>;

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

type ScoredCandidate = { row: CandidateRow; score: number };

export function getRecommendedFeed(options: FeedOptions = {}): FeedItem[] {
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 80);
  const offset = Math.min(Math.max(options.offset ?? 0, 0), 10000);
  const db = getSqlite();

  const candidates = fetchCandidates(db, options);
  if (candidates.length === 0) return [];

  // 批量预加载所有候选的 interactions，避免 scoreCandidate 内部 N+1 查询
  const preloaded = preloadInteractions(db, candidates);
  const scored: ScoredCandidate[] = candidates.map((row) => ({
    row,
    score: scoreCandidate(row, preloaded, options.seed)
  }));

  const sorted = options.mode === "latest"
    ? scored.sort((a, b) => dateFor(b.row).localeCompare(dateFor(a.row)))
    : options.mode === "oldest"
      ? scored.sort((a, b) => dateFor(a.row).localeCompare(dateFor(b.row)))
      : options.mode === "shuffle"
        ? precomputeShuffle(scored, options.seed)
        : diversityRerank(scored.sort((a, b) => b.score - a.score));

  // 只为当前页预加载图片，避免对未返回的候选做无谓查询
  const page = sorted.slice(offset, offset + limit);
  const imageInfo = preloadImages(db, page.map(({ row }) => row.id));
  return page.map(({ row, score }) => toFeedItem(row, score, imageInfo));
}

export function getFeedItemsByIds(ids: string[]): FeedItem[] {
  const uniqueIds = [...new Set(ids)].slice(0, 80);
  if (uniqueIds.length === 0) return [];
  const db = getSqlite();
  // 调用方只关心按 id 顺序拿 item：跳过打分和排序，直接 fetch + 预加载图片
  const candidates = fetchCandidates(db, {
    itemIds: uniqueIds,
    includeImages: true,
    includeFinished: true,
    includeBlacklisted: true
  });
  const imageInfo = preloadImages(db, candidates.map((row) => row.id));
  const byId = new Map(candidates.map((row) => [row.id, toFeedItem(row, 0, imageInfo)]));
  return uniqueIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

function fetchCandidates(db: ReturnType<typeof getSqlite>, options: FeedOptions): CandidateRow[] {
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
    filters.push(`mi.id IN (${placeholders(ids)})`);
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

  // 保留派生表 JOIN 而非关联子查询，避免每行重复 COUNT（物化一次派生表更高效）
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

  return options.includeBlacklisted ? rows : rows.filter((row) => row.creator_blacklisted === 0);
}

function preloadInteractions(db: ReturnType<typeof getSqlite>, candidates: CandidateRow[]): PreloadedInteractions {
  const empty: PreloadedInteractions = {
    item: new Map(),
    creator: new Map(),
    category: new Map(),
    tag: new Map()
  };
  if (candidates.length === 0) return empty;

  const itemIds = candidates.map((c) => c.id);
  const creatorIds = [...new Set(candidates.map((c) => c.creator_id).filter((id): id is string => id !== null))];
  const categoryIds = [...new Set(candidates.map((c) => c.category_id).filter((id): id is string => id !== null))];

  const item = groupInteractions(db.prepare(`
    SELECT target_id, kind, value, created_at FROM interactions
    WHERE target_type = 'item' AND target_id IN (${placeholders(itemIds)})
  `).all(...itemIds) as InteractionRowWithTarget[]);

  const creator = creatorIds.length > 0
    ? groupInteractions(db.prepare(`
        SELECT target_id, kind, value, created_at FROM interactions
        WHERE target_type = 'creator' AND target_id IN (${placeholders(creatorIds)})
      `).all(...creatorIds) as InteractionRowWithTarget[])
    : new Map<string, InteractionRow[]>();

  const category = categoryIds.length > 0
    ? groupInteractions(db.prepare(`
        SELECT target_id, kind, value, created_at FROM interactions
        WHERE target_type = 'category' AND target_id IN (${placeholders(categoryIds)})
      `).all(...categoryIds) as InteractionRowWithTarget[])
    : new Map<string, InteractionRow[]>();

  const tagRows = db.prepare(`
    SELECT mt.media_item_id AS item_id, i.kind, i.value, i.created_at, mt.source, mt.sort_order AS sortOrder
    FROM media_tags mt
    JOIN interactions i ON i.target_type = 'tag' AND i.target_id = mt.tag_id
    WHERE mt.media_item_id IN (${placeholders(itemIds)})
  `).all(...itemIds) as TagInteractionRow[];
  const tag = new Map<string, TagInteractionRow[]>();
  for (const row of tagRows) {
    const list = tag.get(row.item_id) ?? [];
    list.push(row);
    tag.set(row.item_id, list);
  }

  return { item, creator, category, tag };
}

function preloadImages(db: ReturnType<typeof getSqlite>, itemIds: string[]): PreloadedImages {
  const map: PreloadedImages = new Map();
  if (itemIds.length === 0) return map;

  const placeholderList = placeholders(itemIds);
  // 窗口函数取每 item 前 9 张（按 sort_index 升序），避免逐 item LIMIT 查询
  const imageRows = db.prepare(`
    SELECT item_id, id, width, height, is_animated FROM (
      SELECT item_id, id, width, height, is_animated,
             ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY sort_index ASC) AS rn
      FROM media_images WHERE item_id IN (${placeholderList})
    ) WHERE rn <= 9
    ORDER BY item_id, rn
  `).all(...itemIds) as PreviewImageRow[];
  for (const row of imageRows) {
    const entry = map.get(row.item_id) ?? { images: [], count: 0 };
    entry.images.push(row);
    map.set(row.item_id, entry);
  }

  const countRows = db.prepare(`
    SELECT item_id, COUNT(*) AS count FROM media_images
    WHERE item_id IN (${placeholderList})
    GROUP BY item_id
  `).all(...itemIds) as { item_id: string; count: number }[];
  for (const row of countRows) {
    const entry = map.get(row.item_id) ?? { images: [], count: 0 };
    entry.count = row.count;
    map.set(row.item_id, entry);
  }

  return map;
}

function scoreCandidate(row: CandidateRow, preloaded: PreloadedInteractions, seed = "home"): number {
  const itemWeight = sumInteractions(preloaded.item.get(row.id) ?? []);
  const creatorWeight = row.creator_id ? sumInteractions(preloaded.creator.get(row.creator_id) ?? []) : 0;
  const categoryWeight = row.category_id ? sumInteractions(preloaded.category.get(row.category_id) ?? []) : 0;
  const tagWeight = sumTagInteractions(preloaded.tag.get(row.id) ?? []);
  const ageBoost = Math.max(0, 1 - (Date.now() - Date.parse(dateFor(row))) / MS_PER_DAY / AGE_BOOST_WINDOW_DAYS);
  const exploration = seededRandom(`${seed}:${row.id}`) * EXPLORATION_WEIGHT;
  const imagePenalty = row.kind === "image" ? IMAGE_PENALTY : 0;

  return 1
    + itemWeight * WEIGHT_ITEM
    + creatorWeight * WEIGHT_CREATOR
    + categoryWeight * WEIGHT_CATEGORY
    + tagWeight * WEIGHT_TAG
    + ageBoost
    + exploration
    + imagePenalty;
}

function sumInteractions(rows: InteractionRow[]): number {
  return rows.reduce((score, row) => score + kindWeight(row.kind, row.value, row.created_at), 0);
}

function sumTagInteractions(rows: TagInteractionRow[]): number {
  return rows.reduce((score, row) => score + kindWeight(row.kind, row.value, row.created_at) * tagPlacementWeight(row.source, row.sortOrder), 0);
}

function kindWeight(kind: InteractionKind, value: number, createdAt: string): number {
  const parsed = Date.parse(createdAt);
  const decay = Number.isFinite(parsed) ? Math.exp(-((Date.now() - parsed) / MS_PER_DAY) / DECAY_HALF_LIFE_DAYS) : 1;
  switch (kind) {
    case "coin":
      return value * KIND_COIN * decay;
    case "favorite":
      return value * KIND_FAVORITE * decay;
    case "like":
      return value * KIND_LIKE * decay;
    case "finish":
      return value * KIND_FINISH * decay;
    case "watch":
      return value * KIND_WATCH * decay;
    case "dislike":
      return -value * KIND_DISLIKE * decay;
    case "blacklist_up":
      // blacklist_up 已通过候选过滤排除，正向加权无意义，返 0 是运行时容错
      return 0;
    default:
      // exhaustiveness: InteractionKind 已全覆盖，新增 kind 时必须在此显式处理
      return 0;
  }
}

function tagPlacementWeight(source: "legacy" | "category" | "creator" | "content", sortOrder: number): number {
  const sourceBoost = source === "content" ? TAG_SOURCE_BOOST_CONTENT
    : source === "creator" ? TAG_SOURCE_BOOST_CREATOR
    : source === "category" ? TAG_SOURCE_BOOST_CATEGORY
    : TAG_SOURCE_BOOST_LEGACY;
  const positionBoost = Math.max(TAG_POSITION_FLOOR, 1 - Math.max(0, sortOrder) * TAG_POSITION_DECAY);
  return sourceBoost * positionBoost;
}

function dateFor(row: CandidateRow): string {
  return row.content_published_at ?? row.file_modified_at ?? row.first_seen_at;
}

function diversityRerank(scored: ScoredCandidate[]): ScoredCandidate[] {
  // 配额动态化：小结果集放宽（最少 1），大结果集按 15% 收紧
  const cap = Math.max(1, Math.floor(scored.length * DIVERSITY_CAP_RATIO));
  const result: ScoredCandidate[] = [];
  const deferred: ScoredCandidate[] = [];
  const creatorCount = new Map<string, number>();

  const violates = (creatorId: string | null): boolean => {
    if (creatorId === null) return false;
    const len = result.length;
    if (len >= 2 && result[len - 1].row.creator_id === creatorId && result[len - 2].row.creator_id === creatorId) {
      return true;
    }
    if ((creatorCount.get(creatorId) ?? 0) >= cap) {
      return true;
    }
    return false;
  };

  const add = (item: ScoredCandidate) => {
    result.push(item);
    if (item.row.creator_id !== null) {
      creatorCount.set(item.row.creator_id, (creatorCount.get(item.row.creator_id) ?? 0) + 1);
    }
  };

  for (const item of scored) {
    if (violates(item.row.creator_id)) {
      // 保留原 score：true relevance 没变，只是位置延后（不再人为 * 0.65 压低）
      deferred.push(item);
    } else {
      add(item);
    }
  }

  while (deferred.length > 0) {
    let added = false;
    const remaining: ScoredCandidate[] = [];
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

function precomputeShuffle(scored: ScoredCandidate[], seed?: string): ScoredCandidate[] {
  // 预计算每个 item 的随机值再排序，避免比较器内重复调用 seededRandom
  const withRandom = scored.map((item) => ({ item, r: seededRandom(`${seed}:${item.row.id}`) }));
  withRandom.sort((a, b) => a.r - b.r);
  return withRandom.map(({ item }) => item);
}

function toFeedItem(row: CandidateRow, score: number, imageInfo: PreloadedImages): FeedItem {
  const entry = imageInfo.get(row.id) ?? { images: [], count: 0 };
  const previewImages = entry.images;
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
    displayDate: dateFor(row),
    postExcerpt: row.post_body ? excerpt(row.post_body) : row.description ? excerpt(row.description) : null,
    playable: row.part_count > 0,
    previewPartId: row.preview_part_id,
    imageCount: entry.count,
    previewImages: previewImages.map(({ id, width, height, is_animated }) => ({
      id,
      width,
      height,
      is_animated,
      isAnimated: Boolean(is_animated),
      thumbnailUrl: `/media/images/${id}/thumbnail`,
      originalUrl: `/media/images/${id}/original`
    })),
    partCount: row.part_count,
    coverIsAnimated: row.kind === "image" && previewImages[0] ? Boolean(previewImages[0].is_animated) : false,
    score
  };
}

function excerpt(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 220 ? `${normalized.slice(0, 220)}…` : normalized;
}

function seededRandom(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

function placeholders(ids: string[]): string {
  return ids.map(() => "?").join(", ");
}

function groupInteractions(rows: InteractionRowWithTarget[]): Map<string, InteractionRow[]> {
  const map = new Map<string, InteractionRow[]>();
  for (const row of rows) {
    const list = map.get(row.target_id) ?? [];
    list.push({ kind: row.kind, value: row.value, created_at: row.created_at });
    map.set(row.target_id, list);
  }
  return map;
}
