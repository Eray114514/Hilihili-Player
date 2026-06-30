"use client";

import { LoaderCircle, Search, SearchX } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { GridSkeleton } from "@/components/GridSkeleton";
import { VideoGrid } from "@/components/VideoCard";
import { apiFetcher, useApi, type SearchResponse } from "@/lib/api";

const PAGE_SIZE = 48;

export default function SearchPage() {
  return <Suspense fallback={<SearchPageSkeleton />}><SearchRoute /></Suspense>;
}

function SearchRoute() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  return <SearchResults key={query} query={query} />;
}

function SearchResults({ query }: { query: string }) {
  const [loadingMore, setLoadingMore] = useState(false);
  // query 为空时 key 为 null，不发请求；query 变化时父组件已用 key={query} remount
  const key = query ? `/search?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}` : null;
  const { data, error, isLoading, mutate } = useApi<SearchResponse>(key);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;
  const failed = Boolean(error);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || !query) return;
    setLoadingMore(true);
    try {
      const response = await apiFetcher<SearchResponse>(`/search?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${items.length}`);
      // 把追加页累积进 SWR 缓存（不触发 revalidate，避免重新请求第一页）
      mutate((current) => current
        ? { ...current, items: [...current.items, ...response.items], hasMore: response.hasMore }
        : current, { revalidate: false });
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, items.length, loadingMore, mutate, query]);

  return (
    <AppShell>
      <section className="mb-7 border-b border-white/8 pb-6">
        <div className="flex items-center gap-2 text-sm text-[var(--accent)]"><Search size={16} />媒体库搜索</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">{query ? `“${query}”` : "搜索你想看的内容"}</h1>
        <p className="mt-2 text-sm text-white/45">{query ? isLoading ? "正在翻找整个媒体库…" : `找到 ${total} 个相关内容` : "可以搜索标题、UP 主、分区、标签或分 P 名称。"}</p>
      </section>

      {failed ? (
        <SearchMessage icon={<SearchX size={32} />} title="搜索暂时不可用" body="请确认 API 服务正在运行后重试。" />
      ) : isLoading ? (
        <GridSkeleton />
      ) : !query ? (
        <SearchMessage icon={<Search size={32} />} title="从顶部搜索框开始" body="输入几个关键词，Hilihili 会在整个媒体库里替你找。" />
      ) : items.length === 0 ? (
        <SearchMessage icon={<SearchX size={32} />} title="没有找到相关内容" body="试试更短的关键词，或换用 UP 主、分区和标签名称。" />
      ) : (
        <div className="animate-fade-in">
          <VideoGrid items={items} />
          <div className="flex min-h-28 items-center justify-center pt-10">
            {hasMore ? <button type="button" className="secondary-button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <LoaderCircle className="animate-spin" size={17} /> : null}{loadingMore ? "继续搜索…" : "加载更多结果"}</button> : <span className="text-sm text-white/35">全部结果都在这里了</span>}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function SearchMessage({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return <div className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] text-center"><div><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-white/28">{icon}</div><h2 className="text-lg font-semibold">{title}</h2><p className="mt-2 text-sm text-white/42">{body}</p></div></div>;
}

function SearchPageSkeleton() {
  return <AppShell><GridSkeleton /></AppShell>;
}
