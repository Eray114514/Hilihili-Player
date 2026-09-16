import { notFound } from "next/navigation";
import type { FavoriteListResponse, ItemDetail } from "@/lib/api";
import { serverFetch } from "@/lib/server-api";
import { WatchClient } from "./_components/WatchClient";

/**
 * 播放页改成 Server Component 取数。
 *
 * 原来这一页是纯客户端：HTML → JS chunk → /items/:id 的 JSON → 才拿到封面/字幕/相关推荐的 URL，
 * 四段串行。在异地组网这种高 RTT 链路上，最后一段图片往往要等上一秒以上才开始下载。
 * 现在数据和 HTML 一起到达，浏览器拿到首屏就能并发拉封面。
 */
export default async function WatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detailResult, foldersResult] = await Promise.all([
    serverFetch<ItemDetail>(`/items/${encodeURIComponent(id)}`),
    serverFetch<FavoriteListResponse>("/me/favorites")
  ]);

  // 只有上游明确 404 才走 notFound()；链路失败留给客户端 SWR 重试（见 serverFetch 注释）
  if (detailResult.status === "missing") {
    notFound();
  }

  const fallback: Record<string, unknown> = {};
  if (detailResult.status === "ok") {
    fallback[`/items/${id}`] = detailResult.data;
  }
  if (foldersResult.status === "ok") {
    fallback["/me/favorites"] = foldersResult.data;
  }

  return <WatchClient itemId={id} fallback={fallback} />;
}