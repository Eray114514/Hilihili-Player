"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { VideoGrid } from "@/components/VideoCard";
import { getJson, type FeedResponse } from "@/lib/api";

export default function CreatorPage() {
  const params = useParams<{ id: string }>();
  const [items, setItems] = useState<FeedResponse["items"]>([]);

  useEffect(() => {
    void getJson<FeedResponse>(`/feeds/creator/${params.id}`).then((response) => setItems(response.items));
  }, [params.id]);

  return (
    <AppShell>
      <div className="mb-7">
        <h1 className="text-2xl font-semibold md:text-3xl">UP 主</h1>
        <p className="mt-2 text-sm text-white/50">UP 主页基础路由已就位，后续会接专属 feed 和动态。</p>
      </div>
      <VideoGrid items={items} />
    </AppShell>
  );
}
