"use client";

import Image, { type ImageLoaderProps, type ImageProps } from "next/image";

type ApiImageProps = Omit<ImageProps, "loader" | "src" | "unoptimized"> & { src: string };

export function ApiImage({ src, alt, ...props }: ApiImageProps) {
  return <Image {...props} src={src} alt={alt} loader={passthroughLoader} unoptimized />;
}

function passthroughLoader({ src }: ImageLoaderProps) {
  return src;
}
