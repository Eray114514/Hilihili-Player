import type { ActivityResponse } from "@/lib/api";
import { serverGet } from "@/lib/server-api";
import { HistoryClient } from "./_components/HistoryClient";

const HISTORY_TABS = ["continue", "history", "completed", "likes", "coins"] as const;
type ActivityTab = (typeof HISTORY_TABS)[number];

function parseTab(value: string | undefined): ActivityTab {
  return HISTORY_TABS.includes(value as ActivityTab) ? (value as ActivityTab) : "continue";
}

/**
 * 观看记录页改成 Server Component 取数。
 *
 * tab 初值改从 searchParams 读（原来在客户端 useSearchParams 里读），
 * 切换 tab 仍是本地 state 立即生效 + router.replace 同步 URL。
 */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;

  const activity = await serverGet<ActivityResponse>("/me/activity?limit=80");

  // fallback 的 key 必须与客户端 useApi 的 key 完全一致
  const fallback: Record<string, unknown> = {};
  if (activity) fallback["/me/activity?limit=80"] = activity;

  return <HistoryClient initialTab={parseTab(tab)} fallback={fallback} />;
}