import type { DirectoryEntry, FeedItem, Library, Reaction, ScanRun, ThumbnailStatus } from "@hilihili/shared";

function getApiBase() {
  if (typeof window !== "undefined") {
    // 浏览器端：使用当前页面的 host，API 端口固定为 4141
    const { protocol, hostname } = window.location;
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

export type FeedResponse = { items: FeedItem[] };
export type LibrariesResponse = { libraries: Library[] };
export type FsRootsResponse = { roots: DirectoryEntry[] };
export type FsListResponse = { path: string; parent: string | null; entries: DirectoryEntry[] };
export type ScanRunsResponse = { runs: ScanRun[] };
export type Category = { id: string; name: string; itemCount: number };
export type Creator = { id: string; name: string; categoryName: string; itemCount: number };

export type PartDetail = {
  id: string;
  title: string;
  partIndex: number;
  sizeBytes: number;
  durationSeconds: number | null;
  previewSpritePath: string | null;
  previewSpriteCols: number | null;
  previewSpriteRows: number | null;
  previewSpriteInterval: number | null;
  previewThumbW: number | null;
  previewThumbH: number | null;
};

export type ItemDetail = {
  item: {
    id: string;
    kind: "video" | "image";
    title: string;
    categoryName: string;
    creatorName: string;
    category_id: string | null;
    creator_id: string | null;
    first_seen_at: string;
    thumbnail_status: ThumbnailStatus;
    reaction: Reaction;
    creatorBlacklisted: number;
    resumePartId: string | null;
    resumePositionSeconds: number | null;
  };
  parts: PartDetail[];
  comments: { id: string; body: string; atSeconds: number | null; createdAt: string }[];
  related: FeedItem[];
};
