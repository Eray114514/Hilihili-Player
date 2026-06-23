"use client";

import { ImageIcon, LoaderCircle, Play } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { FeedItem } from "@hilihili/shared";
import { assetUrl } from "@/lib/api";

export function VideoCard({ item, eager = false }: { item: FeedItem; eager?: boolean }) {
  const cover = assetUrl(item.coverUrl);

  return (
    <Link href={item.kind === "video" ? `/watch/${item.id}` : `/dynamic?item=${item.id}`} className="group block min-w-0">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-[#1a1b20] ring-1 ring-white/8">
        {cover ? (
          <Image src={cover} alt={item.title} fill unoptimized loading={eager ? "eager" : "lazy"} sizes="(min-width: 1536px) 16vw, (min-width: 768px) 25vw, 50vw" className="object-cover transition duration-300 group-hover:scale-[1.035]" />
        ) : (
          <div className="grid h-full place-items-center bg-[linear-gradient(135deg,#24252b,#15161b_55%,#2b2020)] text-white/40">
            {item.thumbnailStatus === "pending" ? <LoaderCircle className="animate-spin" size={28} /> : item.kind === "image" ? <ImageIcon size={34} /> : <Play size={34} />}
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-9 text-xs text-white/82">
          <span>{item.creatorName}</span>
          {item.partCount && item.partCount > 1 ? <span>{item.partCount}P</span> : null}
        </div>
      </div>
      <h3 className="mt-2 line-clamp-2 min-h-10 text-sm font-medium leading-5 text-white transition group-hover:text-[var(--accent)]">
        {item.title}
      </h3>
      <p className="mt-1 flex items-center justify-between gap-2 truncate text-xs text-white/45"><span className="truncate">{item.categoryName}</span><time className="shrink-0">{formatDate(item.displayDate)}</time></p>
    </Link>
  );
}

export function CompactVideoCard({ item }: { item: FeedItem }) {
  const cover = assetUrl(item.coverUrl);
  return (
    <Link href={item.kind === "video" ? `/watch/${item.id}` : `/dynamic?item=${item.id}`} className="group flex gap-3 rounded-lg p-1.5 transition hover:bg-white/5">
      <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/8">
        {cover ? <Image src={cover} alt="" fill unoptimized sizes="144px" className="object-cover transition group-hover:scale-105" /> : <div className="grid h-full place-items-center text-white/35"><Play size={24} /></div>}
        {item.partCount && item.partCount > 1 ? <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px]">{item.partCount}P</span> : null}
      </div>
      <div className="min-w-0 py-0.5">
        <h3 className="line-clamp-2 text-sm font-medium leading-5 group-hover:text-[var(--accent)]">{item.title}</h3>
        <p className="mt-2 truncate text-xs text-white/45">{item.creatorName}</p>
        <time className="mt-1 block text-[11px] text-white/35">{formatDate(item.displayDate)}</time>
      </div>
    </Link>
  );
}

export function VideoGrid({ items }: { items: FeedItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {items.map((item, index) => (
        <VideoCard key={item.id} item={item} eager={index === 0} />
      ))}
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : "";
}
