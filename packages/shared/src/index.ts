export const videoExtensions = [".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".flv"] as const;
export const imageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"] as const;

export type MediaKind = "video" | "image";
export type InteractionKind = "like" | "dislike" | "watch" | "finish" | "blacklist_up";
export type StructureStatus = "standard" | "fallback";

export type FeedItem = {
  id: string;
  kind: MediaKind;
  title: string;
  categoryName: string;
  creatorName: string;
  coverUrl: string | null;
  firstSeenAt: string;
  score?: number;
  partCount?: number;
};

export type MediaPart = {
  id: string;
  itemId: string;
  title: string;
  partIndex: number;
  path: string;
  sizeBytes: number;
};

export type Library = {
  id: string;
  name: string;
  rootPath: string;
  enabled: boolean;
  createdAt: string;
};

export type DirectoryEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

export function isVideoPath(pathname: string) {
  return videoExtensions.some((extension) => pathname.toLowerCase().endsWith(extension));
}

export function isImagePath(pathname: string) {
  return imageExtensions.some((extension) => pathname.toLowerCase().endsWith(extension));
}
