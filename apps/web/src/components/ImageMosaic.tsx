import Link from "next/link";
import type { FeedImage } from "@hilihili/shared";
import type { ItemImage } from "@/lib/api";
import { assetUrl } from "@/lib/api";
import { ApiImage } from "@/components/ApiImage";

type MosaicImage = FeedImage | ItemImage;

export function ImageMosaic({ images, total = images.length, href, onSelect }: { images: MosaicImage[]; total?: number; href?: string; onSelect?: (index: number) => void }) {
  if (images.length === 0) return null;
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
