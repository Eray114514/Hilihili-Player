// Containers supported by the scanner. Formats that browsers cannot play
// natively are converted to an H.264/AAC MP4 stream by the media worker.
export const videoExtensions = [
  ".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi", ".flv",
  ".ts", ".m2ts", ".mts", ".mpg", ".mpeg", ".mpeg2",
  ".3gp", ".3g2", ".ogv", ".wmv", ".asf", ".vob", ".rm", ".rmvb"
] as const;
export const imageExtensions = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"] as const;

export type MediaKind = "video" | "image" | "post";
export type InteractionKind = "like" | "dislike" | "watch" | "finish" | "blacklist_up" | "coin" | "favorite";
export type StructureStatus = "standard" | "fallback";
export type ThumbnailStatus = "pending" | "ready" | "failed";
export type ScanStatus = "queued" | "running" | "complete" | "failed";
export type Reaction = "like" | "dislike" | null;

export type FeedItem = {
  id: string;
  kind: MediaKind;
  title: string;
  categoryName: string;
  creatorId: string | null;
  creatorName: string;
  creatorAlias: string | null;
  creatorAvatarUrl: string | null;
  coverUrl: string | null;
  thumbnailStatus: ThumbnailStatus;
  firstSeenAt: string;
  displayDate: string;
  postExcerpt: string | null;
  playable: boolean;
  previewPartId: string | null;
  imageCount: number;
  previewImages: FeedImage[];
  score?: number;
  partCount?: number;
};

export type FeedImage = {
  id: string;
  width: number | null;
  height: number | null;
  thumbnailUrl: string;
  originalUrl: string;
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

export type ScanRun = {
  id: string;
  libraryId: string | null;
  status: ScanStatus;
  message: string | null;
  startedAt: string;
  finishedAt: string | null;
  itemsIndexed: number;
  thumbnailsTotal: number;
  thumbnailsReady: number;
  thumbnailsFailed: number;
};

export type DirectoryEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

export type FavoriteFolder = {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type FavoriteEntry = {
  item: FeedItem;
  folderId: string;
  favoritedAt: string;
};

export function isVideoPath(pathname: string) {
  return videoExtensions.some((extension) => pathname.toLowerCase().endsWith(extension));
}

export function isImagePath(pathname: string) {
  return imageExtensions.some((extension) => pathname.toLowerCase().endsWith(extension));
}
