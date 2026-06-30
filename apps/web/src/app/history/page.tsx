"use client";

import { CheckCircle2, Clock3, Coins, Heart, History, Play, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ApiImage } from "@/components/ApiImage";
import { AppShell } from "@/components/AppShell";
import { assetUrl, deleteJson, getJson, patchJson, putJson, type ActivityEntry, type ActivityResponse } from "@/lib/api";
import { slideUp } from "@/lib/motion";

type ActivityTab = "continue" | "history" | "completed" | "likes" | "coins";

const tabs: { id: ActivityTab; label: string; icon: typeof History }[] = [
  { id: "continue", label: "继续观看", icon: Play },
  { id: "history", label: "观看历史", icon: History },
  { id: "completed", label: "已看完", icon: CheckCircle2 },
  { id: "likes", label: "最近点赞", icon: Heart },
  { id: "coins", label: "最近投币", icon: Coins }
];

export default function HistoryPage() {
  return (
    <Suspense fallback={<ActivitySkeleton />}>
      <HistoryPageInner />
    </Suspense>
  );
}

function HistoryPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const tabParam = searchParams.get("tab");
  const tab: ActivityTab = tabParam && tabs.some((item) => item.id === tabParam) ? (tabParam as ActivityTab) : "continue";

  const load = useCallback(async () => setData(await getJson<ActivityResponse>("/me/activity?limit=80")), []);

  useEffect(() => {
    let ignore = false;
    void getJson<ActivityResponse>("/me/activity?limit=80").then((response) => {
      if (!ignore) setData(response);
    });
    return () => { ignore = true; };
  }, []);

  async function removeProgress(entry: ActivityEntry) {
    setBusyId(entry.item.id);
    try {
      await deleteJson(`/items/${entry.item.id}/watch-progress`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function unlike(entry: ActivityEntry) {
    setBusyId(entry.item.id);
    try {
      await putJson(`/items/${entry.item.id}/reaction`, { reaction: null });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function uncoin(entry: ActivityEntry) {
    setBusyId(entry.item.id);
    try {
      await patchJson(`/items/${entry.item.id}/coin`, {});
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const entries = data ? {
    continue: data.continueWatching,
    history: data.history,
    completed: data.completed,
    likes: data.recentLikes,
    coins: data.recentCoins
  }[tab] : [];

  return (
    <AppShell>
      <section className="mb-7">
        <p className="text-sm font-medium text-[var(--accent)]">我的 Hilihili</p>
        <h1 className="mt-1 text-2xl font-semibold md:text-3xl">观看与喜欢</h1>
        <p className="mt-2 text-sm text-white/48">进度会自动保存在这台服务器上，换页面或退出后也能接着看。</p>
      </section>

      <section className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="看过" value={data?.stats.history} />
        <Stat label="已看完" value={data?.stats.completed} />
        <Stat label="喜欢" value={data?.stats.likes} />
      </section>

      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {tabs.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={`secondary-button shrink-0 ${tab === item.id ? "!bg-[var(--accent-soft)] !text-[var(--accent)]" : ""}`} onClick={() => router.replace(`/history?tab=${item.id}`, { scroll: false })}><Icon size={16} />{item.label}</button>;
        })}
      </div>

      {!data ? <ActivitySkeleton /> : entries.length === 0 ? (
        <div className="animate-fade-in grid min-h-64 place-items-center rounded-xl border border-dashed border-white/12 bg-white/[0.02] text-center">
          <div><Clock3 className="mx-auto text-white/25" size={34} /><p className="mt-3 font-medium">这里暂时空空的</p><p className="mt-1 text-sm text-white/42">去首页逛一逛，新的记录会自动出现在这里。</p></div>
        </div>
      ) : (
        <div key={tab} className="animate-fade-in space-y-3">
          <AnimatePresence initial={false}>
            {entries.map((entry) => (
              <motion.div
                key={entry.item.id}
                layout
                variants={slideUp}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <ActivityCard
                  entry={entry}
                  tab={tab}
                  busy={busyId === entry.item.id}
                  onRemove={() => void removeProgress(entry)}
                  onUnlike={() => void unlike(entry)}
                  onUncoin={() => void uncoin(entry)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return <div className="rounded-xl border border-white/8 bg-white/[0.035] p-4"><div className="text-2xl font-semibold tabular-nums">{value ?? "—"}</div><div className="mt-1 text-xs text-white/42">{label}</div></div>;
}

function ActivityCard({ entry, tab, busy, onRemove, onUnlike, onUncoin }: { entry: ActivityEntry; tab: ActivityTab; busy: boolean; onRemove: () => void; onUnlike: () => void; onUncoin?: () => void }) {
  const cover = assetUrl(entry.item.coverUrl);
  const href = entry.item.playable ? `/watch/${entry.item.id}` : `/dynamic/${entry.item.id}`;
  const status = entry.finished
    ? "已看完"
    : entry.positionSeconds > 0
      ? `${entry.progressPercent}% · 继续观看`
      : "已点赞 · 尚未观看";
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-white/8 bg-white/[0.028] p-3 sm:flex-row sm:items-center">
      <Link href={href} className="group relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-white/5 sm:w-52">
        {cover ? <ApiImage src={cover} alt={entry.item.title} fill sizes="208px" className="object-cover transition group-hover:scale-105" /> : <div className="grid h-full place-items-center text-white/30"><Play size={30} /></div>}
        {entry.finished ? <span className="absolute left-2 top-2 rounded-md bg-black/75 px-2 py-1 text-[11px] text-[var(--accent)]"><CheckCircle2 className="mr-1 inline" size={12} />已看完</span> : null}
        {entry.positionSeconds > 0 && !entry.finished ? <div className="absolute inset-x-0 bottom-0 h-1 bg-black/45"><div className="h-full bg-[var(--accent)]" style={{ width: `${entry.progressPercent}%` }} /></div> : null}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={href} className="line-clamp-2 font-medium leading-6 hover:text-[var(--accent)]">{entry.item.title}</Link>
        <p className="mt-1 truncate text-xs text-white/42">{entry.item.creatorId ? <Link href={`/creator/${entry.item.creatorId}`} className="hover:text-[var(--accent)]">{entry.item.creatorName}</Link> : entry.item.creatorName} · {entry.item.categoryName}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className={entry.finished ? "text-[var(--accent)]" : "text-white/65"}>{status}</span>
          {entry.resumePartIndex ? <span className="text-white/38">P{entry.resumePartIndex}{entry.resumePartTitle ? ` · ${entry.resumePartTitle}` : ""}</span> : null}
          <time className="text-white/32">{formatActivityDate(tab === "likes" ? entry.likedAt : tab === "coins" ? entry.coinedAt : entry.updatedAt)}</time>
        </div>
        {entry.liked && !entry.finished && entry.positionSeconds > 0 ? <p className="mt-2 text-xs text-rose-300/80"><Heart className="mr-1 inline" size={12} fill="currentColor" />喜欢的视频还没看完，回来接着看吧</p> : null}
      </div>
      <div className="flex shrink-0 gap-2 sm:flex-col">
        <Link href={href} className="primary-button flex-1 justify-center sm:flex-none"><Play size={15} />{entry.positionSeconds > 0 && !entry.finished ? "继续" : "播放"}</Link>
        {tab === "likes" ? (
          <button disabled={busy} className="secondary-button flex-1 justify-center disabled:opacity-40 sm:flex-none" onClick={onUnlike}><Heart size={15} />取消点赞</button>
        ) : tab === "coins" ? (
          <button disabled={busy} className="secondary-button flex-1 justify-center disabled:opacity-40 sm:flex-none" onClick={onUncoin}><Coins size={15} />取消投币</button>
        ) : (
          <button disabled={busy} className="secondary-button flex-1 justify-center disabled:opacity-40 sm:flex-none" onClick={onRemove}>{entry.finished ? <RotateCcw size={15} /> : <Trash2 size={15} />}{entry.finished ? "移除并重新推荐" : "移除记录"}</button>
        )}
      </div>
    </article>
  );
}

function formatActivityDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

function ActivitySkeleton() {
  return <div className="space-y-3 skeleton-shimmer">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-36 rounded-xl bg-white/[0.035]" />)}</div>;
}
