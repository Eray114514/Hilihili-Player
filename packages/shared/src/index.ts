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
  coverIsAnimated: boolean;
};

export type FeedImage = {
  id: string;
  width: number | null;
  height: number | null;
  thumbnailUrl: string;
  originalUrl: string;
  isAnimated: boolean;
};

export type MediaPart = {
  id: string;
  itemId: string;
  title: string;
  partIndex: number;
  path: string;
  sizeBytes: number;
  streamPath: string | null;
  streamSizeBytes: number | null;
  compatibilityStatus: "pending" | "ready" | "failed";
  compatibilityError: string | null;
  durationSeconds: number | null;
  fingerprint: string;
  previewSpritePath: string | null;
  previewSpriteCols: number | null;
  previewSpriteRows: number | null;
  previewSpriteInterval: number | null;
  previewThumbW: number | null;
  previewThumbH: number | null;
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
  itemsFailed: number;
  itemsSkipped: number;
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
};

export type FavoriteEntry = {
  item: FeedItem;
  folderId: string;
  favoritedAt: string;
};

export type SearchHistoryItem = { id: string; query: string; searchedAt: string };

// --- DB row types (mirror packages/db/src/schema.ts) ---

export type Creator = {
  id: string;
  name: string;
  alias: string | null;
  description: string | null;
  avatarPath: string | null;
  bannerPath: string | null;
  libraryId: string | null;
  categoryId: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type Category = {
  id: string;
  name: string;
  libraryId: string | null;
  createdAt: string;
};

export type MediaItem = {
  id: string;
  kind: MediaKind;
  title: string;
  postBody: string | null;
  description: string | null;
  libraryId: string;
  categoryId: string | null;
  creatorId: string | null;
  sourcePath: string;
  relativePath: string;
  folderPath: string | null;
  fingerprint: string;
  coverPath: string | null;
  generatedCoverPath: string | null;
  thumbnailStatus: ThumbnailStatus;
  thumbnailError: string | null;
  contentPublishedAt: string | null;
  fileModifiedAt: string | null;
  hidden: boolean;
  structureStatus: StructureStatus;
  firstSeenAt: string;
  updatedAt: string;
};

export type MediaImage = {
  id: string;
  itemId: string;
  path: string;
  sortIndex: number;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  fingerprint: string;
  thumbnailPath: string | null;
  isAnimated: boolean | null;
  frameCount: number | null;
  durationMs: number | null;
};

export type Tag = {
  id: string;
  name: string;
};

export type Interaction = {
  id: string;
  targetType: "item" | "creator" | "category" | "tag";
  targetId: string;
  kind: InteractionKind;
  value: number;
  createdAt: string;
};

export type Comment = {
  id: string;
  itemId: string;
  body: string;
  atSeconds: number | null;
  createdAt: string;
};

export type WatchProgress = {
  itemId: string;
  partId: string | null;
  positionSeconds: number;
  finished: boolean;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
};

export type ItemPreferences = {
  itemId: string;
  reaction: Reaction;
  coined: boolean;
  coinedAt: string | null;
  updatedAt: string;
};

export type CreatorPreferences = {
  creatorId: string;
  blacklisted: boolean;
  followed: boolean;
  followedAt: string | null;
  updatedAt: string;
};

export type CreatorMessage = {
  id: string;
  creatorId: string;
  itemId: string;
  createdAt: string;
  readAt: string | null;
};

export type MediaSubtitle = {
  id: string;
  partId: string;
  path: string;
  language: string;
  label: string;
  isDefault: boolean;
  sortIndex: number;
};

export function isVideoPath(pathname: string) {
  return videoExtensions.some((extension) => pathname.toLowerCase().endsWith(extension));
}

export function isImagePath(pathname: string) {
  return imageExtensions.some((extension) => pathname.toLowerCase().endsWith(extension));
}
