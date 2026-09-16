import type { MessageResponse } from "@/lib/api";
import { serverGet } from "@/lib/server-api";
import { MessagesClient } from "./_components/MessagesClient";

/**
 * 消息页改成 Server Component 取数：消息里的封面 URL 随 HTML 一起到达。
 */
export default async function MessagesPage() {
  const messages = await serverGet<MessageResponse>("/me/messages?limit=80");

  // fallback 的 key 必须与客户端 useApi 的 key 完全一致
  const fallback: Record<string, unknown> = {};
  if (messages) fallback["/me/messages?limit=80"] = messages;

  return <MessagesClient fallback={fallback} />;
}