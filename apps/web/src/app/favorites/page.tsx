import type { FavoriteListResponse } from "@/lib/api";
import { serverGet } from "@/lib/server-api";
import { FavoritesClient } from "./_components/FavoritesClient";

/**
 * 收藏夹页改成 Server Component 取数。
 *
 * 夹内条目是条件请求（activeFolder 为 null 时不发），服务端只注入 /me/favorites 这一个 key。
 */
export default async function FavoritesPage() {
  const folders = await serverGet<FavoriteListResponse>("/me/favorites");

  // fallback 的 key 必须与客户端 useApi 的 key 完全一致
  const fallback: Record<string, unknown> = {};
  if (folders) fallback["/me/favorites"] = folders;

  return <FavoritesClient fallback={fallback} />;
}