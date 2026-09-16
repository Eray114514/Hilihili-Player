"use client";

// 图片宽度阶梯必须与 packages/media 的 IMAGE_VARIANT_WIDTHS 保持一致
const VARIANT_WIDTHS = [320, 480, 640, 960, 1280];

function variantSrcSet(src: string) {
  const separator = src.includes("?") ? "&" : "?";
  return VARIANT_WIDTHS.map((width) => `${src}${separator}w=${width} ${width}w`).join(", ");
}

type ApiImageProps = {
  src: string;
  alt: string;
  /** 铺满最近的定位祖先（等价 next/image 的 fill） */
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean;
  loading?: "eager" | "lazy";
  className?: string;
  onError?: () => void;
};

/**
 * API 图片出口。
 *
 * 这里刻意不用 next/image：图片 URL 是浏览器侧用当前主机名拼出来的绝对地址，
 * Web 容器内的优化器无法可靠回源；而且缩略图/变体已经由 API 侧 sharp 按 ?w= 按需生成。
 *
 * 只有传了 sizes（说明是响应式槽位）才生成 srcset —— 灯箱那种按原图尺寸渲染的场景
 * 必须拿原图，不能按 ?w= 降尺寸。
 */
export function ApiImage({ src, alt, fill, width, height, sizes, priority, loading, className, onError }: ApiImageProps) {
  const classes = [fill ? "absolute inset-0 h-full w-full" : null, className].filter(Boolean).join(" ");
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 见上方说明：图片由 API 按需出变体，不经 next/image 优化器
    <img
      src={src}
      srcSet={sizes ? variantSrcSet(src) : undefined}
      sizes={sizes}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      loading={loading ?? (priority ? "eager" : "lazy")}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      className={classes || undefined}
      onError={onError}
    />
  );
}