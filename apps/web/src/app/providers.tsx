"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";

// SWR 全局默认配置。
//
// 这里刻意关掉了「挂载即重验」与「聚焦即重验」：首屏数据已经由 Server Component 直出，
// 再重拉一遍等于把省下的往返又还回去；异地组网带宽受限时这笔开销很显眼。
// 需要轮询的地方（未读消息）单独在自己的 useApi 里开 refreshInterval。
export function Providers({ children, fallback }: { children: ReactNode; fallback?: Record<string, unknown> }) {
  return (
    <SWRConfig
      value={{
        revalidateIfStale: false,
        revalidateOnFocus: false,
        revalidateOnReconnect: true,
        dedupingInterval: 10000,
        errorRetryCount: 2,
        fallback
      }}
    >
      {children}
    </SWRConfig>
  );
}