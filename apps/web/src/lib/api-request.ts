import type { SearchHistoryItem } from "@hilihili/shared";
import { apiUrl } from "./api-base";

// 纯请求层：不依赖 swr，也不依赖 window，Server Component 与客户端都能用。
// 单次请求超时：异地组网链路抖动时不能让页面无限等下去（原来全是裸 fetch，没有超时）
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * 统一出口：加超时，幂等请求额外重试一次。
 * 只对 GET 这类幂等请求重试；写操作重试可能造成重复提交，必须由调用方自己决定。
 */
export async function apiFetch(path: string, init: RequestInit & { retry?: boolean } = {}): Promise<Response> {
  const { retry = false, ...rest } = init;
  const attempt = () => fetch(apiUrl(path), { ...rest, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  try {
    return await attempt();
  } catch (error) {
    if (!retry) throw error;
    return attempt();
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path, { retry: true });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export async function putJson<T>(path: string, body: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export type DeleteJsonOptions = { ignoreNotFound?: boolean };

// 传 `ignoreNotFound: true` 时，404 返回 null 而非抛错（用于乐观删除场景）；
// 其他情况行为不变，仍抛错并保留 Promise<T> 返回类型。
export function deleteJson<T>(path: string, options: { ignoreNotFound: true }): Promise<T | null>;
export function deleteJson<T>(path: string, options?: DeleteJsonOptions): Promise<T>;
export async function deleteJson<T>(path: string, options?: DeleteJsonOptions): Promise<T | null> {
  const response = await apiFetch(path, { method: "DELETE" });
  if (!response.ok) {
    if (response.status === 404 && options?.ignoreNotFound) {
      return null;
    }
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export async function getSearchHistory(): Promise<{ items: SearchHistoryItem[] }> {
  return getJson<{ items: SearchHistoryItem[] }>("/me/search-history");
}

export async function clearSearchHistory(): Promise<void> {
  await deleteJson<{ ok: boolean }>("/me/search-history");
}

export async function deleteSearchHistory(id: string): Promise<void> {
  await deleteJson<{ ok: boolean }>(`/me/search-history/${encodeURIComponent(id)}`);
}