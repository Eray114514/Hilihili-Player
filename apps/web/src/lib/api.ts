import type { DirectoryEntry, FeedItem, Library, Reaction, ScanRun, SearchHistoryItem, ThumbnailStatus } from "@hilihili/shared";
import useSWR, { type SWRConfiguration } from "swr";

export function getApiBase() {
  if (typeof window !== "undefined") {
    // 浏览器端沿用当前主机，端口取公开配置，兼容局域网访问与安全演示。
    const { protocol, hostname } = window.location;
    const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (configured) {
      try {
        const url = new URL(configured);
        return `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}`;
      } catch {
        // Fall through to the default port when the configured URL is invalid.
      }
    }
    return `${protocol}//${hostname}:4141`;
  }
  // 服务端渲染：通过环境变量访问 API（Docker Compose 网络内使用服务名）
  return process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4141";
}

export function apiUrl(path: string) {
  return `${getApiBase()}${path}`;
}

export function assetUrl(path: string | null) {
  return path ? `${getApiBase()}${path}` : null;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

// SWR fetcher：复用 getJson 的错误处理，但不强制 cache: "no-store"
// （SWR 自己管缓存去重，底层 fetch 走默认 HTTP 缓存策略）
export async function apiFetcher<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

// 通用 useApi hook：path 为 null 时不发请求（用于条件请求）
export function useApi<T>(path: string | null, options?: SWRConfiguration<T>) {
  return useSWR<T>(path, apiFetcher, options);
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export async function putJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export type DeleteJsonOptions = { ignoreNotFound?: boolean };

// 传 `ignoreNotFound: true` 时，404 返回 null 而非抛错（用于乐观删除场景）；
// 其他情况行为不变，仍抛错并保留 Promise<T> 返回类型。
export function deleteJson<T>(path: string, options: { ignoreNotFound: true }): Promise<T | null>;
export function deleteJson<T>(path: string, options?: DeleteJsonOptions): Promise<T>;
export async function deleteJson<T>(path: string, options?: DeleteJsonOptions): Promise<T | null> {
  const response = await fetch(apiUrl(path), { method: "DELETE" });
  if (!response.ok) {
    if (response.status === 404 && options?.ignoreNotFound) {
      return null;
    }
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export type FeedResponse = { items: FeedItem[] };
export type SearchResponse = { query: string; items: FeedItem[]; total: number; hasMore: boolean };
export type LibrariesResponse = { libraries: Library[] };
export type FsRootsResponse = { roots: DirectoryEntry[] };
export type FsListResponse = { path: string; parent: string | null; entries: DirectoryEntry[] };
export type ScanRunsResponse = { runs: ScanRun[] };
export type ActivityEntry = {
  item: FeedItem;
  resumePartId: string | null;
  resumePartIndex: number | null;
  resumePartTitle: string | null;
  positionSeconds: number;
  durationSeconds: number | null;
  progressPercent: number;
  finished: boolean;
  liked: boolean;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  likedAt: string | null;
  coinedAt: string | null;
};
export type ActivityResponse = {
  history: ActivityEntry[];
  continueWatching: ActivityEntry[];
  completed: ActivityEntry[];
  recentLikes: ActivityEntry[];
  recentCoins: ActivityEntry[];
  stats: { history: number; completed: number; likes: number; coins: number };
};
export type Category = { id: string; name: string; itemCount: number };
export type Creator = { id: string; name: string; alias: string | null; description: string | null; categoryName: string; itemCount: number };
export type CreatorDetail = {
  creator: { id: string; name: string; alias: string | null; description: string | null; avatarUrl: string | null; bannerUrl: string | null; followed: number; blacklisted: number };
  stats: { itemCount: number; videoCount: number; postCount: number; imageCount: number };
  categories: Category[];
};
export type CreatorItemsResponse = { items: FeedItem[]; total: number; hasMore: boolean };
export type MessageResponse = {
  messages: { id: string; itemId: string; creatorId: string; createdAt: string; readAt: string | null; item: FeedItem }[];
  total: number;
  unreadCount: number;
  hasMore: boolean;
};

export type ItemImage = {
  id: string;
  sortIndex: number;
  width: number | null;
  height: number | null;
  isAnimated: boolean;
  frameCount: number | null;
  durationMs: number | null;
  thumbnailUrl: string;
  originalUrl: string;
};

export type SubtitleTrack = {
  id: string;
  language: string;
  label: string;
  isDefault: boolean;
  url: string;
};

export type PartDetail = {
  id: string;
  title: string;
  partIndex: number;
  sizeBytes: number;
  durationSeconds: number | null;
  compatibilityStatus: "pending" | "ready" | "failed";
  compatibilityError: string | null;
  previewSpritePath: string | null;
  previewSpriteCols: number | null;
  previewSpriteRows: number | null;
  previewSpriteInterval: number | null;
  previewThumbW: number | null;
  previewThumbH: number | null;
  subtitles: SubtitleTrack[];
};

export type ItemDetail = {
  item: {
    id: string;
    kind: "video" | "image" | "post";
    title: string;
    post_body: string | null;
    description: string | null;
    categoryName: string;
    creatorName: string;
    creatorAlias: string | null;
    creatorAvatarUrl: string | null;
    category_id: string | null;
    creator_id: string | null;
    first_seen_at: string;
    thumbnail_status: ThumbnailStatus;
    reaction: Reaction;
    creatorBlacklisted: number;
    resumePartId: string | null;
    resumePositionSeconds: number | null;
    content_published_at: string | null;
    file_modified_at: string | null;
    coined: number;
    coinedAt: string | null;
  };
  parts: PartDetail[];
  images: ItemImage[];
  tags: string[];
  tagDetails: { id: string; name: string; source: "legacy" | "category" | "creator" | "content"; sortOrder: number }[];
  comments: { id: string; body: string; atSeconds: number | null; createdAt: string }[];
  related: FeedItem[];
  favoritedFolderIds: string[];
};

export type FavoriteFolder = {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
};

export type FavoriteListResponse = {
  folders: FavoriteFolder[];
};

export type FavoriteFolderItemsResponse = {
  items: { item: FeedItem; favoritedAt: string; folderId: string }[];
};

export async function getSearchHistory(): Promise<{ items: SearchHistoryItem[] }> {
  return getJson<{ items: SearchHistoryItem[] }>("/me/search-history");
}

export async function clearSearchHistory(): Promise<void> {
  await deleteJson<{ ok: boolean }>("/me/search-history");
}

export async function deleteSearchHistory(id: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(`/me/search-history/${encodeURIComponent(id)}`);
}
