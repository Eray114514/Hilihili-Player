"use client";

import useSWR, { type SWRConfiguration } from "swr";
import { apiFetch, getJson } from "./api-request";

// 客户端专用层：唯一 import swr 的地方。
// 只有被 "use client" 组件引用时才进构建图，因此 RSC 可以安全 import @/lib/api 的类型与请求函数。

// SWR fetcher：复用 getJson 的错误处理，但不强制 cache: "no-store"
// （SWR 自己管缓存去重，底层 fetch 走默认 HTTP 缓存策略）
export async function apiFetcher<T>(path: string): Promise<T> {
  const response = await apiFetch(path, { retry: true });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

// 通用 useApi hook：path 为 null 时不发请求（用于条件请求）
export function useApi<T>(path: string | null, options?: SWRConfiguration<T>) {
  return useSWR<T>(path, apiFetcher, options);
}

export { getJson };