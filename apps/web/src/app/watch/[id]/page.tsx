"use client";

import { Ban, MoreHorizontal, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CompactVideoCard } from "@/components/VideoCard";
import { VideoPlayer } from "@/components/VideoPlayer";
import { getJson, postJson, putJson, type ItemDetail } from "@/lib/api";
import type { Reaction } from "@hilihili/shared";

export default function WatchPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [comment, setComment] = useState("");
  const [activePartIndex, setActivePartIndex] = useState(0);
  const [sideTab, setSideTab] = useState<"parts" | "related">("related");
  const [reaction, setReaction] = useState<Reaction>(null);
  const [blacklisted, setBlacklisted] = useState(false);

  useEffect(() => {
    let ignore = false;
    void getJson<ItemDetail>(`/items/${params.id}`).then((response) => {
      if (ignore) return;
      setDetail(response);
      setReaction(response.item.reaction);
      setBlacklisted(Boolean(response.item.creatorBlacklisted));
      const resumeIndex = response.parts.findIndex((part) => part.id === response.item.resumePartId);
      setActivePartIndex(resumeIndex >= 0 ? resumeIndex : 0);
      if (response.parts.length > 1) setSideTab("parts");
    });
    return () => { ignore = true; };
  }, [params.id]);

  async function toggleReaction(next: Exclude<Reaction, null>) {
    const value = reaction === next ? null : next;
    setReaction(value);
    await putJson(`/items/${params.id}/reaction`, { reaction: value });
  }

  async function toggleBlacklist() {
    const creatorId = detail?.item.creator_id;
    if (!creatorId) return;
    const next = !blacklisted;
    setBlacklisted(next);
    await putJson(`/creators/${creatorId}/blacklist`, { blacklisted: next });
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comment.trim()) return;
    await postJson(`/items/${params.id}/comments`, { body: comment });
    setComment("");
    setDetail(await getJson<ItemDetail>(`/items/${params.id}`));
  }

  const activePart = detail?.parts[activePartIndex];

  return (
    <AppShell wide>
      {!detail ? <WatchSkeleton /> : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <main className="min-w-0">
            <VideoPlayer
              itemId={detail.item.id}
              part={activePart}
              resumePosition={activePart?.id === detail.item.resumePartId ? detail.item.resumePositionSeconds ?? 0 : 0}
              onEnded={() => { if (activePartIndex < detail.parts.length - 1) setActivePartIndex((value) => value + 1); }}
            />

            <section className="border-b border-white/8 py-5">
              <h1 className="text-xl font-semibold leading-8 md:text-2xl">{detail.item.title}</h1>
              <p className="mt-1 text-sm text-white/45">{detail.item.creatorName} · {detail.item.categoryName}</p>
              <div className="mt-4 flex items-center gap-2">
                <button className={`action-button ${reaction === "like" ? "active" : ""}`} onClick={() => void toggleReaction("like")}><ThumbsUp size={18} fill={reaction === "like" ? "currentColor" : "none"} /> 喜欢</button>
                <button className={`action-button ${reaction === "dislike" ? "active" : ""}`} onClick={() => void toggleReaction("dislike")}><ThumbsDown size={18} fill={reaction === "dislike" ? "currentColor" : "none"} /> 不喜欢</button>
                <details className="relative ml-auto">
                  <summary className="icon-button cursor-pointer list-none" aria-label="更多操作"><MoreHorizontal size={19} /></summary>
                  <div className="absolute right-0 top-11 z-20 w-44 rounded-xl border border-white/10 bg-[#1a1c22] p-1.5 shadow-2xl">
                    <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/70 hover:bg-white/8 hover:text-white" onClick={() => void toggleBlacklist()}><Ban size={17} />{blacklisted ? "取消屏蔽该 UP" : "屏蔽该 UP"}</button>
                  </div>
                </details>
              </div>
            </section>

            <section className="mt-6 rounded-xl border border-white/8 bg-white/[0.025] p-4 md:p-5">
              <h2 className="font-semibold">评论和笔记</h2>
              <form className="mt-4 flex gap-2" onSubmit={submitComment}>
                <input value={comment} onChange={(event) => setComment(event.target.value)} className="field min-w-0 flex-1" placeholder="记录此刻的想法…" />
                <button className="primary-button"><Send size={16} /> 发送</button>
              </form>
              <div className="mt-4 space-y-3">
                {detail.comments.length === 0 ? <p className="py-6 text-center text-sm text-white/35">还没有笔记</p> : detail.comments.map((item) => <div key={item.id} className="rounded-lg bg-black/20 p-3 text-sm text-white/78">{item.body}</div>)}
              </div>
            </section>
          </main>

          <aside className="overflow-hidden rounded-xl border border-white/8 bg-white/[0.025] lg:sticky lg:top-20">
            <div className="grid grid-cols-2 border-b border-white/8 p-1.5">
              <button className={`side-tab ${sideTab === "parts" ? "active" : ""}`} onClick={() => setSideTab("parts")}>选集 {detail.parts.length > 1 ? detail.parts.length : ""}</button>
              <button className={`side-tab ${sideTab === "related" ? "active" : ""}`} onClick={() => setSideTab("related")}>相关推荐</button>
            </div>
            <div className="max-h-[calc(100vh-9rem)] space-y-1 overflow-y-auto p-2">
              {sideTab === "parts" ? detail.parts.map((part, index) => (
                <button key={part.id} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm transition ${index === activePartIndex ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-white/68 hover:bg-white/6 hover:text-white"}`} onClick={() => setActivePartIndex(index)}>
                  <span className="w-8 shrink-0 font-mono text-xs text-white/35">P{part.partIndex}</span><span className="line-clamp-2">{part.title}</span>
                </button>
              )) : detail.related.map((item) => <CompactVideoCard key={item.id} item={item} />)}
            </div>
          </aside>
        </div>
      )}
    </AppShell>
  );
}

function WatchSkeleton() {
  return <div className="grid animate-pulse gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"><div><div className="aspect-video rounded-xl bg-white/5" /><div className="mt-5 h-7 w-2/3 rounded bg-white/5" /></div><div className="h-[60vh] rounded-xl bg-white/5" /></div>;
}
