import type { DirectoryEntry, FeedItem, Library, Reaction, ScanRun, SearchHistoryItem, ThumbnailStatus } from "@hilihili/shared";

// 纯类型模块：只有 `export type`，被类型导入擦除后不进运行时图，
// 因此 Server Component 可以安全引用（原来的 @/lib/api 因为 import 了 useSWR 而做不到）。

export type { DirectoryEntry, FeedItem, Library, Reaction, ScanRun, SearchHistoryItem, ThumbnailStatus };

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
    postBody: string | null;
    description: string | null;
    categoryName: string;
    creatorName: string;
    creatorAlias: string | null;
    creatorAvatarUrl: string | null;
    categoryId: string | null;
    creatorId: string | null;
    firstSeenAt: string;
    thumbnailStatus: ThumbnailStatus;
    reaction: Reaction;
    creatorBlacklisted: number;
    resumePartId: string | null;
    resumePositionSeconds: number | null;
    contentPublishedAt: string | null;
    fileModifiedAt: string | null;
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