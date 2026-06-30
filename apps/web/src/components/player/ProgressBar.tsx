"use client";

import { useRef, useState } from "react";
import { formatTime } from "./format";

// 雪碧图布局信息，由父组件从 part 的预览字段计算后传入
type SpriteInfo = {
  cols: number;
  rows: number;
  interval: number;
  thumbW: number;
  thumbH: number;
};

type ProgressBarProps = {
  duration: number;
  current: number;
  buffered: number;
  spriteUrl: string | null;
  spriteInfo: SpriteInfo | null;
  spriteLoaded: boolean;
  spriteError: boolean;
  onSeekTo: (value: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
};

export function ProgressBar({
  duration,
  current,
  buffered,
  spriteUrl,
  spriteInfo,
  spriteLoaded,
  spriteError,
  onSeekTo,
  onDraggingChange
}: ProgressBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  // 拖动状态用 ref 跟踪，避免渲染抖动
  const draggingRef = useRef(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverRatio, setHoverRatio] = useState(0);
  const [hoverLeftPx, setHoverLeftPx] = useState(0);

  // 根据指针位置计算 hover 比例、时间和预览框横向偏移
  function computeHover(event: React.PointerEvent<HTMLDivElement>) {
    const bar = barRef.current;
    if (!bar || !duration) return null;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const time = ratio * duration;
    const halfW = spriteInfo ? spriteInfo.thumbW / 2 : 40;
    const rawPx = ratio * rect.width;
    const leftPx = Math.max(halfW, Math.min(rect.width - halfW, rawPx));
    return { ratio, time, leftPx };
  }

  function applyHover(computed: { ratio: number; time: number; leftPx: number }) {
    setHoverTime(computed.time);
    setHoverRatio(computed.ratio);
    setHoverLeftPx(computed.leftPx);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const computed = computeHover(event);
    if (!computed) return;
    applyHover(computed);
    // 拖动期间持续 seek，让画面跟随指针
    if (draggingRef.current) {
      onSeekTo(computed.time);
    }
  }

  function handlePointerLeave() {
    // pointer capture 后拖动期间 leave 不会触发，这里只在非拖动离开时清掉 hover 预览
    setHoverTime(null);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const computed = computeHover(event);
    if (!computed) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    onDraggingChange?.(true);
    applyHover(computed);
    // 按下立即 seek，不必等抬起
    onSeekTo(computed.time);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    draggingRef.current = false;
    onDraggingChange?.(false);
  }

  const hoverTileIndex = hoverTime != null && spriteInfo
    ? Math.min(spriteInfo.cols * spriteInfo.rows - 1, Math.floor(hoverTime / spriteInfo.interval))
    : -1;
  const previewBgX = hoverTileIndex >= 0 && spriteInfo
    ? -(hoverTileIndex % spriteInfo.cols) * spriteInfo.thumbW
    : 0;
  const previewBgY = hoverTileIndex >= 0 && spriteInfo
    ? -Math.floor(hoverTileIndex / spriteInfo.cols) * spriteInfo.thumbH
    : 0;

  const progressPct = duration > 0 ? (current / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const hoverPct = hoverRatio * 100;

  return (
    <div
      ref={barRef}
      className="group/progress relative h-5 cursor-pointer py-2"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/20 transition-[height] duration-100 group-hover/progress:h-1.5">
        <div className="h-full bg-white/35 transition-[width] duration-100" style={{ width: `${bufferedPct}%` }} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full transition-[height] duration-100 group-hover/progress:h-1.5">
        <div className="h-full bg-[var(--accent)] transition-[width] duration-100" style={{ width: `${progressPct}%` }} />
      </div>
      {hoverTime != null ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full transition-[height] duration-100 group-hover/progress:h-1.5">
          <div className="h-full bg-white/25" style={{ width: `${hoverPct}%` }} />
        </div>
      ) : null}
      <div
        className="pointer-events-none absolute top-1/2 h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] shadow-md ring-[1.5px] ring-black/45 transition-transform group-hover/progress:scale-110"
        style={{ left: `${progressPct}%` }}
      />

      {hoverTime != null && spriteUrl && spriteInfo && hoverTileIndex >= 0 && !spriteError ? (
        <div
          className="pointer-events-none absolute -top-2 -translate-x-1/2 -translate-y-full overflow-hidden rounded-lg border border-white/15 bg-black shadow-2xl"
          style={{ left: hoverLeftPx }}
        >
          <div
            className="relative overflow-hidden bg-black"
            style={{
              width: spriteInfo.thumbW,
              height: spriteInfo.thumbH,
              backgroundImage: spriteLoaded ? `url("${spriteUrl}")` : undefined,
              backgroundPosition: `${previewBgX}px ${previewBgY}px`,
              backgroundRepeat: "no-repeat",
              backgroundSize: `${spriteInfo.thumbW * spriteInfo.cols}px ${spriteInfo.thumbH * spriteInfo.rows}px`
            }}
          >
            {spriteLoaded ? null : <div className="absolute inset-0 skeleton-shimmer bg-white/10" />}
          </div>
          <div className="bg-black/80 px-2 py-1 text-center text-xs font-medium tabular-nums text-white/90">
            {formatTime(hoverTime)}
          </div>
        </div>
      ) : hoverTime != null ? (
        <div
          className="pointer-events-none absolute -top-2 -translate-x-1/2 -translate-y-full rounded-md bg-black/90 px-2 py-1 text-xs tabular-nums text-white shadow-lg"
          style={{ left: hoverLeftPx }}
        >
          {formatTime(hoverTime)}
        </div>
      ) : null}
    </div>
  );
}
