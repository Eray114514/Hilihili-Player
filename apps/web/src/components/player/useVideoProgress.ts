"use client";

import { useCallback, useEffect, useRef } from "react";
import { apiUrl, postJson, type PartDetail } from "@/lib/api";

type ProgressData = { partId: string; positionSeconds: number; durationSeconds: number };

type UseVideoProgressOptions = {
  itemId: string;
  part: PartDetail | undefined;
  duration: number;
  isLastPart: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onEnded?: () => void;
};

// 进度上报 hook：封装 watch 进度保存、完成上报、定时器与页面隐藏监听。
// latestProgressRef 由调用方在 onLoadedMetadata / onTimeUpdate 中更新；
// checkCompletion 由调用方在 onTimeUpdate 中调用以触发 90% 完成上报。
export function useVideoProgress({ itemId, part, duration, isLastPart, videoRef, onEnded }: UseVideoProgressOptions) {
  const latestProgressRef = useRef<ProgressData | null>(null);
  const lastSavedRef = useRef<{ partId: string; positionSeconds: number } | null>(null);
  const completionSentRef = useRef<string | null>(null);

  const saveProgress = useCallback((force = false) => {
    const progress = latestProgressRef.current;
    if (!progress || progress.positionSeconds <= 0) return;
    const lastSaved = lastSavedRef.current;
    if (!force && lastSaved?.partId === progress.partId && Math.abs(lastSaved.positionSeconds - progress.positionSeconds) < 2) return;
    lastSavedRef.current = { partId: progress.partId, positionSeconds: progress.positionSeconds };
    void fetch(apiUrl(`/items/${itemId}/interactions`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "watch", ...progress }),
      keepalive: true
    }).catch((error) => console.warn("[player] 保存进度失败", error));
  }, [itemId]);

  // markFinished 是 video 的 onEnded 事件处理器，identity 不稳定无副作用；
  // 直接闭包引用 duration/onEnded，避免在 render 期写 ref（react-hooks/refs）。
  const markFinished = useCallback(() => {
    if (!part) return;
    const partId = part.id;
    void postJson(`/items/${itemId}/interactions`, {
      kind: "finish",
      partId,
      positionSeconds: duration,
      durationSeconds: duration
    }).catch((error) => console.error("[player] 上报完成失败", error));
    onEnded?.();
  }, [itemId, part, duration, onEnded]);

  // 最后一P 播放到 90% 时上报一次完成（与原 onTimeUpdate 内联逻辑一致）
  const checkCompletion = useCallback((currentTime: number, videoDuration: number) => {
    if (!isLastPart || !part) return;
    if (videoDuration <= 0 || currentTime < videoDuration * 0.9) return;
    if (completionSentRef.current === part.id) return;
    completionSentRef.current = part.id;
    saveProgress(true);
  }, [isLastPart, part, saveProgress]);

  useEffect(() => {
    if (!part) return;
    completionSentRef.current = null;
    latestProgressRef.current = { partId: part.id, positionSeconds: 0, durationSeconds: part.durationSeconds ?? 0 };
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused && video.currentTime > 0) {
        saveProgress();
      }
    }, 10000);
    const handlePageHide = () => saveProgress(true);
    const handleVisibilityChange = () => { if (document.visibilityState === "hidden") saveProgress(true); };
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      saveProgress(true);
    };
  }, [part, saveProgress, videoRef]);

  return { saveProgress, markFinished, latestProgressRef, checkCompletion };
}
