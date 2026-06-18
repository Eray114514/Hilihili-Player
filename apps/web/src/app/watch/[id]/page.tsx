"use client";

import { Ban, ThumbsDown, ThumbsUp } from "lucide-react";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { VideoGrid } from "@/components/VideoCard";
import { VideoPlayer } from "@/components/VideoPlayer";
import { getJson, postJson, type ItemDetail } from "@/lib/api";

export default function WatchPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [comment, setComment] = useState("");

  useEffect(() => {
    void getJson<ItemDetail>(`/items/${params.id}`).then(setDetail);
  }, [params.id]);

  async function interact(kind: "like" | "dislike" | "blacklist_up") {
    await postJson(`/items/${params.id}/interactions`, { kind });
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!comment.trim()) {
      return;
    }
    await postJson(`/items/${params.id}/comments`, { body: comment });
    setComment("");
    setDetail(await getJson<ItemDetail>(`/items/${params.id}`));
  }

  return (
    <AppShell>
      {!detail ? (
        <div className="h-[60vh] rounded-lg bg-white/[0.035]" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div>
            <VideoPlayer itemId={detail.item.id} parts={detail.parts} />
            <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold md:text-2xl">{detail.item.title}</h1>
                <p className="mt-2 text-sm text-white/50">
                  {detail.item.creatorName} / {detail.item.categoryName}
                </p>
              </div>
              <div className="flex gap-2">
                <button className="icon-button" onClick={() => interact("like")} title="点赞">
                  <ThumbsUp size={18} />
                </button>
                <button className="icon-button" onClick={() => interact("dislike")} title="点踩">
                  <ThumbsDown size={18} />
                </button>
                <button className="icon-button" onClick={() => interact("blacklist_up")} title="拉黑 UP">
                  <Ban size={18} />
                </button>
              </div>
            </div>

            <section className="mt-6 rounded-lg border border-white/8 bg-white/[0.035] p-4">
              <h2 className="font-semibold">评论和笔记</h2>
              <form className="mt-4 flex gap-2" onSubmit={submitComment}>
                <input
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/22 px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  placeholder="写一点自己的吐槽或笔记"
                />
                <button className="primary-button">发送</button>
              </form>
              <div className="mt-4 space-y-3">
                {detail.comments.map((item) => (
                  <div key={item.id} className="rounded-lg bg-black/22 p-3 text-sm text-white/82">
                    {item.body}
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside>
            <h2 className="mb-4 font-semibold">更多推荐</h2>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-1">
              <VideoGrid items={detail.related.slice(0, 8)} />
            </div>
          </aside>
        </div>
      )}
    </AppShell>
  );
}
