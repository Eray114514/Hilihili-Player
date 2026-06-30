"use client";

import { ArrowLeft, Bookmark, BookmarkPlus, Clock3, Folder, Trash2 } from "lucide-react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type FormEvent } from "react";
import { ApiImage } from "@/components/ApiImage";
import { AppShell, EmptyState } from "@/components/AppShell";
import { assetUrl, deleteJson, getJson, postJson, type FavoriteFolder } from "@/lib/api";
import { slideUp } from "@/lib/motion";
import type { FeedItem } from "@hilihili/shared";

export default function FavoritesPage() {
  const [folders, setFolders] = useState<FavoriteFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState<FavoriteFolder | null>(null);
  const [items, setItems] = useState<{ item: FeedItem; favoritedAt: string; folderId: string }[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    void getJson<{ folders: FavoriteFolder[] }>("/me/favorites")
      .then((response) => {
        if (ignore) return;
        setFolders(response.folders);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    if (!activeFolder) return;
    let ignore = false;
    void getJson<{ items: { item: FeedItem; favoritedAt: string; folderId: string }[] }>(
      `/me/favorites/folders/${activeFolder.id}/items`
    ).then((response) => {
      if (!ignore) setItems(response.items);
    });
    return () => { ignore = true; };
  }, [activeFolder]);

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    const response = await postJson<{ id: string; name: string; createdAt: string }>(
      "/me/favorites/folders",
      { name }
    );
    setFolders((current) => [
      ...current,
      { id: response.id, name: response.name, itemCount: 0, createdAt: response.createdAt }
    ]);
    setNewFolderName("");
  }

  async function deleteFolder(folder: FavoriteFolder) {
    if (!window.confirm(`确定删除收藏夹「${folder.name}」？夹内 ${folder.itemCount} 个收藏也会被移除。`)) return;
    await deleteJson(`/me/favorites/folders/${folder.id}`);
    setFolders((current) => current.filter((folderItem) => folderItem.id !== folder.id));
    if (activeFolder?.id === folder.id) setActiveFolder(null);
  }

  async function removeItem(itemId: string) {
    if (!activeFolder) return;
    setBusyId(itemId);
    try {
      await deleteJson(`/items/${itemId}/favorites?folderId=${activeFolder.id}`);
      setItems((current) => current.filter((entry) => entry.item.id !== itemId));
      setFolders((current) =>
        current.map((folder) =>
          folder.id === activeFolder.id ? { ...folder, itemCount: Math.max(0, folder.itemCount - 1) } : folder
        )
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell>
      {activeFolder ? (
        <>
          <button className="secondary-button mb-5" onClick={() => setActiveFolder(null)}>
            <ArrowLeft size={16} /> 返回收藏夹
          </button>
          <section className="mb-6">
            <p className="text-sm font-medium text-[var(--accent)]">收藏夹</p>
            <h1 className="mt-1 text-2xl font-semibold md:text-3xl">{activeFolder.name}</h1>
            <p className="mt-2 text-sm text-white/48">{items.length} 个收藏</p>
          </section>
          {items.length === 0 ? (
            <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-white/12 bg-white/[0.02] text-center">
              <div>
                <Clock3 className="mx-auto text-white/25" size={34} />
                <p className="mt-3 font-medium">这个收藏夹还是空的</p>
                <p className="mt-1 text-sm text-white/42">去观看页把视频收藏到这里吧。</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence initial={false}>
                {items.map((entry) => (
                  <motion.div
                    key={entry.item.id}
                    layout
                    variants={slideUp}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                  >
                    <FavoriteCard
                      item={entry.item}
                      favoritedAt={entry.favoritedAt}
                      busy={busyId === entry.item.id}
                      onRemove={() => void removeItem(entry.item.id)}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      ) : (
        <>
          <section className="mb-7">
            <p className="text-sm font-medium text-[var(--accent)]">我的 Hilihili</p>
            <h1 className="mt-1 text-2xl font-semibold md:text-3xl">收藏夹</h1>
            <p className="mt-2 text-sm text-white/48">把想反复看的视频收进来，按夹分类整理。</p>
          </section>

          <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="收藏夹" value={folders.length} />
            <Stat label="收藏" value={folders.reduce((sum, folder) => sum + folder.itemCount, 0)} />
          </section>

          <form className="mb-5 flex gap-2" onSubmit={createFolder}>
            <input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              className="field min-w-0 flex-1"
              placeholder="新建收藏夹，例如「周末看」"
              maxLength={50}
            />
            <button className="primary-button">
              <BookmarkPlus size={16} /> 新建
            </button>
          </form>

          {loading ? (
            <FavoritesSkeleton />
          ) : (
            <div className="animate-fade-in">
              {folders.length === 0 ? (
                <EmptyState
                  title="还没有收藏夹"
                  body="在观看页点击「收藏」按钮，第一个收藏夹会自动创建。"
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <AnimatePresence initial={false}>
                    {folders.map((folder) => (
                      <motion.div
                        key={folder.id}
                        layout
                        variants={slideUp}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        className="group relative rounded-xl border border-white/8 bg-white/[0.028] p-4 transition hover:border-[rgba(94,234,212,.25)] hover:bg-white/[0.04]"
                      >
                        <button className="block w-full text-left" onClick={() => setActiveFolder(folder)}>
                          <div className="flex items-center gap-3">
                            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
                              <Folder size={20} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-medium">{folder.name}</div>
                              <p className="mt-0.5 text-xs text-white/42">
                                {folder.itemCount} 个收藏 · {formatDate(folder.createdAt)}
                              </p>
                            </div>
                          </div>
                        </button>
                        <button
                          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg text-white/30 transition hover:bg-white/8 hover:text-[var(--danger)]"
                          aria-label="删除收藏夹"
                          onClick={() => void deleteFolder(folder)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

function FavoriteCard({
  item,
  favoritedAt,
  busy,
  onRemove
}: {
  item: FeedItem;
  favoritedAt: string;
  busy: boolean;
  onRemove: () => void;
}) {
  const cover = assetUrl(item.coverUrl);
  const href = item.playable ? `/watch/${item.id}` : `/dynamic/${item.id}`;
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-white/8 bg-white/[0.028] p-3 sm:flex-row sm:items-center">
      <Link
        href={href}
        className="group relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-white/5 sm:w-52"
      >
        {cover ? (
          <ApiImage src={cover} alt={item.title} fill sizes="208px" className="object-cover transition group-hover:scale-105" />
        ) : (
          <div className="grid h-full place-items-center text-white/30">
            <Bookmark size={30} />
          </div>
        )}
        {item.coverIsAnimated ? <span className="absolute left-1.5 top-1.5 rounded bg-black/72 px-1.5 py-0.5 text-[11px] font-medium text-white/88 backdrop-blur-sm">动图</span> : null}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={href} className="line-clamp-2 font-medium leading-6 hover:text-[var(--accent)]">
          {item.title}
        </Link>
        <p className="mt-1 truncate text-xs text-white/42">
          {item.creatorId ? <Link href={`/creator/${item.creatorId}`} className="hover:text-[var(--accent)]">{item.creatorName}</Link> : item.creatorName} · {item.categoryName}
        </p>
        <div className="mt-3 flex items-center gap-x-3 text-xs">
          <span className="text-[var(--accent)]">已收藏</span>
          <time className="text-white/32">{formatDate(favoritedAt)}</time>
        </div>
      </div>
      <div className="flex shrink-0 gap-2 sm:flex-col">
        <Link href={href} className="primary-button flex-1 justify-center sm:flex-none">
          观看
        </Link>
        <button
          disabled={busy}
          className="secondary-button flex-1 justify-center disabled:opacity-40 sm:flex-none"
          onClick={onRemove}
        >
          <Trash2 size={15} /> 移除
        </button>
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.035] p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-white/42">{label}</div>
    </div>
  );
}

function FavoritesSkeleton() {
  return (
    <div className="grid skeleton-shimmer grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="h-20 rounded-xl bg-white/[0.035]" />
      ))}
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
}
