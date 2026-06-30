"use client";

import type { SubtitleCue } from "@/lib/subtitles";

type SubtitleOverlayProps = {
  cues: { primary: SubtitleCue | null; secondary: SubtitleCue | null };
  mode: "chinese" | "bilingual";
  position: "bottom" | "top";
  controlsVisible: boolean;
  isFullscreen: boolean;
  visible: boolean;
};

// 字幕显示层：根据控件可见性和全屏状态调整上下位置，仅做展示，不处理交互
export function SubtitleOverlay({ cues, mode, position, controlsVisible, isFullscreen, visible }: SubtitleOverlayProps) {
  if (!visible) return null;

  const positionClasses = position === "bottom"
    ? controlsVisible
      ? isFullscreen ? "bottom-12 justify-end" : "bottom-[5.5rem] justify-end"
      : "bottom-4 justify-end"
    : isFullscreen ? "top-4 justify-start" : "top-6 justify-start";

  return (
    <div
      className={`pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center px-4 text-center transition-[bottom] duration-200 ease-out sm:px-8 ${positionClasses}`}
    >
      {cues.primary ? (
        <div className="max-w-[90%] rounded bg-black/70 px-3 py-1 text-base font-medium leading-snug text-white shadow-lg [text-shadow:0_1px_2px_rgba(0,0,0,.8)]">
          {cues.primary.primaryText}
        </div>
      ) : null}
      {mode === "bilingual" && (cues.primary?.secondaryText || cues.secondary) ? (
        <div className="mt-0.5 max-w-[85%] rounded bg-black/60 px-1.5 py-px text-[0.625rem] leading-tight text-white/85 shadow-md [text-shadow:0_1px_2px_rgba(0,0,0,.8)]">
          {cues.primary?.secondaryText || cues.secondary?.primaryText}
        </div>
      ) : null}
    </div>
  );
}
