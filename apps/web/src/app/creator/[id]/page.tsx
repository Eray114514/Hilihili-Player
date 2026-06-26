"use client";

import { Ban, Bell, BellOff, Film, ImageIcon, LoaderCircle, MoreHorizontal, Radio } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell, EmptyState } from "@/components/AppShell";
import { ApiImage } from "@/components/ApiImage";
import { CreatorAvatar } from "@/components/CreatorAvatar";
import { VideoGrid } from "@/components/VideoCard";
import { assetUrl, getJson, putJson, type CreatorDetail, type CreatorItemsResponse } from "@/lib/api";

type ContentKind = "all" | "video" | "post" | "image";

const filters: { value: ContentKind; label: string; icon: typeof Film }[] = [
  { value: "all", label: "全部投稿", icon: Film },
  { value: "video", label: "视频", icon: Film },
  { value: "post", label: "图文", icon: Radio },
  { value: "image", label: "图集", icon: ImageIcon }
];

export default function CreatorPage() {
  const params = useParams<{ id: string }>();
  const [profile, setProfile] = useState<CreatorDetail | null>(null);
  const [items, setItems] = useState<CreatorItemsResponse["items"]>([]);
  const [kind, setKind] = useState<ContentKind>("all");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<"follow" | "block" | null>(null);

  useEffect(() => {
    let ignore = false;
    const suffix = kind === "all" ? "" : `&kind=${kind}`;
    void Promise.all([getJson<CreatorDetail>(`/creators/${params.id}`), getJson<CreatorItemsResponse>(`/creators/${params.id}/items?limit=24${suffix}`)])
      .then(([detail, content]) => {
        if (ignore) return;
        setProfile(detail);
        setItems(content.items);
        setHasMore(content.hasMore);
      })
      .catch(() => { if (!ignore) setFailed(true); })
      .finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [kind, params.id]);

  async function toggleFollow() {
    if (!profile) return;
    const next = !Boolean(profile.creator.followed);
    setBusy("follow");
    try {
      await putJson(`/creators/${params.id}/follow`, { followed: next });
      setProfile((current) => current ? { ...current, creator: { ...current.creator, followed: next ? 1 : 0 } } : current);
    } finally { setBusy(null); }
  }

  async function toggleBlock() {
    if (!profile) return;
    const next = !Boolean(profile.creator.blacklisted);
    setBusy("block");
    try {
      await putJson(`/creators/${params.id}/blacklist`, { blacklisted: next });
      setProfile((current) => current ? { ...current, creator: { ...current.creator, blacklisted: next ? 1 : 0, followed: next ? 0 : current.creator.followed } } : current);
    } finally { setBusy(null); }
  }

  if (failed) return <AppShell><EmptyState title="这个 UP 暂时找不到" body="可能媒体库正在刷新，或该 UP 已不再有可展示的投稿。" /></AppShell>;
  if (!profile || loading && items.length === 0) return <CreatorSkeleton />;

  const { creator, stats, categories } = profile;
  const banner = assetUrl(creator.bannerUrl);
  return (
    <AppShell wide>
      <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#11151c] shadow-[0_24px_80px_rgba(0,0,0,.25)]">
        <div className="relative h-36 overflow-hidden sm:h-48">
          {banner ? <ApiImage src={banner} alt="" fill priority sizes="(min-width: 768px) 90vw, 100vw" className="object-cover opacity-80" /> : <GeneratedBanner name={creator.name} />}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_15%,rgba(9,12,17,.78)_100%)]" />
        </div>
        <div className="relative px-5 pb-6 sm:px-7">
          <div className="-mt-11 flex flex-col gap-4 sm:-mt-14 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 items-end gap-4">
              <CreatorAvatar creatorId={creator.id} name={creator.name} avatarUrl={creator.avatarUrl} size="lg" />
              <div className="min-w-0 pb-0.5"><h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{creator.name}</h1>{creator.alias ? <p className="mt-1 truncate text-sm text-[var(--accent)]">{creator.alias}</p> : null}</div>
            </div>
            <div className="flex items-center gap-2 sm:pb-1">
              <button disabled={busy !== null || Boolean(creator.blacklisted)} onClick={() => void toggleFollow()} className={`${creator.followed ? "secondary-button" : "primary-button"} disabled:opacity-45`}>
                {busy === "follow" ? <LoaderCircle className="animate-spin" size={16} /> : creator.followed ? <BellOff size={16} /> : <Bell size={16} />}{creator.followed ? "已特别关注" : "特别关注"}
              </button>
              <details className="relative"><summary className="icon-button list-none" aria-label="更多 UP 操作"><MoreHorizontal size={19} /></summary><div className="absolute right-0 top-11 z-20 w-44 rounded-xl border border-white/10 bg-[#1a1e26] p-1.5 shadow-2xl"><button disabled={busy !== null} onClick={() => void toggleBlock()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/70 hover:bg-white/8 hover:text-white disabled:opacity-45"><Ban size={16} />{creator.blacklisted ? "取消屏蔽" : "屏蔽该 UP"}</button></div></details>
            </div>
          </div>
          <p className="mt-5 max-w-3xl whitespace-pre-wrap text-sm leading-7 text-white/65">{creator.description || "这个 UP 还没有留下简介，但每一次投稿都已经收进这座小型放映厅。"}</p>
          <div className="mt-5 flex flex-wrap gap-2 text-sm">{categories.map((category) => <Link key={category.id} href={`/category/${category.id}`} className="rounded-full border border-white/8 bg-white/[0.045] px-3 py-1.5 text-white/55 transition hover:border-[rgba(94,234,212,.35)] hover:text-[var(--accent)]">{category.name}<span className="ml-1.5 font-mono text-xs text-white/30">{category.itemCount}</span></Link>)}</div>
        </div>
      </section>

      <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[
        ["全部投稿", stats.itemCount], ["视频", stats.videoCount], ["图文", stats.postCount], ["图集", stats.imageCount]
      ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-white/8 bg-white/[0.028] p-4"><div className="font-mono text-2xl font-semibold tabular-nums">{Number(value ?? 0)}</div><div className="mt-1 text-xs text-white/42">{label}</div></div>)}</section>

      <section className="mt-9">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-xs font-medium uppercase tracking-[.18em] text-[var(--accent)]/75">Archive</p><h2 className="mt-1 text-2xl font-semibold">投稿列表</h2></div><div className="filter-group self-start sm:self-auto">{filters.map((filter) => { const Icon = filter.icon; return <button type="button" key={filter.value} className={kind === filter.value ? "active" : ""} onClick={() => { if (kind !== filter.value) { setLoading(true); setFailed(false); setKind(filter.value); } }}><Icon className="mr-1 inline" size={14} />{filter.label}</button>; })}</div></div>
        <div className="mt-6">{loading ? <GridSkeleton /> : items.length === 0 ? <EmptyState title="这里还没有这类投稿" body="换一个内容分类，或者等待媒体库完成下一次扫描。" /> : <VideoGrid items={items} />}</div>
        {hasMore ? <div className="flex justify-center pt-10"><button disabled={loadingMore} onClick={() => { const suffix = kind === "all" ? "" : `&kind=${kind}`; setLoadingMore(true); void getJson<CreatorItemsResponse>(`/creators/${params.id}/items?limit=24&offset=${items.length}${suffix}`).then((response) => { setItems((current) => [...current, ...response.items]); setHasMore(response.hasMore); }).finally(() => setLoadingMore(false)); }} className="secondary-button">{loadingMore ? <LoaderCircle className="animate-spin" size={16} /> : null}{loadingMore ? "正在加载…" : "加载更多投稿"}</button></div> : null}
      </section>
    </AppShell>
  );
}

function GeneratedBanner({ name }: { name: string }) {
  let hash = 0; for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return <div className="absolute inset-0" style={{ background: `radial-gradient(circle at 18% 12%, hsl(${hue} 70% 56% / .56), transparent 32%), radial-gradient(circle at 85% 18%, hsl(${(hue + 65) % 360} 72% 55% / .38), transparent 36%), linear-gradient(125deg, hsl(${(hue + 220) % 360} 34% 17%), #111820 58%, hsl(${hue} 25% 15%))` }} />;
}

function CreatorSkeleton() { return <AppShell wide><div className="animate-pulse overflow-hidden rounded-3xl border border-white/8"><div className="h-48 bg-white/5" /><div className="p-7"><div className="h-14 w-14 -mt-20 rounded-full bg-white/10" /><div className="mt-5 h-8 w-52 rounded bg-white/6" /><div className="mt-3 h-4 max-w-xl rounded bg-white/[0.04]" /></div></div><GridSkeleton /></AppShell>; }
function GridSkeleton() { return <div className="mt-6 grid animate-pulse grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">{Array.from({ length: 10 }, (_, index) => <div key={index}><div className="aspect-video rounded-xl bg-white/5" /><div className="mt-2 h-4 rounded bg-white/5" /></div>)}</div>; }
