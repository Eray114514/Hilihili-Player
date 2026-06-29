import Link from "next/link";
import type { FeedImage } from "@hilihili/shared";
import type { ItemImage } from "@/lib/api";
import { assetUrl } from "@/lib/api";
import { ApiImage } from "@/components/ApiImage";

type MosaicImage = FeedImage | ItemImage;

export function ImageMosaic({ images, total = images.length, href, onSelect, showAll = false }: { images: MosaicImage[]; total?: number; href?: string; onSelect?: (index: number) => void; showAll?: boolean }) {
  if (images.length === 0) return null;

  // 详情页：显示全部图片，按原比例排列，合理利用显示空间
  if (showAll) {
    const colCount = images.length === 1 ? 1 : images.length <= 4 ? 2 : 3;
    // 贪心分配：每张图放到当前最矮的列。列宽相同时高度增量 ≈ 1/aspect。
    // 这样图片在渲染前就固定归属某列，加载完成只会撑高本列，不会跨列重排（避免 columns 布局的闪烁问题）。
    const cols: { image: MosaicImage; index: number }[][] = Array.from({ length: colCount }, () => []);
    const colHeights = new Array(colCount).fill(0);
    for (let i = 0; i < images.length; i += 1) {
      const image = images[i];
      const aspect = (image.width || 4) / (image.height || 3);
      let minIdx = 0;
      for (let c = 1; c < colCount; c += 1) if (colHeights[c] < colHeights[minIdx]) minIdx = c;
      cols[minIdx].push({ image, index: i });
      colHeights[minIdx] += 1 / aspect;
    }
    const gridClass = colCount === 1 ? "grid-cols-1 max-w-[42rem] mx-auto" : colCount === 2 ? "grid-cols-2" : "grid-cols-3";
    return (
      <div className={`mt-4 grid gap-1.5 ${gridClass}`}>
        {cols.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-1.5">
            {col.map(({ image, index }) => {
              const w = image.width ?? 4;
              const h = image.height ?? 3;
              const tile = (
                <>
                  <ApiImage src={assetUrl(image.thumbnailUrl) ?? ""} alt={`第 ${index + 1} 张图片`} width={w} height={h} sizes="(min-width: 768px) 300px, 33vw" className="h-auto w-full transition duration-300 group-hover:scale-[1.025]" />
                  {image.isAnimated ? <span className="absolute left-1.5 top-1.5 rounded bg-black/72 px-1.5 py-0.5 text-[11px] font-medium text-white/88 backdrop-blur-sm">动图</span> : null}
                </>
              );
              const className = "group relative block overflow-hidden rounded-lg bg-white/5";
              if (onSelect) return <button type="button" key={image.id} className={className} onClick={() => onSelect(index)}>{tile}</button>;
              return <Link key={image.id} href={href ?? "#"} className={className}>{tile}</Link>;
            })}
          </div>
        ))}
      </div>
    );
  }

  // 信息流卡片：最多 9 张 + "+N"，固定网格裁切（卡片场景需紧凑）
  const visible = images.slice(0, 9);
  const columns = visible.length === 1 ? "grid-cols-1 max-w-[34rem]" : visible.length === 2 ? "grid-cols-2 max-w-[38rem]" : "grid-cols-3 max-w-[38rem]";

  return (
    <div className={`mt-4 grid gap-1.5 overflow-hidden rounded-xl ${columns}`}>
      {visible.map((image, index) => {
        const tile = (
          <>
            <ApiImage src={assetUrl(image.thumbnailUrl) ?? ""} alt={`第 ${index + 1} 张图片`} fill sizes="(min-width: 768px) 380px, 33vw" className="object-cover transition duration-300 group-hover:scale-[1.025]" />
            {image.isAnimated ? <span className="absolute left-1.5 top-1.5 rounded bg-black/72 px-1.5 py-0.5 text-[11px] font-medium text-white/88 backdrop-blur-sm">动图</span> : null}
            {index === visible.length - 1 && total > visible.length ? <span className="absolute inset-0 grid place-items-center bg-black/55 text-xl font-semibold text-white">+{total - visible.length}</span> : null}
          </>
        );
        const className = `group relative overflow-hidden bg-white/5 ${visible.length === 1 ? "max-h-[34rem] min-h-64" : "aspect-square"}`;
        if (onSelect) return <button type="button" key={image.id} className={className} onClick={() => onSelect(index)}>{tile}</button>;
        return <Link key={image.id} href={href ?? "#"} className={className}>{tile}</Link>;
      })}
    </div>
  );
}
