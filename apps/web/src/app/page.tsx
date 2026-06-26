"use client";

import { Heart, LoaderCircle, Play, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedItem } from "@hilihili/shared";
import { AppShell, EmptyState } from "@/components/AppShell";
import { VideoGrid } from "@/components/VideoCard";
import { getJson, type ActivityResponse, type Category, type FeedResponse } from "@/lib/api";

const FEATURED_LIMIT = 12;
const STREAM_BATCH_SIZE = 24;

export default function HomePage() {
  const [seed, setSeed] = useState("home");
  const [streamSeed, setStreamSeed] = useState(() => `stream-${Date.now()}`);
  const [featuredItems, setFeaturedItems] = useState<FeedItem[]>([]);
  const [streamItems, setStreamItems] = useState<FeedItem[]>([]);
  const [streamOffset, setStreamOffset] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadMoreMarker = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getJson<{ categories: Category[] }>("/categories"),
      getJson<ActivityResponse>("/me/activity?limit=12")
    ]).then(([categoryData, activityData]) => {
      if (!controller.signal.aborted) {
        setCategories(categoryData.categories);
        setActivity(activityData);
      }
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getJson<FeedResponse>(`/feeds/home?seed=${encodeURIComponent(seed)}&limit=${FEATURED_LIMIT}`)
      .then((feed) => { if (!controller.signal.aborted) setFeaturedItems(feed.items); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [seed]);

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const feed = await getJson<FeedResponse>(`/feeds/home?mode=shuffle&seed=${encodeURIComponent(streamSeed)}&limit=${STREAM_BATCH_SIZE}&offset=${streamOffset}`);
      const existingIds = new Set([...featuredItems, ...streamItems].map((item) => item.id));
      const freshItems = feed.items.filter((item) => !existingIds.has(item.id));
      setStreamItems((current) => [...current, ...freshItems]);
      setStreamOffset((current) => current + feed.items.length);
      setHasMore(feed.items.length === STREAM_BATCH_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }, [featuredItems, hasMore, loading, loadingMore, streamItems, streamOffset, streamSeed]);

  useEffect(() => {
    const marker = loadMoreMarker.current;
    if (!marker) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMore();
    }, { rootMargin: "500px 0px" });
    observer.observe(marker);
    return () => observer.disconnect();
  }, [loadMore]);

  const refreshFeatured = () => {
    const nextSeed = String(Date.now());
    setLoading(true);
    setSeed(nextSeed);
    setStreamSeed(`stream-${nextSeed}`);
    setStreamItems([]);
    setStreamOffset(0);
    setHasMore(true);
  };

  const likedReminder = activity?.continueWatching.find((entry) => entry.liked);
  const allItems = [...featuredItems, ...streamItems];

  return (
    <AppShell>
      <section className="mb-7 rounded-2xl border border-white/8 bg-[radial-gradient(circle_at_12%_0%,rgba(94,234,212,.13),transparent_30%),linear-gradient(135deg,#141820,#0f1218)] p-4 shadow-[0_18px_60px_rgba(0,0,0,.18)] md:p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white/82"><Sparkles size={16} className="text-[var(--accent)]" />浏览分区</div>
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <Link key={category.id} href={`/category/${category.id}`} className="group inline-flex items-center gap-2 rounded-xl border border-white/7 bg-white/[0.045] px-3.5 py-2 text-sm text-white/65 transition hover:-translate-y-0.5 hover:border-[rgba(94,234,212,.25)] hover:bg-[var(--accent-soft)] hover:text-white">
              <span>{category.name}</span>
              <span className="rounded-md bg-black/20 px-1.5 py-0.5 text-[10px] text-white/35 group-hover:text-[var(--accent)]">{category.itemCount}</span>
            </Link>
          ))}
          {categories.length === 0 && !loading ? <span className="text-sm text-white/38">扫描媒体库后，分区会出现在这里。</span> : null}
        </div>
      </section>

      <section className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-[.18em] text-[var(--accent)]/70">For you</p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">为你推荐</h1>
          <p className="mt-1.5 text-sm text-white/45">先看这一屏，继续下滑会不断遇见随机视频。</p>
        </div>
        <button className="secondary-button shrink-0 border border-white/8" onClick={refreshFeatured} disabled={loading}>
          <RefreshCw size={17} className={loading ? "animate-spin" : ""} /> 换一换
        </button>
      </section>

      {likedReminder ? (
        <section className="mb-6 flex flex-col gap-4 rounded-xl border border-rose-300/15 bg-[linear-gradient(120deg,rgba(244,114,182,.09),rgba(94,234,212,.055))] p-4 sm:flex-row sm:items-center">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-300/12 text-rose-300"><Heart size={19} fill="currentColor" /></span>
          <div className="min-w-0 flex-1"><p className="text-xs text-rose-200/65">你喜欢的视频还没看完</p><h2 className="mt-1 truncate font-medium">{likedReminder.item.title}</h2><p className="mt-1 text-xs text-white/42">看到 P{likedReminder.resumePartIndex ?? 1} · {likedReminder.progressPercent}%</p></div>
          <Link href={`/watch/${likedReminder.item.id}`} className="primary-button shrink-0 justify-center"><Play size={15} />继续观看</Link>
        </section>
      ) : null}

      {loading ? <HomeSkeleton /> : (
        <div className="animate-fade-in">
          {allItems.length === 0 ? (
            <EmptyState title="还没有视频" body="去设置里添加一个本机或 NAS 挂载目录，然后扫描媒体库。" />
          ) : (
            <VideoGrid items={allItems} />
          )}
        </div>
      )}

      <div ref={loadMoreMarker} className="flex min-h-28 items-center justify-center py-8 text-sm text-white/38" aria-live="polite">
        {loadingMore ? <span className="flex items-center gap-2"><LoaderCircle className="animate-spin text-[var(--accent)]" size={18} />正在随机挑选下一批…</span> : !hasMore && allItems.length > 0 ? "已经逛到媒体库尽头了" : null}
      </div>
    </AppShell>
  );
}

function HomeSkeleton() {
  return <div className="grid skeleton-shimmer grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{Array.from({ length: 12 }, (_, index) => <div key={index}><div className="aspect-video rounded-xl bg-white/5" /><div className="mt-2 h-4 rounded bg-white/5" /><div className="mt-2 h-3 w-1/2 rounded bg-white/[0.035]" /></div>)}</div>;
}
