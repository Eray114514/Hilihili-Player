// 日期格式化：日期型（月/日）+ 日期时间型（月/日 时:分）

// 日期型：仅月/日，用于卡片等紧凑展示位
export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })
    : "";
}

// 日期时间型：月/日 时:分，用于消息、收藏等需要时间点的展示位
export function formatDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";
}
