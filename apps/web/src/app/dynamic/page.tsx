import type { FeedResponse } from "@/lib/api";
import { serverGet } from "@/lib/server-api";
import { DynamicClient } from "./_components/DynamicClient";

const DYNAMIC_LIMIT = 80;
const DYNAMIC_SORT = "newest";
const DYNAMIC_KIND = "all";
// 默认 seed 是固定值（原客户端 useState 的初值），这里在服务端确定后下发给客户端，
// 保证 SSR 出的 fallback key 与客户端 useApi 的 key 完全一致。
const DYNAMIC_SEED = "dynamic";

/**
 * 动态页改成 Server Component 取数。
 *
 * 原来首屏要等 JS 下载 + hydrate 之后才知道要请求哪一页动态，
 * 高 RTT 链路上「HTML → JS → JSON → 图片」四段串行。现在第一页动态随 HTML 一起到达。
 */
export default async function DynamicPage() {
  const initialKey = `/feeds/dynamic?limit=${DYNAMIC_LIMIT}&sort=${DYNAMIC_SORT}&kind=${DYNAMIC_KIND}&seed=${DYNAMIC_SEED}`;
  const feed = await serverGet<FeedResponse>(initialKey);

  const fallback: Record<string, unknown> = {};
  if (feed) fallback[initialKey] = feed;

  return <DynamicClient initialSeed={DYNAMIC_SEED} fallback={fallback} />;
}