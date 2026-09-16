/**
 * 服务端渲染期间使用的「浏览器可达」基地址，由 RootLayout 在每个请求开始时写入。
 *
 * 为什么需要它：`assetUrl()` 会在 Server Component 与客户端组件的 SSR 渲染阶段被调用，
 * 而服务端默认拿到的是容器内地址（http://api:4141）。这个地址写进 HTML 后浏览器无法解析，
 * 首屏所有封面都会变成裂图，直到 hydration 后才被纠正。
 *
 * 这是模块级变量：本部署是单机单入口（局域网或异地组网各只有一个访问地址），
 * 同一时刻所有并发请求的 Host 一致，因此不存在跨请求串值的问题。
 */
let serverRenderedBase: string | null = null;

export function setServerRenderedApiBase(base: string) {
  serverRenderedBase = base;
}

/**
 * API 地址解析。零依赖：RSC（服务端）与客户端共用同一套规则。
 *
 * 浏览器端沿用当前主机名 + 配置里的端口，所以局域网访问与异地组网（虚拟 IP）
 * 都能自动得到正确地址，不需要为每种访问方式分别配置。
 */
export function getApiBase() {
  if (typeof window !== "undefined") {
    // 浏览器端沿用当前主机，端口取公开配置，兼容局域网访问与安全演示。
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
  // 服务端：优先用本次请求推导出的公网可达地址，其次才是容器内地址
  return serverRenderedBase
    ?? process.env.NEXT_PUBLIC_API_BASE_URL
    ?? process.env.API_BASE_URL
    ?? "http://localhost:4141";
}

export function apiUrl(path: string) {
  return `${getApiBase()}${path}`;
}

export function assetUrl(path: string | null) {
  return path ? `${getApiBase()}${path}` : null;
}

/**
 * 浏览器侧可达的 API 基地址。
 *
 * 服务端渲染时 getApiBase() 返回的是容器内地址（如 http://api:4141），
 * 这个地址写进 HTML 后浏览器无法解析。所以 SSR 输出的图片/字幕 URL 必须用
 * 当前请求的 host 推导——组网场景下就是那台虚拟 IP。
 */
export function publicApiBase(hostHeader: string | null) {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  let protocol = "http";
  let port = "4141";
  if (configured) {
    try {
      const url = new URL(configured);
      protocol = url.protocol.replace(":", "");
      port = url.port;
    } catch {
      // 配置非法时用默认端口
    }
  }
  const host = hostHeader ?? `localhost:${port || "4141"}`;
  const hostname = host.replace(/:\d+$/, "");
  return `${protocol}://${hostname}${port ? `:${port}` : ""}`;
}