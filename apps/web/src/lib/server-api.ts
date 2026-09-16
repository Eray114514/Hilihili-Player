// 仅限 Server Component / Route Handler 使用（不要从 "use client" 组件 import）：
// 这里依赖 next/headers，在客户端会构建失败。
//
// 服务端取数据走容器内网直连（快、不经反代），与浏览器用的同源相对地址（/api）是两条路。

/** 服务端访问 API 的基地址：Docker 部署下是 compose 服务名 */
export function serverBase() {
  return process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4141";
}

export type ServerGetOptions = {
  /** >0 时启用 Next Data Cache（秒）。默认 0，即每次都取最新数据。 */
  revalidate?: number;
  tags?: string[];
  timeoutMs?: number;
};

export type ServerFetchResult<T> =
  | { status: "ok"; data: T }
  | { status: "missing" }
  | { status: "error" };

/**
 * 区分「上游明确 404」与「取数失败」的版本。
 *
 * 这个区分很重要：404 应该走 notFound()，而链路抖动导致的失败必须留在页面上
 * 交给客户端 SWR 重试——否则一次组网抖动就会给用户一个 404 页面，误导性很强。
 */
export async function serverFetch<T>(path: string, options: ServerGetOptions = {}): Promise<ServerFetchResult<T>> {
  const { revalidate = 0, tags, timeoutMs = 8000 } = options;
  try {
    const response = await fetch(`${serverBase()}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
      ...(revalidate > 0
        ? { next: { revalidate, ...(tags ? { tags } : {}) } }
        : { cache: "no-store" as const })
    });
    if (response.status === 404) return { status: "missing" };
    if (!response.ok) {
      // 静默失败会让「页面只剩骨架」无从排查，至少留下上游状态码
      console.error(`[server-api] ${path} -> upstream ${response.status}`);
      return { status: "error" };
    }
    return { status: "ok", data: (await response.json()) as T };
  } catch (error) {
    // Next 用异常做控制流：静态预渲染期间带 no-store 的 fetch 会抛 DynamicServerError，
    // 预期它向上传播把路由标记为动态。绝对不能在这里吞掉，否则空数据会被固化成静态页。
    const digest = (error as { digest?: string }).digest;
    if (digest === "DYNAMIC_SERVER_USAGE" || (error instanceof Error && error.message.includes("Dynamic server usage"))) {
      throw error;
    }
    console.error(`[server-api] ${path} -> fetch failed:`, error);
    return { status: "error" };
  }
}

/**
 * RSC 取数入口。
 *
 * 失败一律返回 null 而不是抛错：异地组网链路抖动很常见，
 * 一次取数失败不该让整页 500 白屏，交给客户端 SWR 兜底更稳。
 */
export async function serverGet<T>(path: string, options: ServerGetOptions = {}): Promise<T | null> {
  const result = await serverFetch<T>(path, options);
  return result.status === "ok" ? result.data : null;
}