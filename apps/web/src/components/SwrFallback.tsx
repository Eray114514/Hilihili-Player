"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";

/**
 * 把 Server Component 取到的数据注入 SWR 缓存。
 *
 * 页面级注入（而不是 layout 全局注入）的原因：原来 layout 为了给首页的分类栏预热，
 * 对每个页面都先 await 一次 /categories，等于所有页面的 HTML 首字节都被一次 API 往返挡住。
 * 现在只有真正需要这些数据的页面才付这份代价，并且包在自己的 Suspense 边界里。
 *
 * 配合 providers 里的 revalidateIfStale: false，挂载时不会立刻重拉一遍。
 */
export function SwrFallback({ data, children }: { data: Record<string, unknown>; children: ReactNode }) {
  return <SWRConfig value={{ fallback: data }}>{children}</SWRConfig>;
}