"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { VideoGrid } from "@/components/VideoCard";
import { getJson, type FeedResponse } from "@/lib/api";

export default function CategoryPage() {
  const params = useParams<{ id: string }>();
  const [items, setItems] = useState<FeedResponse["items"]>([]);

  useEffect(() => {
    void getJson<FeedResponse>(`/feeds/category/${params.id}`).then((response) => setItems(response.items));
  }, [params.id]);

  return (
    <AppShell>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold md:text-3xl">分区内容</h1>
        <p className="mt-2 text-sm text-white/50">无限下滑会继续接同一个推荐接口，当前先展示第一屏。</p>
      </div>
      <VideoGrid items={items} />
    </AppShell>
  );
}
