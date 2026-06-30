"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";

// SWR 全局默认配置：聚焦时重新校验、2 秒内去重、错误最多重试 2 次。
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: true,
        dedupingInterval: 2000,
        errorRetryCount: 2
      }}
    >
      {children}
    </SWRConfig>
  );
}
