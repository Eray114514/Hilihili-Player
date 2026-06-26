"use client";

import { ExternalLink, FileText, ImageIcon, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { FeedItem } from "@hilihili/shared";
import { assetUrl } from "@/lib/api";
import { CreatorAvatar } from "@/components/CreatorAvatar";
import { ImageMosaic } from "@/components/ImageMosaic";
import { VideoPreview } from "@/components/VideoPreview";

export function DynamicFeedCard({ item }: { item: FeedItem }) {
  const [expanded, setExpanded] = useState(false);
  const detailHref = `/dynamic/${item.id}`;
  const creatorLabel = item.creatorAlias ? `${item.creatorName} · ${item.creatorAlias}` : item.creatorName;
  return (
    <article className="rounded-2xl border border-white/8 bg-[#12151c] p-4 shadow-[0_18px_50px_rgba(0,0,0,.12)] md:p-5">
      <header className="flex gap-3">
        <CreatorAvatar creatorId={item.creatorId} name={item.creatorName} avatarUrl={item.creatorAvatarUrl} />
        <div className="min-w-0 flex-1">
          {item.creatorId ? <Link href={`/creator/${item.creatorId}`} className="font-semibold text-white hover:text-[var(--accent)]">{creatorLabel}</Link> : <span className="font-semibold">{creatorLabel}</span>}
          <p className="mt-0.5 text-xs text-white/38"><time>{formatDate(item.displayDate)}</time><span className="mx-1.5">·</span>{item.categoryName}</p>
        </div>
        <span className="h-fit rounded-full bg-white/6 px-2.5 py-1 text-[11px] text-white/45">{kindLabel(item.kind)}</span>
      </header>

      <div className="pl-0 md:pl-14">
        <Link href={detailHref} className="mt-4 block text-[17px] font-semibold leading-7 text-white/92 hover:text-[var(--accent)]">{item.title}</Link>
        {item.postExcerpt ? (
          <div className="mt-2 text-[15px] leading-7 text-white/72">
            <p className={expanded ? "whitespace-pre-wrap" : "line-clamp-3"}>{item.postExcerpt}</p>
            {item.postExcerpt.length > 120 ? <button type="button" className="mt-1 text-sm text-[var(--accent)]" onClick={() => setExpanded((value) => !value)}>{expanded ? "收起" : "展开"}</button> : null}
          </div>
        ) : null}

        <ImageMosaic images={item.previewImages} total={item.imageCount} href={detailHref} />

        {item.playable ? (
          <Link href={`/watch/${item.id}`} className="group mt-4 flex overflow-hidden rounded-xl border border-white/8 bg-black/22 transition hover:border-white/16 hover:bg-white/[0.035]">
            <div className="relative aspect-video w-44 shrink-0 overflow-hidden bg-white/5 sm:w-56">
              <VideoPreview previewPartId={item.previewPartId} posterUrl={assetUrl(item.coverUrl)} alt={item.title} sizes="224px" fallback={<span className="grid h-full place-items-center text-white/28"><Play size={30} /></span>} />
            </div>
            <div className="min-w-0 p-3 sm:p-4">
              <p className="line-clamp-2 text-sm font-medium leading-6 text-white/85">{item.title}</p>
              <p className="mt-2 text-xs text-white/38">{item.partCount && item.partCount > 1 ? `${item.partCount} 个分 P` : "视频"}</p>
            </div>
          </Link>
        ) : null}

        <footer className="mt-4 flex items-center gap-2 border-t border-white/6 pt-3 text-xs text-white/45">
          <Link href={detailHref} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 hover:bg-white/6 hover:text-white"><ExternalLink size={14} /> 查看原动态</Link>
          {item.imageCount > 0 ? <span className="ml-auto inline-flex items-center gap-1"><ImageIcon size={14} /> {item.imageCount}</span> : item.postExcerpt ? <span className="ml-auto inline-flex items-center gap-1"><FileText size={14} /> 图文</span> : null}
        </footer>
      </div>
    </article>
  );
}

function kindLabel(kind: FeedItem["kind"]) {
  return kind === "post" ? "图文" : kind === "image" ? "图集" : "视频";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "日期未知";
}
