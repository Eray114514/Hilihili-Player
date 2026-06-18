"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell, EmptyState } from "@/components/AppShell";
import { VideoGrid } from "@/components/VideoCard";
import { getJson, type Category, type FeedResponse } from "@/lib/api";

export default function HomePage() {
  const [seed, setSeed] = useState(String(Date.now()));
  const [items, setItems] = useState<FeedResponse["items"]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoading(true);
      const [feed, categoryData] = await Promise.all([
        getJson<FeedResponse>(`/feeds/home?seed=${seed}&limit=30`),
        getJson<{ categories: Category[] }>("/categories")
      ]);
      if (!ignore) {
        setItems(feed.items);
        setCategories(categoryData.categories);
        setLoading(false);
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [seed]);

  return (
    <AppShell>
      <section className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold md:text-3xl">推荐</h1>
          <p className="mt-2 text-sm text-white/50">跳过已看完内容，保留一点探索，让库存永远能被刷到。</p>
        </div>
        <button className="primary-button" onClick={() => setSeed(String(Date.now()))}>
          <RefreshCw size={17} /> 换一换
        </button>
      </section>

      {items.length === 0 && !loading ? (
        <EmptyState title="还没有视频" body="去设置里添加一个本机或 NAS 挂载目录，然后扫描媒体库。" />
      ) : (
        <VideoGrid items={items} />
      )}

      <section className="mt-10">
        <h2 className="mb-4 text-xl font-semibold">分区</h2>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {categories.map((category) => (
            <a key={category.id} href={`/category/${category.id}`} className="shrink-0 rounded-lg border border-white/8 bg-white/[0.045] px-4 py-3 hover:bg-white/8">
              <div className="font-medium">{category.name}</div>
              <div className="mt-1 text-xs text-white/45">{category.itemCount} 个内容</div>
            </a>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
