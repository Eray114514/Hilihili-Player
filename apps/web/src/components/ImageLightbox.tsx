"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect } from "react";
import type { ItemImage } from "@/lib/api";
import { assetUrl } from "@/lib/api";
import { ApiImage } from "@/components/ApiImage";

export function ImageLightbox({ images, index, onChange, onClose }: { images: ItemImage[]; index: number; onChange: (index: number) => void; onClose: () => void }) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onChange((index - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") onChange((index + 1) % images.length);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [images.length, index, onChange, onClose]);

  const image = images[index];
  if (!image) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/94 p-3 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="图片预览" onClick={onClose}>
      <button type="button" className="icon-button absolute right-4 top-4 z-10" aria-label="关闭图片预览" onClick={onClose}><X size={22} /></button>
      {images.length > 1 ? <button type="button" className="icon-button absolute left-3 top-1/2 z-10 -translate-y-1/2" aria-label="上一张" onClick={(event) => { event.stopPropagation(); onChange((index - 1 + images.length) % images.length); }}><ChevronLeft /></button> : null}
      <ApiImage src={assetUrl(image.originalUrl) ?? ""} alt={`原图 ${index + 1}`} width={image.width ?? 1600} height={image.height ?? 1200} className="max-h-[92vh] max-w-[94vw] object-contain" onClick={(event) => event.stopPropagation()} />
      {images.length > 1 ? <button type="button" className="icon-button absolute right-3 top-1/2 z-10 -translate-y-1/2" aria-label="下一张" onClick={(event) => { event.stopPropagation(); onChange((index + 1) % images.length); }}><ChevronRight /></button> : null}
      <span className="absolute bottom-4 rounded-full bg-black/65 px-3 py-1 text-xs text-white/70">{index + 1} / {images.length}</span>
    </div>
  );
}
