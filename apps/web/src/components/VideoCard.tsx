"use client";

import { ImageIcon, LoaderCircle, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { FeedItem } from "@hilihili/shared";
import { assetUrl } from "@/lib/api";
import { ApiImage } from "@/components/ApiImage";
import { VideoPreview } from "@/components/VideoPreview";

export function VideoCard({ item, eager = false }: { item: FeedItem; eager?: boolean; index?: number }) {
  const cover = assetUrl(item.coverUrl);
  const href = item.playable ? `/watch/${item.id}` : `/dynamic/${item.id}`;
  const badge = cardBadge(item);

  return (
    <div className="min-w-0">
      <article className="group min-w-0">
        <Link href={href} className="block">
        <div className="relative aspect-video overflow-hidden rounded-md bg-[#171a20] transition duration-200 group-hover:brightness-110">
          {item.playable ? (
            <VideoPreview
              previewPartId={item.previewPartId}
              posterUrl={cover}
              alt={item.title}
              priority={eager}
              sizes="(min-width: 1536px) 16vw, (min-width: 768px) 25vw, 50vw"
              fallback={<div className="grid h-full place-items-center bg-[#1a1d24] text-white/40">{item.thumbnailStatus === "pending" ? <LoaderCircle className="animate-spin" size={28} /> : <Play size={34} />}</div>}
            />
          ) : cover ? (
            <ApiImage
              src={cover}
              alt={item.title}
              fill
              priority={eager}
              sizes="(min-width: 1536px) 16vw, (min-width: 768px) 25vw, 50vw"
              className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]"
            />
          ) : (
            <div className="grid h-full place-items-center bg-[#1a1d24] text-white/40">
              {item.thumbnailStatus === "pending" ? <LoaderCircle className="animate-spin" size={28} /> : item.kind === "image" ? <ImageIcon size={34} /> : <Play size={34} />}
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/72 to-transparent opacity-90" />
          {badge ? <span className="absolute bottom-1.5 right-1.5 rounded bg-black/72 px-1.5 py-0.5 text-[11px] font-medium text-white/88">{badge}</span> : null}
        </div>
        </Link>
        <h3 className="mt-2 line-clamp-2 min-h-10 text-[0.92rem] font-medium leading-5 text-white/92 transition group-hover:text-white">
          <Link href={href} className="hover:text-[var(--accent)]">
          {item.title}
          </Link>
        </h3>
        <p className="mt-1.5 flex items-center justify-between gap-2 truncate text-xs text-white/46"><span className="min-w-0 truncate">{item.creatorId ? <Link href={`/creator/${item.creatorId}`} className="hover:text-[var(--accent)]">{item.creatorName}</Link> : item.creatorName}<span className="mx-1 text-white/24">·</span>{item.categoryName}</span><time className="shrink-0 text-white/36">{formatDate(item.displayDate)}</time></p>
      </article>
    </div>
  );
}

export function CompactVideoCard({ item }: { item: FeedItem }) {
  const cover = assetUrl(item.coverUrl);
  const [imageFailed, setImageFailed] = useState(false);
  const showCover = cover && !imageFailed;
  return (
    <article className="group flex gap-3 rounded-md p-1.5 transition hover:bg-white/5">
      <Link href={item.playable ? `/watch/${item.id}` : `/dynamic/${item.id}`} className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-md bg-white/5">
        {showCover ? <ApiImage src={cover} alt="" fill sizes="144px" className="object-cover transition group-hover:scale-105" onError={() => setImageFailed(true)} /> : <div className="grid h-full place-items-center text-white/35"><Play size={24} /></div>}
        {item.partCount && item.partCount > 1 ? <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px]">{item.partCount}P</span> : null}
      </Link>
      <div className="min-w-0 py-0.5">
        <h3 className="line-clamp-2 text-sm font-medium leading-5"><Link href={item.playable ? `/watch/${item.id}` : `/dynamic/${item.id}`} className="hover:text-[var(--accent)]">{item.title}</Link></h3>
        <p className="mt-2 truncate text-xs text-white/45">{item.creatorId ? <Link href={`/creator/${item.creatorId}`} className="hover:text-[var(--accent)]">{item.creatorName}</Link> : item.creatorName}</p>
        <time className="mt-1 block text-[11px] text-white/35">{formatDate(item.displayDate)}</time>
      </div>
    </article>
  );
}

export function VideoGrid({ items }: { items: FeedItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {items.map((item, index) => (
        <VideoCard key={item.id} item={item} eager={index === 0} index={index} />
      ))}
    </div>
  );
}

function cardBadge(item: FeedItem) {
  if (item.kind === "image") return item.imageCount > 0 ? `${item.imageCount}图` : "图集";
  if (item.kind === "post") return "动态";
  return item.partCount && item.partCount > 1 ? `${item.partCount}P` : null;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : "";
}
