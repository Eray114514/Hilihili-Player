/**
 * API 地址解析。零依赖：RSC（服务端）与客户端共用同一套规则。
 *
 * 生产环境必须走「同源」：web 容器前有一个按路径分流的反向代理（见 Caddyfile），
 * `/api/*` 转发到 api、其余走 web 页面。所以 API 基地址就是一个相对前缀 `/api`，
 * 对任何访问方式（局域网 IP、异地组网虚拟 IP、localhost）都天然正确，
 * 不存在「服务端渲染出容器内地址」或「跨域」的问题。
 *
 * 之所以不能按请求动态推导 host 写进模块变量：Next.js 的 RSC 图与客户端组件 SSR 图
 * 是两份独立 bundle，模块级状态不共享（已在线上验证过会输出容器内地址）。
 * 相对前缀是唯一对所有图、所有客户端都正确的方案。
 *
 * 开发环境（pnpm dev / dev:safe）web 与 api 是不同端口、没有反代，
 * 沿用旧行为：浏览器按当前主机名 + 配置端口直连 api。
 */
export function getApiBase() {
  if (process.env.NODE_ENV === "production") {
    return "/api";
  }
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location;
    const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (configured) {
      try {
        const url = new URL(configured);
        return `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}`;
      } catch {
        // Fall through to the default port when the configured URL is invalid.
      }
    }
    return `${protocol}//${hostname}:4141`;
  }
  // 开发期 SSR：容器内/本地直连地址
  return process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4141";
}

export function apiUrl(path: string) {
  return `${getApiBase()}${path}`;
}

export function assetUrl(path: string | null) {
  return path ? `${getApiBase()}${path}` : null;
}