import type { FeedResponse } from "@/lib/api";
import { serverGet } from "@/lib/server-api";
import { CategoryClient } from "./_components/CategoryClient";

/**
 * 分区页改成 Server Component 取数：封面 URL 随 HTML 一起到达，图片立即开始下载。
 */
export default async function CategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // key 必须与客户端 useApi 的 key 完全一致（原来就是不带 query 的写法）
  const key = `/feeds/category/${id}`;
  const feed = await serverGet<FeedResponse>(key);

  const fallback: Record<string, unknown> = {};
  if (feed) fallback[key] = feed;

  return <CategoryClient id={id} fallback={fallback} />;
}