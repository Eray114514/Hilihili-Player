"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { ItemImage } from "@/lib/api";
import { assetUrl } from "@/lib/api";
import { ApiImage } from "@/components/ApiImage";
import { fadeIn, scaleIn } from "@/lib/motion";

export function ImageLightbox({ images, index, onChange, onClose }: { images: ItemImage[]; index: number; onChange: (index: number) => void; onClose: () => void }) {
  const reduced = useReducedMotion();
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
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/94 p-3 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onClick={onClose}
      variants={fadeIn}
      initial={reduced ? { opacity: 0 } : "hidden"}
      animate={reduced ? { opacity: 1 } : "visible"}
      exit={reduced ? { opacity: 0 } : "exit"}
      transition={reduced ? { duration: 0 } : undefined}
    >
      <button type="button" className="icon-button absolute right-4 top-4 z-10" aria-label="关闭图片预览" onClick={onClose}><X size={22} /></button>
      {images.length > 1 ? <button type="button" className="icon-button absolute left-3 top-1/2 z-10 -translate-y-1/2" aria-label="上一张" onClick={(event) => { event.stopPropagation(); onChange((index - 1 + images.length) % images.length); }}><ChevronLeft /></button> : null}
      <motion.div
        variants={scaleIn}
        initial={reduced ? { opacity: 0, scale: 0.96 } : "hidden"}
        animate={reduced ? { opacity: 1, scale: 1 } : "visible"}
        exit={reduced ? { opacity: 0, scale: 0.96 } : "exit"}
        transition={reduced ? { duration: 0 } : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <ApiImage src={assetUrl(image.originalUrl) ?? ""} alt={`原图 ${index + 1}`} width={image.width ?? 1600} height={image.height ?? 1200} className="max-h-[92vh] max-w-[94vw] object-contain" />
      </motion.div>
      {images.length > 1 ? <button type="button" className="icon-button absolute right-3 top-1/2 z-10 -translate-y-1/2" aria-label="下一张" onClick={(event) => { event.stopPropagation(); onChange((index + 1) % images.length); }}><ChevronRight /></button> : null}
      <span className="absolute bottom-4 rounded-full bg-black/65 px-3 py-1 text-xs text-white/70">{index + 1} / {images.length}</span>
    </motion.div>
  );
}
