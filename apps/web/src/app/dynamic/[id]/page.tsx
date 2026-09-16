import { notFound } from "next/navigation";
import type { ItemDetail } from "@/lib/api";
import { serverFetch } from "@/lib/server-api";
import { DynamicDetailClient } from "./_components/DynamicDetailClient";

/**
 * 动态详情改成 Server Component 取数。
 *
 * 只有上游明确 404 才走 notFound()；链路失败留给客户端 SWR 重试（见 serverFetch 注释）。
 */
export default async function DynamicDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detailResult = await serverFetch<ItemDetail>(`/items/${encodeURIComponent(id)}`);

  if (detailResult.status === "missing") {
    notFound();
  }

  // fallback 的 key 必须与客户端 useApi 的 key 完全一致
  const fallback: Record<string, unknown> = {};
  if (detailResult.status === "ok") {
    fallback[`/items/${id}`] = detailResult.data;
  }

  return <DynamicDetailClient id={id} fallback={fallback} />;
}