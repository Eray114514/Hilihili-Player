import type { DirectoryEntry, FeedItem, Library, Reaction, ScanRun, ThumbnailStatus } from "@hilihili/shared";

function getApiBase() {
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

export const apiBase = getApiBase();

export function apiUrl(path: string) {
  return `${apiBase}${path}`;
}

export function assetUrl(path: string | null) {
  return path ? `${apiBase}${path}` : null;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
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

export async function deleteJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export type FeedResponse = { items: FeedItem[] };
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
};
export type ActivityResponse = {
  history: ActivityEntry[];
  continueWatching: ActivityEntry[];
  completed: ActivityEntry[];
  recentLikes: ActivityEntry[];
  stats: { history: number; completed: number; likes: number };
};
export type Category = { id: string; name: string; itemCount: number };
export type Creator = { id: string; name: string; alias: string | null; categoryName: string; itemCount: number };

export type ItemImage = {
  id: string;
  sortIndex: number;
  width: number | null;
  height: number | null;
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
    categoryName: string;
    creatorName: string;
    creatorAlias: string | null;
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
  };
  parts: PartDetail[];
  images: ItemImage[];
  tags: string[];
  comments: { id: string; body: string; atSeconds: number | null; createdAt: string }[];
  related: FeedItem[];
};
