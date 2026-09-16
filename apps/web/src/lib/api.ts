// 兼容层：保持 `@/lib/api` 这个入口不变，内部按职责拆到四个模块
//
//   api-base.ts    地址解析（零依赖，RSC 与客户端共用）
//   api-types.ts   纯类型（类型导入被擦除，RSC 可安全引用）
//   api-request.ts 纯请求（不依赖 swr，RSC 也能用）
//   api-client.ts  客户端专用（唯一 import swr 的模块）
//
// 拆分原因：原 api.ts 顶层 import useSWR，一旦被拉进 RSC 构建图就会报错
// （swr 的 react-server 入口没有 default 导出），导致服务端组件只能内联重复实现取数逻辑。

export { getApiBase, apiUrl, assetUrl, publicApiBase } from "./api-base";
export * from "./api-types";
export {
  apiFetch,
  getJson,
  postJson,
  putJson,
  patchJson,
  deleteJson,
  getSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  type DeleteJsonOptions
} from "./api-request";
export { apiFetcher, useApi } from "./api-client";