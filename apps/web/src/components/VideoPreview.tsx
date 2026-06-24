"use client";

import { LoaderCircle, Play, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiImage } from "@/components/ApiImage";
import { apiUrl } from "@/lib/api";

const PREVIEW_EVENT = "hilihili:preview-start";

type VideoPreviewProps = {
  previewPartId: string | null;
  posterUrl: string | null;
  alt: string;
  sizes: string;
  priority?: boolean;
  fallback?: ReactNode;
};

export function VideoPreview({ previewPartId, posterUrl, alt, sizes, priority = false, fallback }: VideoPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRef = useRef(false);
  const [requested, setRequested] = useState(false);
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);

  const stopPreview = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setActive(false);
    setProgress(0);
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
  }, []);

  const startPreview = useCallback(() => {
    if (!previewPartId || failed || activeRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    activeRef.current = true;
    setRequested(true);
    setActive(true);
    window.dispatchEvent(new CustomEvent(PREVIEW_EVENT, { detail: previewPartId }));
  }, [failed, previewPartId]);

  useEffect(() => {
    if (!active || !requested) return;
    const video = videoRef.current;
    if (!video) return;
    void video.play().catch(() => {
      activeRef.current = false;
      setActive(false);
      setFailed(true);
    });
  }, [active, requested]);

  useEffect(() => {
    function stopOtherPreview(event: Event) {
      if ((event as CustomEvent<string>).detail !== previewPartId) stopPreview();
    }
    window.addEventListener(PREVIEW_EVENT, stopOtherPreview);
    return () => window.removeEventListener(PREVIEW_EVENT, stopOtherPreview);
  }, [previewPartId, stopPreview]);

  useEffect(() => {
    const container = containerRef.current;
    const link = container?.closest("a");
    if (!link) return;
    link.addEventListener("focus", startPreview);
    link.addEventListener("blur", stopPreview);
    return () => {
      link.removeEventListener("focus", startPreview);
      link.removeEventListener("blur", stopPreview);
    };
  }, [startPreview, stopPreview]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !previewPartId || !window.matchMedia("(hover: none), (pointer: coarse)").matches) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.72) startPreview();
      else stopPreview();
    }, { threshold: [0, 0.72, 1] });
    observer.observe(container);
    return () => observer.disconnect();
  }, [previewPartId, startPreview, stopPreview]);

  const previewing = active && !failed;
  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden bg-[#17191f]"
      data-preview-state={failed ? "failed" : previewing ? ready ? "playing" : "loading" : "idle"}
      onMouseEnter={startPreview}
      onMouseMove={startPreview}
      onMouseLeave={stopPreview}
    >
      {posterUrl ? <ApiImage src={posterUrl} alt={alt} fill priority={priority} sizes={sizes} className={`object-cover transition duration-300 ${previewing && ready ? "scale-[1.015] opacity-0" : "opacity-100"}`} /> : fallback ?? <span className="grid h-full place-items-center text-white/35"><Play size={32} /></span>}
      {requested && previewPartId ? (
        <video
          ref={videoRef}
          src={apiUrl(`/media/parts/${previewPartId}/stream`)}
          muted
          loop
          playsInline
          preload="metadata"
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition duration-200 ${previewing && ready ? "opacity-100" : "opacity-0"}`}
          onCanPlay={() => setReady(true)}
          onError={() => { activeRef.current = false; setFailed(true); setActive(false); }}
          onTimeUpdate={(event) => {
            const video = event.currentTarget;
            setProgress(Number.isFinite(video.duration) && video.duration > 0 ? video.currentTime / video.duration : 0);
          }}
        />
      ) : null}

      {!previewing ? <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/8 opacity-100 transition group-hover:opacity-0 group-focus-visible:opacity-0"><span className="grid h-10 w-10 place-items-center rounded-full bg-black/65 text-white shadow-lg"><Play size={18} fill="currentColor" /></span></span> : null}
      {previewing ? <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-md bg-black/68 px-2 py-1 text-[10px] font-medium text-white/88 backdrop-blur-sm">{ready ? <VolumeX size={12} /> : <LoaderCircle className="animate-spin" size={12} />}{ready ? "预览中 · 静音" : "正在加载预览"}</span> : null}
      {previewing && ready ? <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-black/35"><span className="block h-full bg-[var(--accent)] transition-[width] duration-150" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} /></span> : null}
    </div>
  );
}
