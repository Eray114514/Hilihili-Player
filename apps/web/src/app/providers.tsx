"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";

// SWR 全局默认配置：聚焦时重新校验、2 秒内去重、错误最多重试 2 次。
// fallback 由服务端 layout 预取后注入，首屏直接命中 SWR 缓存（消除骨架闪烁）。
export function Providers({ children, fallback }: { children: ReactNode; fallback?: Record<string, unknown> }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: true,
        dedupingInterval: 2000,
        errorRetryCount: 2,
        fallback
      }}
    >
      {children}
    </SWRConfig>
  );
}
