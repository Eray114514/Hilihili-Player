"use client";

import { LoaderCircle, Search, SearchX } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import type { FeedItem } from "@hilihili/shared";
import { AppShell } from "@/components/AppShell";
import { VideoGrid } from "@/components/VideoCard";
import { getJson, type SearchResponse } from "@/lib/api";

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
  const [items, setItems] = useState<FeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(Boolean(query));
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    if (!query) return () => controller.abort();
    void getJson<SearchResponse>(`/search?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}`)
      .then((response) => {
        if (!controller.signal.aborted) {
          setItems(response.items);
          setTotal(response.total);
          setHasMore(response.hasMore);
        }
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const response = await getJson<SearchResponse>(`/search?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${items.length}`);
      setItems((current) => [...current, ...response.items]);
      setHasMore(response.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, items.length, loadingMore, query]);

  return (
    <AppShell>
      <section className="mb-7 border-b border-white/8 pb-6">
        <div className="flex items-center gap-2 text-sm text-[var(--accent)]"><Search size={16} />媒体库搜索</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">{query ? `“${query}”` : "搜索你想看的内容"}</h1>
        <p className="mt-2 text-sm text-white/45">{query ? loading ? "正在翻找整个媒体库…" : `找到 ${total} 个相关内容` : "可以搜索标题、UP 主、分区、标签或分 P 名称。"}</p>
      </section>

      {failed ? (
        <SearchMessage icon={<SearchX size={32} />} title="搜索暂时不可用" body="请确认 API 服务正在运行后重试。" />
      ) : loading ? (
        <ResultSkeleton />
      ) : !query ? (
        <SearchMessage icon={<Search size={32} />} title="从顶部搜索框开始" body="输入几个关键词，Hilihili 会在整个媒体库里替你找。" />
      ) : items.length === 0 ? (
        <SearchMessage icon={<SearchX size={32} />} title="没有找到相关内容" body="试试更短的关键词，或换用 UP 主、分区和标签名称。" />
      ) : (
        <>
          <VideoGrid items={items} />
          <div className="flex min-h-28 items-center justify-center pt-10">
            {hasMore ? <button type="button" className="secondary-button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? <LoaderCircle className="animate-spin" size={17} /> : null}{loadingMore ? "继续搜索…" : "加载更多结果"}</button> : <span className="text-sm text-white/35">全部结果都在这里了</span>}
          </div>
        </>
      )}
    </AppShell>
  );
}

function SearchMessage({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return <div className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] text-center"><div><div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-white/28">{icon}</div><h2 className="text-lg font-semibold">{title}</h2><p className="mt-2 text-sm text-white/42">{body}</p></div></div>;
}

function SearchPageSkeleton() {
  return <AppShell><ResultSkeleton /></AppShell>;
}

function ResultSkeleton() {
  return <div className="grid animate-pulse grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{Array.from({ length: 12 }, (_, index) => <div key={index}><div className="aspect-video rounded-xl bg-white/5" /><div className="mt-2 h-4 rounded bg-white/5" /><div className="mt-2 h-3 w-1/2 rounded bg-white/[0.035]" /></div>)}</div>;
}
