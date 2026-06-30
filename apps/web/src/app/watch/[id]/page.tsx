"use client";

import { Ban, Check, CircleDollarSign, LoaderCircle, MoreHorizontal, Plus, Send, Star, ThumbsDown, ThumbsUp, X } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { FormEvent, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { KeyedMutator } from "swr";
import { AppShell } from "@/components/AppShell";
import { ErrorFallback } from "@/components/ErrorFallback";
import { CompactVideoCard } from "@/components/VideoCard";
import { CreatorAvatar } from "@/components/CreatorAvatar";
import { deleteJson, patchJson, postJson, putJson, useApi, type FavoriteFolder, type ItemDetail } from "@/lib/api";
import { fadeIn, pop, scaleIn, slideDown } from "@/lib/motion";
import type { Reaction } from "@hilihili/shared";

// VideoPlayer 是重型组件（motion/react + player/ 子组件 + 字幕逻辑），仅在 watch 页用到。
// 用 next/dynamic 拆成单独 chunk 并 ssr: false（纯客户端组件，无需 SSR）。
const VideoPlayer = dynamic(() => import("@/components/VideoPlayer").then((m) => m.VideoPlayer), {
  ssr: false,
  loading: () => <div className="grid aspect-video place-items-center rounded-xl bg-white/5 text-white/55"><LoaderCircle className="animate-spin" size={32} /></div>
});

export default function WatchPage() {
  const params = useParams<{ id: string }>();
  // 关 focus revalidate，避免用户看视频时背景刷新重置本地 state
  const { data: detail, error, mutate: mutateDetail } = useApi<ItemDetail>(`/items/${params.id}`, { revalidateOnFocus: false });
  const { data: foldersData, mutate: mutateFolders } = useApi<{ folders: FavoriteFolder[] }>("/me/favorites");

  return (
    <AppShell wide>
      {!detail ? (error ? <WatchFailed /> : <WatchSkeleton />) : (
        <WatchContent
          key={detail.item.id}
          detail={detail}
          mutateDetail={mutateDetail}
          folders={foldersData?.folders ?? []}
          mutateFolders={mutateFolders}
        />
      )}
    </AppShell>
  );
}

type WatchContentProps = {
  detail: ItemDetail;
  mutateDetail: KeyedMutator<ItemDetail>;
  folders: FavoriteFolder[];
  mutateFolders: KeyedMutator<{ folders: FavoriteFolder[] }>;
};

function WatchContent({ detail, mutateDetail, folders, mutateFolders }: WatchContentProps) {
  // 本地 state 用 useState 初始化器从 detail 取初值（keyed remount 时重新初始化）
  const [comment, setComment] = useState("");
  const [activePartIndex, setActivePartIndex] = useState(() => {
    const resumeIndex = detail.parts.findIndex((part) => part.id === detail.item.resumePartId);
    return resumeIndex >= 0 ? resumeIndex : 0;
  });
  const [sideTab, setSideTab] = useState<"parts" | "related">(() => detail.parts.length > 1 ? "parts" : "related");
  const [reaction, setReaction] = useState<Reaction>(detail.item.reaction);
  const [blacklisted, setBlacklisted] = useState(Boolean(detail.item.creatorBlacklisted));
  const [coined, setCoined] = useState(Boolean(detail.item.coined));
  const [favoritedFolderIds, setFavoritedFolderIds] = useState<string[]>(detail.favoritedFolderIds);
  const [newFolderName, setNewFolderName] = useState("");
  const [favoritePanelOpen, setFavoritePanelOpen] = useState(false);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [tagBusy, setTagBusy] = useState<string | null>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  async function toggleReaction(next: Exclude<Reaction, null>) {
    const value = reaction === next ? null : next;
    const previous = reaction;
    setReaction(value);
    try {
      await putJson(`/items/${detail.item.id}/reaction`, { reaction: value });
    } catch (error) {
      setReaction(previous);
      console.error("[watch] 保存点赞失败", error);
    }
  }

  async function toggleBlacklist() {
    const creatorId = detail.item.creator_id;
    if (!creatorId) return;
    const next = !blacklisted;
    setBlacklisted(next);
    await putJson(`/creators/${creatorId}/blacklist`, { blacklisted: next });
  }

  async function toggleCoin() {
    const next = !coined;
    setCoined(next);
    try {
      const response = await patchJson<{ coined: boolean }>(`/items/${detail.item.id}/coin`, {});
      setCoined(response.coined);
    } catch (error) {
      setCoined(!next);
      console.error("[watch] 保存投币失败", error);
    }
  }

  async function toggleFavorite(folderId: string) {
    const isFavorited = favoritedFolderIds.includes(folderId);
    setFavoriteBusyId(folderId);
    try {
      if (isFavorited) {
        setFavoritedFolderIds((current) => current.filter((id) => id !== folderId));
        mutateFolders((current) => current ? { folders: current.folders.map((folder) => folder.id === folderId ? { ...folder, itemCount: Math.max(0, folder.itemCount - 1) } : folder) } : current, { revalidate: false });
        await deleteJson(`/items/${detail.item.id}/favorites?folderId=${folderId}`, { ignoreNotFound: true });
      } else {
        setFavoritedFolderIds((current) => current.includes(folderId) ? current : [...current, folderId]);
        mutateFolders((current) => current ? { folders: current.folders.map((folder) => folder.id === folderId ? { ...folder, itemCount: folder.itemCount + 1 } : folder) } : current, { revalidate: false });
        await postJson(`/items/${detail.item.id}/favorites`, { folderId });
      }
    } catch (error) {
      if (isFavorited) {
        setFavoritedFolderIds((current) => current.includes(folderId) ? current : [...current, folderId]);
        mutateFolders((current) => current ? { folders: current.folders.map((folder) => folder.id === folderId ? { ...folder, itemCount: folder.itemCount + 1 } : folder) } : current, { revalidate: false });
      } else {
        setFavoritedFolderIds((current) => current.filter((id) => id !== folderId));
        mutateFolders((current) => current ? { folders: current.folders.map((folder) => folder.id === folderId ? { ...folder, itemCount: Math.max(0, folder.itemCount - 1) } : folder) } : current, { revalidate: false });
      }
      console.error("[watch] 保存收藏失败", error);
    } finally {
      setFavoriteBusyId(null);
    }
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    const response = await postJson<{ id: string; name: string; createdAt: string }>("/me/favorites/folders", { name });
    mutateFolders((current) => current ? { folders: [...current.folders, { id: response.id, name: response.name, itemCount: 1, createdAt: response.createdAt }] } : current, { revalidate: false });
    setFavoritedFolderIds((current) => current.includes(response.id) ? current : [...current, response.id]);
    setNewFolderName("");
    try {
      await postJson(`/items/${detail.item.id}/favorites`, { folderId: response.id });
    } catch (error) {
      mutateFolders((current) => current ? { folders: current.folders.map((folder) => folder.id === response.id ? { ...folder, itemCount: 0 } : folder) } : current, { revalidate: false });
      setFavoritedFolderIds((current) => current.filter((id) => id !== response.id));
      console.error("[watch] 保存新收藏夹失败", error);
    }
  }

  async function addTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = tagDraft.trim();
    if (!name) return;
    setTagBusy("add");
    try {
      const response = await postJson<{ tags: ItemDetail["tagDetails"] }>(`/items/${detail.item.id}/tags`, { name });
      mutateDetail((current) => current ? { ...current, tags: response.tags.map((tag) => tag.name), tagDetails: response.tags } : current, { revalidate: false });
      setTagDraft("");
    } catch (error) {
      console.error("[watch] 添加标签失败", error);
    } finally {
      setTagBusy(null);
    }
  }

  async function removeTag(tagId: string) {
    setTagBusy(tagId);
    try {
      const response = await deleteJson<{ tags: ItemDetail["tagDetails"] }>(`/items/${detail.item.id}/tags/${tagId}`, { ignoreNotFound: true });
      if (response) {
        mutateDetail((current) => current ? { ...current, tags: response.tags.map((tag) => tag.name), tagDetails: response.tags } : current, { revalidate: false });
      } else {
        // 404：标签已被服务端删除，本地同步移除
        mutateDetail((current) => {
          if (!current) return current;
          const remaining = current.tagDetails.filter((tag) => tag.id !== tagId);
          return { ...current, tagDetails: remaining, tags: remaining.map((tag) => tag.name) };
        }, { revalidate: false });
      }
    } catch (error) {
      console.error("[watch] 删除标签失败", error);
    } finally {
      setTagBusy(null);
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comment.trim()) return;
    await postJson(`/items/${detail.item.id}/comments`, { body: comment });
    setComment("");
    // 重新校验 detail（替代原 setDetail(await getJson(...))）。
    // 本地 state（reaction 等）不变，因为它们是独立 state，不依赖 detail 重新初始化
    await mutateDetail();
  }

  const activePart = detail.parts[activePartIndex];
  const tagDetails = detail.tagDetails ?? [];
  const description = detail.item.post_body ?? detail.item.description ?? null;

  return (
    <motion.div variants={fadeIn} initial="hidden" animate="visible" className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <main className="min-w-0">
        <VideoPlayer
          // 切换 part 时通过 key 让整个组件 remount，所有内部 state 自然重置，
          // 消除原 VideoPlayer 内 render 期 setState 重置 part 状态的反模式。
          key={activePart?.id}
          itemId={detail.item.id}
          part={activePart}
          resumePosition={activePart?.id === detail.item.resumePartId ? detail.item.resumePositionSeconds ?? 0 : 0}
          isLastPart={activePartIndex === detail.parts.length - 1}
          onEnded={() => { if (activePartIndex < detail.parts.length - 1) setActivePartIndex((value) => value + 1); }}
        />

        <section className="border-b border-white/8 py-4">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="min-w-0"><h1 className="text-xl font-semibold leading-8 md:text-2xl">{detail.item.title}</h1><div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/42"><Link href={detail.item.category_id ? `/category/${detail.item.category_id}` : "#"} className="hover:text-[var(--accent)]">{detail.item.categoryName}</Link><span>·</span><time>{formatDate(detail.item.content_published_at ?? detail.item.file_modified_at ?? detail.item.first_seen_at)}</time>{detail.parts.length > 1 ? <><span>·</span><span>{detail.parts.length} P</span></> : null}</div></div>
            <Link href={detail.item.creator_id ? `/creator/${detail.item.creator_id}` : "#"} className="flex shrink-0 items-center gap-2.5 rounded-lg p-1.5 pr-2.5 transition hover:bg-white/[0.055]"><CreatorAvatar creatorId={null} name={detail.item.creatorName} avatarUrl={detail.item.creatorAvatarUrl} size="sm" /><span className="min-w-0"><span className="block max-w-44 truncate text-sm font-semibold text-white/88">{detail.item.creatorName}</span>{detail.item.creatorAlias ? <span className="block max-w-44 truncate text-xs text-white/42">{detail.item.creatorAlias}</span> : <span className="block text-xs text-white/38">UP 主</span>}</span></Link>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button className={`action-button bili-action ${reaction === "like" ? "active" : ""}`} onClick={() => void toggleReaction("like")}><motion.span className="inline-flex" variants={pop} initial={false} animate={reaction === "like" ? "pop" : "rest"}><ThumbsUp size={19} fill={reaction === "like" ? "currentColor" : "none"} /></motion.span> 喜欢</button>
            <button className={`action-button ${reaction === "dislike" ? "active" : ""}`} onClick={() => void toggleReaction("dislike")}><motion.span className="inline-flex" variants={pop} initial={false} animate={reaction === "dislike" ? "pop" : "rest"}><ThumbsDown size={18} fill={reaction === "dislike" ? "currentColor" : "none"} /></motion.span> 不喜欢</button>
            <button className={`action-button bili-action ${coined ? "active" : ""}`} onClick={() => void toggleCoin()}><motion.span className="inline-flex" variants={pop} initial={false} animate={coined ? "pop" : "rest"}><CircleDollarSign size={19} fill="none" strokeWidth={coined ? 2.5 : 2} /></motion.span> 投币</button>
            <div className="relative">
              <button className={`action-button bili-action ${favoritedFolderIds.length > 0 ? "active" : ""}`} onClick={() => setFavoritePanelOpen((open) => !open)} aria-expanded={favoritePanelOpen} aria-label="收藏"><motion.span className="inline-flex" variants={pop} initial={false} animate={favoritedFolderIds.length > 0 ? "pop" : "rest"}><Star size={19} fill={favoritedFolderIds.length > 0 ? "currentColor" : "none"} /></motion.span> 收藏</button>
              <AnimatePresence>{favoritePanelOpen ? (
                <motion.div variants={slideDown} initial="hidden" animate="visible" exit="exit" className="absolute right-0 top-11 z-20 w-72 rounded-lg border border-white/10 bg-[#1a1c22] p-2 shadow-2xl">
                  <div className="max-h-64 space-y-1 overflow-y-auto">
                    {folders.length === 0 ? (
                      <p className="px-3 py-3 text-sm text-white/40">还没有收藏夹</p>
                    ) : folders.map((folder) => {
                      const active = favoritedFolderIds.includes(folder.id);
                      return (
                        <button key={folder.id} disabled={favoriteBusyId === folder.id} className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm text-white/76 transition hover:bg-white/8 hover:text-white disabled:opacity-45" onClick={() => void toggleFavorite(folder.id)}>
                          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${active ? "border-[var(--accent)] bg-[var(--accent)] text-black" : "border-white/18 text-transparent"}`}>
                            <Check size={14} strokeWidth={3} />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                          <span className="font-mono text-xs text-white/35">{folder.itemCount}</span>
                        </button>
                      );
                    })}
                  </div>
                  <form className="mt-2 flex gap-1.5 border-t border-white/8 pt-2" onSubmit={(event) => { event.preventDefault(); void createFolder(); }}>
                    <input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} className="field min-w-0 flex-1 text-sm" placeholder="新建收藏夹…" maxLength={50} />
                    <button type="submit" className="secondary-button shrink-0 !px-2.5 !py-1.5"><Plus size={15} />新建</button>
                  </form>
                </motion.div>
              ) : null}</AnimatePresence>
            </div>
            <details className="relative ml-auto">
              <summary className="icon-button cursor-pointer list-none" aria-label="更多操作"><MoreHorizontal size={19} /></summary>
              <div className="absolute right-0 top-11 z-20 w-44 rounded-xl border border-white/10 bg-[#1a1c22] p-1.5 shadow-2xl">
                <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/70 hover:bg-white/8 hover:text-white" onClick={() => void toggleBlacklist()}><Ban size={17} />{blacklisted ? "取消屏蔽该 UP" : "屏蔽该 UP"}</button>
              </div>
            </details>
          </div>
          {description ? <div className="mt-5 rounded-2xl border border-white/7 bg-white/[0.025] px-4 py-3.5"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold text-white/82">简介</h2>{description.length > 110 ? <button type="button" className="text-sm text-[var(--accent)] hover:underline" onClick={() => setDescriptionExpanded((value) => !value)}>{descriptionExpanded ? "收起" : "展开"}</button> : null}</div><p className={`mt-2 whitespace-pre-wrap text-sm leading-7 text-white/62 ${descriptionExpanded ? "" : "line-clamp-3"}`}>{description}</p>{descriptionExpanded && detail.item.kind === "post" ? <Link href={`/dynamic/${detail.item.id}`} className="mt-3 inline-flex text-sm text-[var(--accent)] hover:underline">查看原动态</Link> : null}</div> : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <AnimatePresence initial={false}>
              {tagDetails.map((tag) => (
                <motion.span key={tag.id} layout variants={scaleIn} initial="hidden" animate="visible" exit="exit" className={`inline-flex min-h-8 items-center gap-1 rounded-full border py-1 pl-2.5 pr-1.5 text-xs transition ${tag.source === "content" ? "border-[rgba(94,234,212,.35)] bg-[rgba(94,234,212,.1)] text-[var(--accent)]" : "border-white/8 bg-white/[.045] text-white/50"}`}>
                  <span>{tag.name}</span>
                  <button disabled={tagBusy === tag.id} className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-current/60 transition hover:bg-white/10 hover:text-white disabled:opacity-30" onClick={() => void removeTag(tag.id)} aria-label={`删除标签 ${tag.name}`}>
                    <X size={12} />
                  </button>
                </motion.span>
              ))}
            </AnimatePresence>
            <form className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-white/8 bg-white/[.035] px-2" onSubmit={addTag}>
              <input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} className="w-24 bg-transparent text-xs text-white/76 outline-none placeholder:text-white/32" placeholder="添加标签" maxLength={40} />
              <button disabled={tagBusy === "add"} className="grid h-5 w-5 place-items-center rounded-full text-[var(--accent)] transition hover:bg-white/10 disabled:opacity-35" aria-label="添加标签">
                <Plus size={13} strokeWidth={2.4} />
              </button>
            </form>
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-white/8 bg-white/[0.025] p-4 md:p-5">
          <h2 className="font-semibold">评论和笔记</h2>
          <form className="mt-4 flex gap-2" onSubmit={submitComment}>
            <input value={comment} onChange={(event) => setComment(event.target.value)} className="field min-w-0 flex-1" placeholder="记录此刻的想法…" />
            <button className="primary-button"><Send size={16} /> 发送</button>
          </form>
          <div className="mt-4 space-y-3">
            {detail.comments.length === 0 ? <p className="py-6 text-center text-sm text-white/35">还没有笔记</p> : detail.comments.map((item) => <div key={item.id} className="rounded-lg bg-black/20 p-3 text-sm text-white/78">{item.body}</div>)}
          </div>
        </section>
      </main>

      <aside className="overflow-hidden border-t border-white/8 pt-3 lg:sticky lg:top-20 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
        <div className="grid grid-cols-2 border-b border-white/8 p-1">
          <button className={`side-tab ${sideTab === "parts" ? "active" : ""}`} onClick={() => setSideTab("parts")}>选集 {detail.parts.length > 1 ? detail.parts.length : ""}</button>
          <button className={`side-tab ${sideTab === "related" ? "active" : ""}`} onClick={() => setSideTab("related")}>相关推荐</button>
        </div>
        <div className="max-h-[calc(100vh-9rem)] space-y-1 overflow-y-auto py-2">
          {sideTab === "parts" ? detail.parts.map((part, index) => (
            <button key={part.id} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition ${index === activePartIndex ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-white/68 hover:bg-white/6 hover:text-white"}`} onClick={() => setActivePartIndex(index)}>
              <span className="w-8 shrink-0 font-mono text-xs text-white/35">P{part.partIndex}</span><span className="line-clamp-2">{part.title}</span>
            </button>
          )) : detail.related.map((item) => <CompactVideoCard key={item.id} item={item} />)}
        </div>
      </aside>
    </motion.div>
  );
}

function WatchSkeleton() {
  return <div className="grid skeleton-shimmer gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"><div><div className="aspect-video rounded-xl bg-white/5" /><div className="mt-5 h-7 w-2/3 rounded bg-white/5" /></div><div className="h-[60vh] rounded-xl bg-white/5" /></div>;
}

function WatchFailed() {
  return (
    <ErrorFallback
      reset={() => window.location.reload()}
      title="加载失败"
      body="无法加载这个内容，可能已被移除或 API 不可用"
    />
  );
}

function formatDate(value: string | null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { year: "numeric", month: "long", day: "numeric" }) : "日期未知";
}
