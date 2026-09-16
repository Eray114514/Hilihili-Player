import type { SearchResponse } from "@/lib/api";
import { serverGet } from "@/lib/server-api";
import { SearchClient } from "./_components/SearchClient";

const PAGE_SIZE = 48;

/**
 * 搜索页改成 Server Component 取数。
 *
 * 搜索框是原生 GET 表单提交（整页导航），所以这里按 ?q= 服务端取第一页结果即可，
 * 交互（“加载更多”仍是客户端）与原来完全一致。
 */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  // fallback 的 key 必须与客户端 useApi 的 key 完全一致
  const key = query ? `/search?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}` : null;
  const results = key ? await serverGet<SearchResponse>(key) : null;

  const fallback: Record<string, unknown> = {};
  if (key && results) fallback[key] = results;

  return <SearchClient initialQuery={query} fallback={fallback} />;
}