import type { CreatorDetail, CreatorItemsResponse } from "@/lib/api";
import { serverGet } from "@/lib/server-api";
import { CreatorClient } from "./_components/CreatorClient";

/**
 * UP 主页改成 Server Component 取数：主页资料与第一页投稿并行请求，随 HTML 一起到达。
 *
 * 这里用 serverGet（不区分 404）：该页原来的 404 表现是页面内提示「这个 UP 暂时找不到」，
 * 保持不变；取数失败则留给客户端 SWR 重试。
 */
export default async function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // key 必须与客户端 useApi 的 key 完全一致（默认 kind=all → items 不带 kind 参数）
  const profileKey = `/creators/${id}`;
  const itemsKey = `/creators/${id}/items?limit=24`;

  const [profile, items] = await Promise.all([
    serverGet<CreatorDetail>(profileKey),
    serverGet<CreatorItemsResponse>(itemsKey)
  ]);

  const fallback: Record<string, unknown> = {};
  if (profile) fallback[profileKey] = profile;
  if (items) fallback[itemsKey] = items;

  return <CreatorClient id={id} fallback={fallback} />;
}