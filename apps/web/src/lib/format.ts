// 日期格式化：日期型（月/日）+ 日期时间型（月/日 时:分）
//
// 全部固定 timeZone: "Asia/Shanghai"。
// 这些组件现在会在服务端预渲染一次、客户端 hydration 一次：容器里 Node 用的是 UTC，
// 浏览器用的是本地时区，不固定时区会出现「服务端渲染 09/15、客户端 09/16」的水合不一致，
// 而且服务端那份日期本身就是错的。

const TIME_ZONE = "Asia/Shanghai";

// 日期型：仅月/日，用于卡片等紧凑展示位
export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", timeZone: TIME_ZONE })
    : "";
}

// 日期时间型：月/日 时:分，用于消息、收藏等需要时间点的展示位
export function formatDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TIME_ZONE })
    : "";
}