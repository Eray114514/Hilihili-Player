"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { VideoGrid } from "@/components/VideoCard";
import { getJson, type FeedResponse } from "@/lib/api";

export default function CategoryPage() {
  const params = useParams<{ id: string }>();
  // Keyed remount on id change resets local state (loading=true) without a synchronous setState in effect.
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
  const [items, setItems] = useState<FeedResponse["items"]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void getJson<FeedResponse>(`/feeds/category/${id}`)
      .then((response) => { if (!controller.signal.aborted) setItems(response.items); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id]);

  return loading ? <CategorySkeleton /> : <div className="animate-fade-in"><VideoGrid items={items} /></div>;
}

function CategorySkeleton() {
  return <div className="grid skeleton-shimmer grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{Array.from({ length: 12 }, (_, index) => <div key={index}><div className="aspect-video rounded-xl bg-white/5" /><div className="mt-2 h-4 rounded bg-white/5" /><div className="mt-2 h-3 w-1/2 rounded bg-white/[0.035]" /></div>)}</div>;
}
