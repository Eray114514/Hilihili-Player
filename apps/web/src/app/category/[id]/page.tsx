"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { GridSkeleton } from "@/components/GridSkeleton";
import { VideoGrid } from "@/components/VideoCard";
import { useApi, type FeedResponse } from "@/lib/api";

export default function CategoryPage() {
  const params = useParams<{ id: string }>();
  // Keyed remount on id change resets SWR 本地状态（isLoading=true）。
  return (
    <AppShell>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold md:text-3xl">分区内容</h1>
        <p className="mt-2 text-sm text-white/50">无限下滑会继续接同一个推荐接口，当前先展示第一屏。</p>
      </div>
      <CategoryContent key={params.id} id={params.id} />
    </AppShell>
  );
}

function CategoryContent({ id }: { id: string }) {
  const { data, error, isLoading } = useApi<FeedResponse>(`/feeds/category/${id}`);

  if (isLoading || error) return <GridSkeleton />;
  const items = data?.items ?? [];
  return <div className="animate-fade-in"><VideoGrid items={items} /></div>;
}
