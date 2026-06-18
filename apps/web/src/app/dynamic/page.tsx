"use client";

import { useEffect, useState } from "react";
import { AppShell, EmptyState } from "@/components/AppShell";
import { VideoGrid } from "@/components/VideoCard";
import { getJson, type FeedResponse } from "@/lib/api";

export default function DynamicPage() {
  const [items, setItems] = useState<FeedResponse["items"]>([]);

  useEffect(() => {
    void getJson<FeedResponse>("/feeds/dynamic?limit=48").then((response) => setItems(response.items));
  }, []);

  return (
    <AppShell>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold md:text-3xl">动态</h1>
        <p className="mt-2 text-sm text-white/50">按加入媒体库的时间排序，视频和图片都会出现在这里。</p>
      </div>
      {items.length === 0 ? <EmptyState title="动态还是空的" body="扫描媒体库后，新加入的视频和图片会按 first_seen_at 出现在这里。" /> : <VideoGrid items={items} />}
    </AppShell>
  );
}
