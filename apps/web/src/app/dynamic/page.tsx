"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { FeedItem } from "@hilihili/shared";
import { AppShell, EmptyState } from "@/components/AppShell";
import { DynamicFeedCard } from "@/components/DynamicFeedCard";
import { getJson, type FeedResponse } from "@/lib/api";

type Sort = "newest" | "oldest" | "random";
type Kind = "all" | "video" | "post" | "image";

const kinds: { value: Kind; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "video", label: "视频" },
  { value: "post", label: "图文" },
  { value: "image", label: "图集" }
];

export default function DynamicPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [sort, setSort] = useState<Sort>("newest");
  const [kind, setKind] = useState<Kind>("all");
  const [seed, setSeed] = useState("dynamic");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void getJson<FeedResponse>(`/feeds/dynamic?limit=80&sort=${sort}&kind=${kind}&seed=${seed}`)
      .then((response) => setItems(response.items))
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sort, kind, seed]);

  return (
    <AppShell>
      <div className="mx-auto max-w-[780px]">
        <section className="mb-6 rounded-2xl border border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,.12),transparent_38%),#11141b] p-5 md:p-6">
          <h1 className="text-2xl font-semibold md:text-3xl">动态</h1>
          <p className="mt-2 text-sm leading-6 text-white/48">沿着发布时间翻看每位 UP 的投稿、图文与图片集。</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div className="filter-group">{kinds.map((item) => <button type="button" key={item.value} disabled={kind === item.value} className={kind === item.value ? "active" : ""} onClick={() => { setLoading(true); setFailed(false); setKind(item.value); }}>{item.label}</button>)}</div>
            <div className="filter-group">{(["newest", "oldest", "random"] as Sort[]).map((value) => <button type="button" key={value} disabled={sort === value} className={sort === value ? "active" : ""} onClick={() => { setLoading(true); setFailed(false); setSort(value); }}>{value === "newest" ? "最新" : value === "oldest" ? "最早" : "随机"}</button>)}</div>
            {sort === "random" ? <button type="button" className="primary-button" onClick={() => { setLoading(true); setFailed(false); setSeed(String(Date.now())); }}><RefreshCw size={16} /> 换一批</button> : null}
          </div>
        </section>

        {failed ? <div className="rounded-2xl border border-red-400/15 bg-red-400/5 p-8 text-center text-sm text-red-100/70">动态加载失败，请确认 API 服务正在运行。</div> : loading ? <DynamicSkeleton /> : items.length === 0 ? <EmptyState title="动态还是空的" body="添加媒体库并扫描后，视频、图文和图集会按内容时间出现在这里。" /> : (
          <div className="space-y-4">{items.map((item) => <DynamicFeedCard key={item.id} item={item} />)}</div>
        )}
      </div>
    </AppShell>
  );
}

function DynamicSkeleton() {
  return <div className="space-y-4 animate-pulse">{Array.from({ length: 4 }, (_, index) => <div key={index} className="rounded-2xl border border-white/6 bg-white/[0.025] p-5"><div className="flex gap-3"><div className="h-11 w-11 rounded-full bg-white/6" /><div className="flex-1"><div className="h-4 w-32 rounded bg-white/6" /><div className="mt-2 h-3 w-48 rounded bg-white/[0.035]" /></div></div><div className="ml-14 mt-5 h-4 w-2/3 rounded bg-white/5" /><div className="ml-14 mt-4 aspect-video rounded-xl bg-white/5" /></div>)}</div>;
}
