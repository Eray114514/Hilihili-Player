"use client";

import { ImageIcon, Play } from "lucide-react";
import Link from "next/link";
import type { FeedItem } from "@hilihili/shared";
import { assetUrl } from "@/lib/api";

export function VideoCard({ item }: { item: FeedItem }) {
  const cover = assetUrl(item.coverUrl);

  return (
    <Link href={item.kind === "video" ? `/watch/${item.id}` : `/dynamic?item=${item.id}`} className="group block min-w-0">
      <div className="relative aspect-video overflow-hidden rounded-lg bg-[#1a1b20] ring-1 ring-white/8">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt={item.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.035]" />
        ) : (
          <div className="grid h-full place-items-center bg-[linear-gradient(135deg,#24252b,#15161b_55%,#2b2020)] text-white/40">
            {item.kind === "image" ? <ImageIcon size={34} /> : <Play size={34} />}
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
      <p className="mt-1 truncate text-xs text-white/45">{item.categoryName}</p>
    </Link>
  );
}

export function VideoGrid({ items }: { items: FeedItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {items.map((item) => (
        <VideoCard key={item.id} item={item} />
      ))}
    </div>
  );
}
