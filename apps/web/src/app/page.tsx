"use client";

import { ChevronLeft, ChevronRight, Play, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { FeedItem } from "@hilihili/shared";
import { ApiImage } from "@/components/ApiImage";
import { AppShell, EmptyState } from "@/components/AppShell";
import { VideoGrid } from "@/components/VideoCard";
import { VideoPreview } from "@/components/VideoPreview";
import { assetUrl, useApi, type ActivityEntry, type ActivityResponse, type Category, type FeedResponse } from "@/lib/api";
import { formatDate } from "@/lib/format";

const FEATURED_LIMIT = 8;
const FEATURED_SLIDES = 5;
const BROWSE_LIMIT = 24;

export default function HomePage() {
  const [featuredSeed] = useState("home");
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [browseSeed, setBrowseSeed] = useState(() => `browse-${Date.now()}`);

  const { data: categoryData } = useApi<{ categories: Category[] }>("/categories");
  const { data: activity } = useApi<ActivityResponse>("/me/activity?limit=12");
  const { data: featuredData, isLoading: featuredLoading } = useApi<FeedResponse>(
    `/feeds/home?seed=${encodeURIComponent(featuredSeed)}&limit=${FEATURED_LIMIT}`
  );
  const { data: browseData, isLoading: browseLoading } = useApi<FeedResponse>(
    `/feeds/home?mode=shuffle&seed=${encodeURIComponent(browseSeed)}&limit=${BROWSE_LIMIT}`
  );

  const categories = categoryData?.categories ?? [];
  const continueWatching = activity?.continueWatching.slice(0, 4) ?? [];
  const featuredItems = useMemo(
    () => (featuredData?.items ?? []).filter((item) => item.playable).slice(0, FEATURED_SLIDES),
    [featuredData]
  );
  const normalizedFeaturedIndex = featuredItems.length === 0 ? 0 : featuredIndex % featuredItems.length;
  const activeFeatured = featuredItems[normalizedFeaturedIndex] ?? null;
  const browseItems = useMemo(
    () => (browseData?.items ?? []).filter((item) => item.id !== activeFeatured?.id),
    [activeFeatured?.id, browseData]
  );

  const showPreviousFeatured = () => {
    if (featuredItems.length < 2) return;
    setFeaturedIndex((current) => (current - 1 + featuredItems.length) % featuredItems.length);
  };

  const showNextFeatured = () => {
    if (featuredItems.length < 2) return;
    setFeaturedIndex((current) => (current + 1) % featuredItems.length);
  };

  const refreshBrowse = () => setBrowseSeed(`browse-${Date.now()}`);

  return (
    <AppShell>
      <div className={`grid items-stretch gap-4 ${continueWatching.length > 0 ? "lg:grid-cols-[minmax(0,1.6fr)_minmax(20rem,.72fr)]" : ""}`}>
        <section aria-label="本次精选">
          {featuredLoading ? <FeaturedSkeleton /> : activeFeatured ? (
            <FeaturedStage
              item={activeFeatured}
              itemCount={featuredItems.length}
              activeIndex={normalizedFeaturedIndex}
              onPrevious={showPreviousFeatured}
              onNext={showNextFeatured}
              onSelect={setFeaturedIndex}
            />
          ) : (
            <EmptyState title="还没有可精选的视频" body="完成一次媒体库扫描后，这里会出现适合现在观看的内容。" />
          )}
        </section>

        {continueWatching.length > 0 ? <ContinueWatchingPanel entries={continueWatching} /> : null}
      </div>

      <section className="mt-6" aria-labelledby="browse-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="browse-heading" className="text-xl font-semibold tracking-tight md:text-2xl">逛逛媒体库</h2>
            <p className="mt-1 text-sm text-white/46">按分区随意探索，不替你做决定</p>
          </div>
          <button type="button" className="secondary-button shrink-0" onClick={refreshBrowse} disabled={browseLoading}>
            <RefreshCw size={17} className={browseLoading ? "animate-spin" : ""} /> 换一换
          </button>
        </div>

        <div className="mb-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="内容分区">
          <div className="flex min-w-max items-center gap-2">
            <Link href="/" className="channel-pill active">全部</Link>
            {categories.map((category) => (
              <Link key={category.id} href={`/category/${category.id}`} className="channel-pill">
                <span>{category.name}</span>
                <span className="channel-count">{category.itemCount}</span>
              </Link>
            ))}
          </div>
        </div>

        {browseLoading ? <BrowseSkeleton /> : browseItems.length > 0 ? (
          <div className="animate-fade-in"><VideoGrid items={browseItems} /></div>
        ) : (
          <EmptyState title="媒体库还是空的" body="去设置里添加一个本机或 NAS 挂载目录，然后扫描媒体库。" />
        )}
      </section>
    </AppShell>
  );
}

function FeaturedStage({
  item,
  itemCount,
  activeIndex,
  onPrevious,
  onNext,
  onSelect
}: {
  item: FeedItem;
  itemCount: number;
  activeIndex: number;
  onPrevious: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
}) {
  const cover = assetUrl(item.coverUrl);
  const href = `/watch/${item.id}`;
  const recentlyAdded = isRecentlyAdded(item.firstSeenAt);

  return (
    <div className="group/stage relative overflow-hidden rounded-2xl border border-white/8 bg-[#10131a]">
      <div className="grid min-h-[19rem] sm:grid-cols-[minmax(0,1.25fr)_minmax(17rem,.75fr)]">
        <Link href={href} className="group relative block min-h-56 overflow-hidden bg-[#171a20] sm:min-h-[20rem]" aria-label={`播放 ${item.title}`}>
          <VideoPreview
            previewPartId={item.previewPartId}
            posterUrl={cover}
            alt={item.title}
            priority
            sizes="(min-width: 1024px) 64vw, 100vw"
            fallback={<div className="grid h-full place-items-center bg-[#1a1d24] text-white/45"><Play size={52} /></div>}
          />
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-black/24" />
          {item.partCount && item.partCount > 1 ? <span className="absolute bottom-4 right-4 rounded-md bg-black/72 px-2 py-1 text-xs font-medium">{item.partCount}P</span> : null}
        </Link>

        <div className="flex flex-col justify-center px-5 py-6 sm:px-6">
          <p className="text-xs font-semibold tracking-wide text-white/42">本次精选</p>
          <p className="mt-2 text-xs font-medium text-[var(--accent)]">{recentlyAdded ? "最近入库 · 精选" : "从媒体库中精选"}</p>
          <h2 className="mt-2 text-xl font-semibold leading-tight tracking-tight text-white sm:text-2xl">{item.title}</h2>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/52">
            <span className="text-white/76">{item.creatorName}</span>
            <span>·</span>
            <span>{item.categoryName}</span>
            <span>·</span>
            <time>{formatDate(item.displayDate)}</time>
            {item.partCount && item.partCount > 1 ? <><span>·</span><span>{item.partCount} P</span></> : null}
          </p>
          <p className="mt-3 line-clamp-2 max-w-xl text-sm leading-6 text-white/58">{item.postExcerpt || "从你的媒体库中挑选一部内容，省去反复翻找的时间。"}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Link href={href} className="primary-button"><Play size={17} fill="currentColor" />立即播放</Link>
            {item.creatorId ? <Link href={`/creator/${item.creatorId}`} className="secondary-button">查看 UP</Link> : null}
          </div>
        </div>
      </div>

      {itemCount > 1 ? (
        <>
          <button type="button" className="absolute left-3 top-1/2 hidden h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-white/8 bg-black/28 text-white/55 opacity-0 backdrop-blur-sm transition duration-200 hover:bg-black/58 hover:text-white focus-visible:opacity-100 group-hover/stage:opacity-100 group-focus-within/stage:opacity-100 lg:grid" onClick={onPrevious} aria-label="上一个精选"><ChevronLeft size={18} /></button>
          <button type="button" className="absolute right-3 top-1/2 hidden h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-white/8 bg-black/28 text-white/55 opacity-0 backdrop-blur-sm transition duration-200 hover:bg-black/58 hover:text-white focus-visible:opacity-100 group-hover/stage:opacity-100 group-focus-within/stage:opacity-100 lg:grid" onClick={onNext} aria-label="下一个精选"><ChevronRight size={18} /></button>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-2 backdrop-blur-sm" aria-label="精选位置">
            {Array.from({ length: itemCount }, (_, index) => (
              <button
                type="button"
                key={index}
                className={`h-1.5 rounded-full transition-all ${index === activeIndex ? "w-6 bg-[var(--accent)]" : "w-1.5 bg-white/34 hover:bg-white/62"}`}
                onClick={() => onSelect(index)}
                aria-label={`查看第 ${index + 1} 个精选`}
                aria-current={index === activeIndex ? "true" : undefined}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ContinueWatchingPanel({ entries }: { entries: ActivityEntry[] }) {
  return (
    <section className="rounded-2xl border border-white/8 bg-white/[0.018] p-3" aria-labelledby="continue-heading">
      <div className="mb-2 flex items-center justify-between gap-3 px-1.5 py-1">
        <h2 id="continue-heading" className="text-base font-semibold">继续观看</h2>
        <Link href="/history" className="text-sm text-white/46 transition hover:text-[var(--accent)]">全部记录</Link>
      </div>
      <div className="grid gap-1">
        {entries.map((entry) => <ContinueWatchingItem key={entry.item.id} entry={entry} />)}
      </div>
    </section>
  );
}

function ContinueWatchingItem({ entry }: { entry: ActivityEntry }) {
  const cover = assetUrl(entry.item.coverUrl);
  const href = `/watch/${entry.item.id}`;
  const partLabel = entry.resumePartTitle ?? (entry.resumePartIndex ? `P${entry.resumePartIndex}` : null);

  return (
    <Link href={href} className="group grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] gap-2.5 rounded-lg p-1.5 transition hover:bg-white/[0.055]">
      <div className="relative aspect-video overflow-hidden rounded-md bg-[#171a20]">
        {cover ? <ApiImage src={cover} alt="" fill sizes="112px" className="object-cover transition duration-200 group-hover:scale-[1.025]" /> : <div className="grid h-full place-items-center text-white/42"><Play size={24} /></div>}
        <span className="absolute inset-0 grid place-items-center bg-black/10 opacity-0 transition group-hover:opacity-100"><Play size={20} fill="currentColor" /></span>
      </div>
      <div className="min-w-0 self-center">
        <h3 className="truncate text-sm font-medium text-white/88 group-hover:text-white">{entry.item.title}</h3>
        <p className="mt-1 truncate text-xs text-white/42">{partLabel ? `${partLabel} · ` : ""}{formatClock(entry.positionSeconds)}{entry.durationSeconds ? ` / ${formatClock(entry.durationSeconds)}` : ""}</p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${entry.progressPercent}%` }} />
        </div>
      </div>
    </Link>
  );
}

function FeaturedSkeleton() {
  return (
    <div className="grid min-h-[20rem] overflow-hidden rounded-2xl border border-white/8 bg-[#10131a] skeleton-shimmer sm:grid-cols-[minmax(0,1.25fr)_minmax(17rem,.75fr)]">
      <div className="bg-white/5" />
      <div className="flex flex-col justify-center gap-4 p-8"><div className="h-4 w-32 rounded bg-white/5" /><div className="h-10 w-4/5 rounded bg-white/5" /><div className="h-4 w-2/3 rounded bg-white/[0.035]" /><div className="h-20 rounded bg-white/[0.035]" /></div>
    </div>
  );
}

function BrowseSkeleton() {
  return <div className="grid skeleton-shimmer grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{Array.from({ length: 12 }, (_, index) => <div key={index}><div className="aspect-video rounded-md bg-white/5" /><div className="mt-2 h-4 rounded bg-white/5" /><div className="mt-2 h-3 w-1/2 rounded bg-white/[0.035]" /></div>)}</div>;
}

function isRecentlyAdded(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp <= 30 * 24 * 60 * 60 * 1000;
}

function formatClock(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
