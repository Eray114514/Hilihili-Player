"use client";

import { BellRing, Inbox, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ApiImage } from "@/components/ApiImage";
import { CreatorAvatar } from "@/components/CreatorAvatar";
import { assetUrl, getJson, putJson, type MessageResponse } from "@/lib/api";

export default function MessagesPage() {
  const [data, setData] = useState<MessageResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let ignore = false;
    void putJson("/me/messages/read", {}).then(() => getJson<MessageResponse>("/me/messages?limit=80"))
      .then((response) => { if (!ignore) setData(response); })
      .catch(() => { if (!ignore) setFailed(true); });
    return () => { ignore = true; };
  }, []);

  return <AppShell><div className="mx-auto max-w-4xl"><section className="mb-6 rounded-3xl border border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(94,234,212,.15),transparent_35%),#11151c] p-5 md:p-7"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"><BellRing size={21} /></span><div><p className="text-xs font-medium uppercase tracking-[.16em] text-[var(--accent)]/75">Video inbox</p><h1 className="mt-1 text-2xl font-semibold md:text-3xl">视频消息</h1></div></div><p className="mt-4 text-sm leading-6 text-white/50">特别关注的 UP 有新视频入库时，会在这里等你。打开此页后消息已全部标记为已读。</p></section>{failed ? <MessageState title="消息暂时加载失败" body="请确认 API 服务正在运行后再试一次。" /> : !data ? <MessageSkeleton /> : data.messages.length === 0 ? <MessageState title="还没有新视频消息" body="到喜欢的 UP 主页点下“特别关注”，下次扫描发现新视频时就会出现在这里。" /> : <div className="space-y-3">{data.messages.map((message) => <MessageCard key={message.id} message={message} />)}</div>}</div></AppShell>;
}

function MessageCard({ message }: { message: MessageResponse["messages"][number] }) {
  const href = message.item.playable ? `/watch/${message.item.id}` : `/dynamic/${message.item.id}`;
  const cover = assetUrl(message.item.coverUrl);
  return <article className="flex flex-col gap-4 rounded-2xl border border-white/8 bg-white/[0.028] p-3 transition hover:border-white/15 sm:flex-row sm:items-center"><Link href={href} className="relative aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-black/25 sm:w-52">{cover ? <ApiImage src={cover} alt={message.item.title} fill sizes="208px" className="object-cover transition hover:scale-105" /> : <span className="grid h-full place-items-center text-white/30"><Play size={30} /></span>}</Link><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><CreatorAvatar creatorId={message.item.creatorId} name={message.item.creatorName} avatarUrl={message.item.creatorAvatarUrl} size="sm" /><Link href={message.item.creatorId ? `/creator/${message.item.creatorId}` : href} className="truncate text-sm font-medium hover:text-[var(--accent)]">{message.item.creatorName}</Link><span className="text-xs text-white/34">发布了新视频</span></div><Link href={href} className="mt-3 block line-clamp-2 text-base font-semibold leading-6 hover:text-[var(--accent)]">{message.item.title}</Link><div className="mt-2 flex items-center gap-3 text-xs text-white/38"><time>{formatDate(message.createdAt)}</time><span>{message.item.categoryName}</span>{message.item.partCount && message.item.partCount > 1 ? <span>{message.item.partCount} P</span> : null}</div></div><Link href={href} className="secondary-button shrink-0 justify-center"><Play size={15} />播放</Link></article>;
}

function MessageState({ title, body }: { title: string; body: string }) { return <div className="grid min-h-[360px] place-items-center rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center"><div><Inbox className="mx-auto mb-4 text-white/25" size={38} /><h2 className="text-lg font-semibold">{title}</h2><p className="mt-2 max-w-md text-sm leading-6 text-white/45">{body}</p></div></div>; }
function MessageSkeleton() { return <div className="space-y-3 animate-pulse">{Array.from({ length: 5 }, (_, index) => <div key={index} className="flex gap-4 rounded-2xl border border-white/6 bg-white/[0.025] p-3"><div className="aspect-video w-52 rounded-xl bg-white/6" /><div className="flex-1 py-2"><div className="h-4 w-32 rounded bg-white/6" /><div className="mt-4 h-5 w-2/3 rounded bg-white/6" /></div></div>)}</div>; }
function formatDate(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "刚刚"; }
