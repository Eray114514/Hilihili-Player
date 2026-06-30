"use client";

import { ArrowLeft, ImageIcon, LoaderCircle, Play } from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { AppShell } from "@/components/AppShell";
import { CreatorAvatar } from "@/components/CreatorAvatar";
import { ImageMosaic } from "@/components/ImageMosaic";
import { useApi, type ItemDetail } from "@/lib/api";

// VideoPlayer 重型组件 + ImageLightbox 仅点击图片时用，拆成单独 chunk 并 ssr: false（纯客户端组件）。
const VideoPlayer = dynamic(() => import("@/components/VideoPlayer").then((m) => m.VideoPlayer), {
  ssr: false,
  loading: () => <div className="grid aspect-video place-items-center rounded-xl bg-white/5 text-white/55"><LoaderCircle className="animate-spin" size={32} /></div>
});
const ImageLightbox = dynamic(() => import("@/components/ImageLightbox").then((m) => m.ImageLightbox), {
  ssr: false,
  loading: () => null
});

export default function DynamicDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: detail, error } = useApi<ItemDetail>(`/items/${params.id}`);
  const failed = Boolean(error);
  const [activePartIndex, setActivePartIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const activePart = detail?.parts[activePartIndex];
  return (
    <AppShell>
      <main className="mx-auto max-w-[920px]">
        <Link href="/dynamic" className="mb-4 inline-flex items-center gap-2 text-sm text-white/48 hover:text-white"><ArrowLeft size={17} /> 返回动态</Link>
        {failed ? <div className="rounded-2xl border border-white/8 bg-white/[0.025] p-10 text-center text-white/55">这条动态不存在，或媒体库尚未完成扫描。</div> : !detail ? <DetailSkeleton /> : (
          <article className="animate-fade-in overflow-hidden rounded-2xl border border-white/8 bg-[#12151c] shadow-2xl shadow-black/15">
            <header className="flex gap-3 border-b border-white/7 p-5 md:p-7">
              <CreatorAvatar creatorId={detail.item.creatorId} name={detail.item.creatorName} avatarUrl={detail.item.creatorAvatarUrl} size="lg" />
              <div className="min-w-0">
                <Link href={detail.item.creatorId ? `/creator/${detail.item.creatorId}` : "#"} className="text-lg font-semibold hover:text-[var(--accent)]">{detail.item.creatorName}</Link>
                {detail.item.creatorAlias ? <p className="mt-0.5 text-sm text-white/42">{detail.item.creatorAlias}</p> : null}
                <p className="mt-1 text-xs text-white/34">{formatDate(detail.item.contentPublishedAt ?? detail.item.fileModifiedAt ?? detail.item.firstSeenAt)} · {detail.item.categoryName}</p>
              </div>
            </header>

            <div className="p-5 md:p-7">
              <h1 className="text-xl font-semibold leading-8 md:text-2xl">{detail.item.title}</h1>
              {detail.item.postBody || detail.item.description ? <p className="mt-4 whitespace-pre-wrap text-[15px] leading-7 text-white/76">{detail.item.postBody ?? detail.item.description}</p> : detail.item.kind === "post" ? <p className="mt-4 rounded-xl bg-white/[0.035] p-4 text-sm text-white/40">这条动态没有可显示的正文。</p> : null}

              {detail.images.length > 0 ? <section className="mt-6" aria-label="动态图片"><ImageMosaic images={detail.images} total={detail.images.length} onSelect={setLightboxIndex} showAll /></section> : detail.item.kind === "image" ? <div className="mt-6 grid min-h-52 place-items-center rounded-xl border border-dashed border-white/10 text-white/32"><span className="flex items-center gap-2"><ImageIcon /> 图片暂时无法读取</span></div> : null}

              {activePart ? (
                <section className="mt-7">
                  <div className="mb-3 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 font-semibold"><Play size={17} /> 配套视频</h2><Link href={`/watch/${detail.item.id}`} className="text-sm text-[var(--accent)] hover:underline">进入播放页</Link></div>
                  <VideoPlayer itemId={detail.item.id} part={activePart} resumePosition={activePart.id === detail.item.resumePartId ? detail.item.resumePositionSeconds ?? 0 : 0} onEnded={() => { if (activePartIndex < detail.parts.length - 1) setActivePartIndex((value) => value + 1); }} />
                  {detail.parts.length > 1 ? <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{detail.parts.map((part, index) => <button type="button" key={part.id} className={`shrink-0 rounded-lg px-3 py-2 text-sm ${index === activePartIndex ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-white/5 text-white/55 hover:bg-white/8"}`} onClick={() => setActivePartIndex(index)}>P{part.partIndex} {part.title}</button>)}</div> : null}
                </section>
              ) : null}

              {detail.tags.length > 0 ? <footer className="mt-7 flex flex-wrap gap-2 border-t border-white/7 pt-5">{detail.tags.map((tag) => <span key={tag} className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/45">#{tag}</span>)}</footer> : null}
            </div>
          </article>
        )}
      </main>
      <AnimatePresence>
        {detail && lightboxIndex !== null ? <ImageLightbox images={detail.images} index={lightboxIndex} onChange={setLightboxIndex} onClose={() => setLightboxIndex(null)} /> : null}
      </AnimatePresence>
    </AppShell>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "日期未知";
}

function DetailSkeleton() {
  return <div className="skeleton-shimmer overflow-hidden rounded-2xl border border-white/7 bg-white/[0.025]"><div className="flex gap-3 border-b border-white/6 p-7"><div className="h-14 w-14 rounded-full bg-white/6" /><div className="flex-1"><div className="h-5 w-32 rounded bg-white/6" /><div className="mt-3 h-3 w-52 rounded bg-white/[0.035]" /></div></div><div className="p-7"><div className="h-7 w-2/3 rounded bg-white/6" /><div className="mt-5 h-4 w-full rounded bg-white/[0.035]" /><div className="mt-3 h-4 w-4/5 rounded bg-white/[0.035]" /><div className="mt-7 aspect-video rounded-xl bg-white/5" /></div></div>;
}
