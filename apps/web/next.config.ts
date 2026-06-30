import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@hilihili/shared"],
  images: {
    // LAN-only 架构：图片 URL 是浏览器端用 window.location.hostname 生成的绝对 URL（如 http://<nas>:4141/...），
    // Web 容器内无法可靠解析该主机名回源，优化器会失败。缩略图已由 packages/media 的 sharp 预生成，
    // 无需二次优化。保持 unoptimized: true 是架构正确的选择。
    unoptimized: true
  }
};

export default nextConfig;
