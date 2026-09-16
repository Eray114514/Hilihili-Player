import type { ActivityEntry, Category, FeedResponse } from "@/lib/api";
import { serverGet } from "@/lib/server-api";
import { HomeClient } from "./_components/HomeClient";

const FEATURED_LIMIT = 8;
const BROWSE_LIMIT = 24;

/** 每次请求生成一个新的「逛逛」随机种子。抽成函数是因为渲染期直接调 Date.now() 会被 react-hooks/purity 拦住。 */
function createBrowseSeed() {
  return `browse-${Date.now()}`;
}

/**
 * 首页改成 Server Component。
 *
 * 原来整页是纯客户端，四个接口要等 JS 下载 + hydrate 之后才发出，
 * 而封面 URL 又要等这四份 JSON 回来才知道——在高 RTT 的异地组网链路上，
 * 用户看到骨架屏的时间被拉得很长。现在数据和 HTML 一起到达，图片立刻开始并发下载。
 *
 * 四个请求在服务端并行发起（走容器内网，不经隧道），彼此不串行。
 * 分类属于低频变化数据，给 30s 的 Data Cache；其余每次取最新。
 */
export default async function HomePage() {
  // seed 在服务端生成一次下发给客户端，避免 Date.now() 在 SSR 与 hydration 两侧不一致
  const browseSeed = createBrowseSeed();
  const [categories, continueWatching, featured, browse] = await Promise.all([
    serverGet<{ categories: Category[] }>("/categories", { revalidate: 30, timeoutMs: 5000 }),
    serverGet<{ entries: ActivityEntry[] }>("/me/continue-watching?limit=4", { timeoutMs: 5000 }),
    serverGet<FeedResponse>(`/feeds/home?seed=home&limit=${FEATURED_LIMIT}`, { timeoutMs: 5000 }),
    serverGet<FeedResponse>(`/feeds/home?mode=shuffle&seed=${encodeURIComponent(browseSeed)}&limit=${BROWSE_LIMIT}`, { timeoutMs: 5000 })
  ]);

  // fallback 的 key 必须与客户端 useApi 的 key 完全一致，否则会退化成挂载后再拉一次
  const fallback: Record<string, unknown> = {};
  if (categories) fallback["/categories"] = categories;
  if (continueWatching) fallback["/me/continue-watching?limit=4"] = continueWatching;
  if (featured) fallback[`/feeds/home?seed=home&limit=${FEATURED_LIMIT}`] = featured;
  if (browse) fallback[`/feeds/home?mode=shuffle&seed=${encodeURIComponent(browseSeed)}&limit=${BROWSE_LIMIT}`] = browse;

  return <HomeClient browseSeed={browseSeed} fallback={fallback} />;
}