"use client";

import { ImageIcon, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { FeedItem } from "@hilihili/shared";
import { AppShell, EmptyState } from "@/components/AppShell";
import { assetUrl, getJson, type FeedResponse } from "@/lib/api";

type Sort = "newest" | "oldest" | "random";
type Kind = "all" | "video" | "image";

export default function DynamicPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [sort, setSort] = useState<Sort>("newest");
  const [kind, setKind] = useState<Kind>("all");
  const [seed, setSeed] = useState("dynamic");
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<FeedItem | null>(null);

  useEffect(() => {
    let ignore = false;
    void getJson<FeedResponse>(`/feeds/dynamic?limit=80&sort=${sort}&kind=${kind}&seed=${seed}`).then((response) => {
      if (!ignore) { setItems(response.items); setLoading(false); }
    });
    return () => { ignore = true; };
  }, [sort, kind, seed]);

  const groups = useMemo(() => groupByDate(items), [items]);

  return (
    <AppShell>
      <section className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-2xl font-semibold md:text-3xl">动态</h1><p className="mt-2 text-sm text-white/45">按内容时间整理视频与图片，旧库存也能回到正确位置。</p></div>
        <div className="flex flex-wrap gap-2">
          <div className="filter-group">{(["all", "video", "image"] as Kind[]).map((value) => <button key={value} className={kind === value ? "active" : ""} onClick={() => { setLoading(true); setKind(value); }}>{value === "all" ? "全部" : value === "video" ? "视频" : "图片"}</button>)}</div>
          <div className="filter-group">{(["newest", "oldest", "random"] as Sort[]).map((value) => <button key={value} className={sort === value ? "active" : ""} onClick={() => { setLoading(true); setSort(value); }}>{value === "newest" ? "最新" : value === "oldest" ? "最早" : "随机"}</button>)}</div>
          {sort === "random" ? <button className="primary-button" onClick={() => setSeed(String(Date.now()))}><RefreshCw size={16} /> 换一批</button> : null}
        </div>
      </section>

      {!loading && items.length === 0 ? <EmptyState title="动态还是空的" body="添加媒体库后会立即扫描，新内容会按发布时间或文件时间出现在这里。" /> : loading ? <DynamicSkeleton /> : (
        <div className="space-y-10">
          {groups.map(([label, group]) => <section key={label}><div className="mb-4 flex items-center gap-3"><h2 className="text-lg font-semibold">{label}</h2><div className="h-px flex-1 bg-white/8" /><span className="text-xs text-white/35">{group.length} 项</span></div><div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">{group.map((item) => <DynamicCard key={item.id} item={item} onPreview={setPreview} />)}</div></section>)}
        </div>
      )}

      {preview ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/90 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setPreview(null)}><button className="absolute right-5 top-5 icon-button" onClick={() => setPreview(null)} aria-label="关闭"><X size={22} /></button>{preview.coverUrl ? <div className="relative h-[86vh] w-[92vw]" onClick={(event) => event.stopPropagation()}><Image src={assetUrl(preview.coverUrl) ?? ""} alt={preview.title} fill unoptimized sizes="92vw" className="rounded-xl object-contain shadow-2xl" /></div> : null}<div className="absolute bottom-5 left-1/2 max-w-[80vw] -translate-x-1/2 rounded-full bg-black/65 px-5 py-2 text-center text-sm">{preview.title}</div></div> : null}
    </AppShell>
  );
}

function DynamicCard({ item, onPreview }: { item: FeedItem; onPreview: (item: FeedItem) => void }) {
  const content = <><div className="relative aspect-video overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/8">{item.coverUrl ? <Image src={assetUrl(item.coverUrl) ?? ""} alt="" fill unoptimized sizes="(min-width: 1280px) 20vw, 50vw" className="object-cover transition duration-300 group-hover:scale-[1.03]" /> : <div className="grid h-full place-items-center text-white/30"><ImageIcon /></div>}</div><h3 className="mt-2 line-clamp-2 text-sm font-medium leading-5 group-hover:text-[var(--accent)]">{item.title}</h3><p className="mt-1 truncate text-xs text-white/42">{item.creatorName} · {formatFullDate(item.displayDate)}</p></>;
  return item.kind === "video" ? <Link href={`/watch/${item.id}`} className="group min-w-0">{content}</Link> : <button className="group min-w-0 text-left" onClick={() => onPreview(item)}>{content}</button>;
}

function groupByDate(items: FeedItem[]) {
  const map = new Map<string, FeedItem[]>();
  for (const item of items) {
    const date = new Date(item.displayDate);
    const label = Number.isFinite(date.getTime()) ? date.toLocaleDateString("zh-CN", { year: "numeric", month: "long" }) : "日期未知";
    map.set(label, [...(map.get(label) ?? []), item]);
  }
  return [...map.entries()];
}

function formatFullDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("zh-CN") : "";
}

function DynamicSkeleton() {
  return <div className="grid animate-pulse grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">{Array.from({ length: 10 }, (_, index) => <div key={index}><div className="aspect-video rounded-xl bg-white/5" /><div className="mt-2 h-4 rounded bg-white/5" /></div>)}</div>;
}
