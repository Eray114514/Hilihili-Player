import type { InteractionKind } from "@hilihili/shared";

export type AddLibraryBody = {
  name?: string;
  rootPath?: string;
};

export type InteractionBody = {
  kind?: InteractionKind;
  value?: number;
  positionSeconds?: number;
  durationSeconds?: number;
  partId?: string;
};

export type ActivityRow = {
  itemId: string;
  resumePartId: string | null;
  resumePartIndex: number | null;
  resumePartTitle: string | null;
  positionSeconds: number;
  durationSeconds: number | null;
  finished: number;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
  likedAt: string | null;
  coinedAt: string | null;
};

export type CommentBody = {
  body?: string;
  atSeconds?: number | null;
};

export type FavoriteFolderBody = {
  name?: string;
};

export type FavoriteItemBody = {
  folderId?: string;
};

export type TagBody = {
  name?: string;
};
