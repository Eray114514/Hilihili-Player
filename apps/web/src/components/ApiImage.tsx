"use client";

import Image, { type ImageLoaderProps, type ImageProps } from "next/image";

type ApiImageProps = Omit<ImageProps, "loader" | "src" | "unoptimized"> & { src: string };

export function ApiImage({ src, alt, ...props }: ApiImageProps) {
  return <Image {...props} src={src} alt={alt} loader={passthroughLoader} unoptimized />;
}

// LAN-only 架构：图片 URL 是浏览器端用 window.location.hostname 生成的绝对 URL（如 http://<nas>:4141/...），
// Web 容器内的 next/image 优化器无法可靠解析该主机名回源，故用 passthroughLoader 直出原图 + unoptimized。
// 缩略图已由 packages/media 的 sharp 预生成，无需二次优化。
function passthroughLoader({ src }: ImageLoaderProps) {
  return src;
}
