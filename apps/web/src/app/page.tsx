"use client";

import { Clock3, Heart, LoaderCircle, Play, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedItem } from "@hilihili/shared";
import { AppShell, EmptyState } from "@/components/AppShell";
import { VideoGrid } from "@/components/VideoCard";
import { getJson, type ActivityResponse, type Category, type FeedResponse } from "@/lib/api";

const FEATURED_LIMIT = 24;
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

  const continueReminder = activity?.continueWatching[0] ?? null;
  const likedReminder = activity?.continueWatching.find((entry) => entry.liked && entry.item.id !== continueReminder?.item.id);
  const allItems = [...featuredItems, ...streamItems];

  return (
    <AppShell>
      <section className="-mt-1 mb-5 overflow-x-auto border-b border-white/8 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="内容分区">
        <div className="flex min-w-max items-center gap-2">
          <Link href="/" className="channel-pill active">全部</Link>
          {categories.map((category) => (
            <Link key={category.id} href={`/category/${category.id}`} className="channel-pill">
              <span>{category.name}</span>
              <span className="channel-count">{category.itemCount}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mb-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">推荐</h1>
          {continueReminder ? <p className="mt-1 truncate text-sm text-white/42">上次看到 {continueReminder.progressPercent}%</p> : null}
        </div>
        <button className="secondary-button shrink-0" onClick={refreshFeatured} disabled={loading}>
          <RefreshCw size={17} className={loading ? "animate-spin" : ""} /> 换一换
        </button>
      </section>

      {continueReminder ? (
        <section className="mb-5 flex flex-col gap-3 border-b border-white/8 pb-5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/8 text-white/72"><Clock3 size={18} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-white/42">继续观看</p>
              <h2 className="mt-0.5 truncate text-sm font-medium text-white/86">{continueReminder.item.title}</h2>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${continueReminder.progressPercent}%` }} />
              </div>
            </div>
          </div>
          <Link href={`/watch/${continueReminder.item.id}`} className="primary-button shrink-0 justify-center"><Play size={15} />续播</Link>
        </section>
      ) : null}

      {likedReminder ? (
        <section className="mb-5 flex flex-col gap-4 rounded-lg border border-rose-300/15 bg-rose-300/[0.045] p-3 sm:flex-row sm:items-center">
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
  return <div className="grid skeleton-shimmer grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{Array.from({ length: 12 }, (_, index) => <div key={index}><div className="aspect-video rounded-md bg-white/5" /><div className="mt-2 h-4 rounded bg-white/5" /><div className="mt-2 h-3 w-1/2 rounded bg-white/[0.035]" /></div>)}</div>;
}
