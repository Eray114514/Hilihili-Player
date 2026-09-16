"use client";

import { AppShell } from "@/components/AppShell";
import { GridSkeleton } from "@/components/GridSkeleton";
import { SwrFallback } from "@/components/SwrFallback";
import { VideoGrid } from "@/components/VideoCard";
import { useApi, type FeedResponse } from "@/lib/api";

/**
 * 分区内容由 Server Component 取好后经 fallback 注入 SWR，首屏 HTML 直接带封面 URL。
 */
export function CategoryClient({ id, fallback }: { id: string; fallback: Record<string, unknown> }) {
  return (
    <SwrFallback data={fallback}>
      <CategoryView id={id} />
    </SwrFallback>
  );
}

function CategoryView({ id }: { id: string }) {
  // Keyed remount on id change resets SWR 本地状态（isLoading=true）。
  return (
    <AppShell>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold md:text-3xl">分区内容</h1>
        <p className="mt-2 text-sm text-white/50">无限下滑会继续接同一个推荐接口，当前先展示第一屏。</p>
      </div>
      <CategoryContent key={id} id={id} />
    </AppShell>
  );
}

function CategoryContent({ id }: { id: string }) {
  const { data, error, isLoading } = useApi<FeedResponse>(`/feeds/category/${id}`);

  if (isLoading || error) return <GridSkeleton />;
  const items = data?.items ?? [];
  return <div className="animate-fade-in"><VideoGrid items={items} /></div>;
}