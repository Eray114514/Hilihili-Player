import type { DirectoryEntry, FeedItem, Library } from "@hilihili/shared";

export const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4141";

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

export type FeedResponse = { items: FeedItem[] };
export type LibrariesResponse = { libraries: Library[] };
export type FsRootsResponse = { roots: DirectoryEntry[] };
export type FsListResponse = { path: string; parent: string | null; entries: DirectoryEntry[] };
export type Category = { id: string; name: string; itemCount: number };
export type Creator = { id: string; name: string; categoryName: string; itemCount: number };

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
  };
  parts: { id: string; title: string; partIndex: number; sizeBytes: number }[];
  comments: { id: string; body: string; atSeconds: number | null; createdAt: string }[];
  related: FeedItem[];
};
