"use client";

import { AlertTriangle, FastForward, LoaderCircle, Maximize, Minimize, Pause, Play, Rewind, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl, assetUrl, postJson } from "@/lib/api";
import type { PartDetail } from "@/lib/api";

type VideoPlayerProps = {
  itemId: string;
  part: PartDetail | undefined;
  resumePosition?: number;
  onEnded?: () => void;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function VideoPlayer({ itemId, part, resumePosition = 0, onEnded }: VideoPlayerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const holdTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const holdingFastRef = useRef(false);
  const resumedPartRef = useRef<string | null>(null);
  const stallStartRef = useRef<number>(0);

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [holdingFast, setHoldingFast] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [autoPlayBlocked, setAutoPlayBlocked] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [buffered, setBuffered] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverRatio, setHoverRatio] = useState(0);
  const [hoverLeftPx, setHoverLeftPx] = useState(0);
  const [spriteLoaded, setSpriteLoaded] = useState(false);
  const [prevPartId, setPrevPartId] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState(false);

  const spriteUrl = useMemo(() => {
    if (!part?.previewSpritePath) return null;
    return assetUrl(`/media/parts/${part.id}/sprite`);
  }, [part]);

  const spriteInfo = useMemo(() => {
    if (!part?.previewSpriteCols || !part.previewSpriteRows || !part.previewSpriteInterval
      || !part.previewThumbW || !part.previewThumbH) return null;
    return {
      cols: part.previewSpriteCols,
      rows: part.previewSpriteRows,
      interval: part.previewSpriteInterval,
      thumbW: part.previewThumbW,
      thumbH: part.previewThumbH
    };
  }, [part]);

  if (part && part.id !== prevPartId) {
    setPrevPartId(part.id);
    setBuffering(true);
    setBuffered(0);
    setCurrent(0);
    setDuration(0);
    setAutoPlayBlocked(false);
    setHoverTime(null);
    setSpriteLoaded(false);
    setMediaError(false);
  }

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (!speedMenuOpen) setControlsVisible(false);
    }, 2600);
  }, [speedMenuOpen]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().then(() => setAutoPlayBlocked(false)).catch(() => setAutoPlayBlocked(true));
    } else {
      video.pause();
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!shellRef.current) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void shellRef.current.requestFullscreen();
    }
  }, []);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Math.max(0, Math.min(duration || video.duration || 0, video.currentTime + delta));
    setBuffering(true);
    video.currentTime = next;
    setCurrent(next);
  }, [duration]);

  const seekTo = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    setBuffering(true);
    video.currentTime = value;
    setCurrent(value);
  }, []);

  const cycleSpeed = useCallback((direction: number) => {
    setSpeed((prev) => {
      const idx = SPEEDS.indexOf(prev);
      const nextIdx = Math.max(0, Math.min(SPEEDS.length - 1, idx + direction));
      return SPEEDS[nextIdx];
    });
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = holdingFast ? 3 : speed;
  }, [speed, holdingFast]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted || volume === 0;
  }, [volume, muted]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    if (!part) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused && video.currentTime > 0) {
        void postJson(`/items/${itemId}/interactions`, {
          kind: "watch",
          partId: part.id,
          positionSeconds: video.currentTime
        });
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [itemId, part]);

  useEffect(() => () => {
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
  }, []);

  if (!part) {
    return <div className="grid aspect-video place-items-center rounded-xl bg-white/5 text-white/55">没有可播放分P</div>;
  }
  const partId = part.id;

  function finishHold() {
    if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    if (holdingFastRef.current) {
      holdingFastRef.current = false;
      setHoldingFast(false);
      showControls();
      return true;
    }
    return false;
  }

  function markFinished() {
    void postJson(`/items/${itemId}/interactions`, {
      kind: "finish",
      partId,
      positionSeconds: duration
    });
    onEnded?.();
  }

  function handleProgressHover(event: React.PointerEvent<HTMLDivElement>) {
    const bar = progressRef.current;
    if (!bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const time = ratio * duration;
    setHoverTime(time);
    setHoverRatio(ratio);
    const halfW = spriteInfo ? spriteInfo.thumbW / 2 : 40;
    const rawPx = ratio * rect.width;
    setHoverLeftPx(Math.max(halfW, Math.min(rect.width - halfW, rawPx)));
  }

  function handleProgressLeave() {
    setHoverTime(null);
  }

  function handleProgressClick(event: React.PointerEvent<HTMLDivElement>) {
    const bar = progressRef.current;
    if (!bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
  }

  const hoverTileIndex = hoverTime != null && spriteInfo
    ? Math.min(
        spriteInfo.cols * spriteInfo.rows - 1,
        Math.floor(hoverTime / spriteInfo.interval)
      )
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
    <section
      ref={shellRef}
      tabIndex={0}
      className="group relative aspect-video overflow-hidden rounded-xl bg-black shadow-2xl shadow-black/30 outline-none ring-1 ring-white/10"
      onMouseMove={showControls}
      onFocus={showControls}
      onKeyDown={(event) => {
        if (event.code === "Space") { event.preventDefault(); togglePlay(); }
        if (event.key.toLowerCase() === "k") { event.preventDefault(); togglePlay(); }
        if (event.key.toLowerCase() === "j") { event.preventDefault(); seekBy(-10); }
        if (event.key.toLowerCase() === "l") { event.preventDefault(); seekBy(10); }
        if (event.key === "ArrowLeft") { event.preventDefault(); seekBy(-5); }
        if (event.key === "ArrowRight") { event.preventDefault(); seekBy(5); }
        if (event.key.toLowerCase() === "f") { event.preventDefault(); toggleFullscreen(); }
        if (event.key.toLowerCase() === "m") { event.preventDefault(); setMuted((v) => !v); }
        if (event.key === "ArrowUp") { event.preventDefault(); setVolume((v) => Math.min(1, v + 0.1)); }
        if (event.key === "ArrowDown") { event.preventDefault(); setVolume((v) => Math.max(0, v - 0.1)); }
      }}
    >
      <div
        className="absolute inset-0 cursor-pointer touch-none"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          showControls();
          holdTimerRef.current = window.setTimeout(() => {
            holdingFastRef.current = true;
            setHoldingFast(true);
            setControlsVisible(false);
          }, 250);
        }}
        onPointerUp={() => {
          if (finishHold()) return;
          if (clickTimerRef.current) {
            window.clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
            toggleFullscreen();
            return;
          }
          clickTimerRef.current = window.setTimeout(() => {
            clickTimerRef.current = null;
            togglePlay();
          }, 260);
        }}
        onPointerCancel={finishHold}
        onPointerLeave={() => { if (holdingFastRef.current) finishHold(); }}
      >
        <video
          key={partId}
          ref={videoRef}
          src={apiUrl(`/media/parts/${part.id}/stream`)}
          className="h-full w-full select-none object-contain"
          playsInline
          autoPlay
          preload="auto"
          onPlay={() => { setPlaying(true); setBuffering(false); stallStartRef.current = 0; }}
          onPause={() => setPlaying(false)}
          onWaiting={() => {
            setBuffering(true);
            if (!stallStartRef.current) stallStartRef.current = Date.now();
          }}
          onPlaying={() => { setBuffering(false); stallStartRef.current = 0; }}
          onCanPlay={() => { setBuffering(false); stallStartRef.current = 0; }}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            const dur = video.duration || 0;
            setDuration(dur);
            if (resumedPartRef.current !== partId && resumePosition > 0 && resumePosition < dur - 3) {
              video.currentTime = resumePosition;
              setCurrent(resumePosition);
              resumedPartRef.current = partId;
            }
            void video.play().catch(() => setAutoPlayBlocked(true));
          }}
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
          onVolumeChange={(event) => {
            const v = event.currentTarget;
            setVolume(v.muted ? 0 : v.volume);
            setMuted(v.muted);
          }}
          onProgress={(event) => {
            const video = event.currentTarget;
            if (video.buffered.length > 0) {
              setBuffered(video.buffered.end(video.buffered.length - 1));
            }
          }}
          onEnded={markFinished}
          onError={() => { setBuffering(false); setPlaying(false); setMediaError(true); }}
        />
      </div>

      {mediaError ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex w-[min(90%,28rem)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 rounded-xl bg-black/80 p-5 text-center text-sm text-white/75">
          <AlertTriangle size={32} className="text-amber-400" />
          <span>{part.compatibilityStatus === "failed" ? "该视频转换失败，请检查 worker 日志或源文件是否损坏。" : "浏览器无法加载该视频，请重新扫描媒体库后再试。"}</span>
        </div>
      ) : buffering && !holdingFast ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <LoaderCircle className="animate-spin text-white/80" size={42} />
        </div>
      ) : null}
      {holdingFast ? <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm font-semibold">3× 快进中</div> : null}
      {autoPlayBlocked || (!playing && !buffering) ? (
        <button className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/92 text-black shadow-xl transition hover:scale-105" onClick={togglePlay} aria-label="播放">
          <Play className="ml-1" size={28} fill="currentColor" />
        </button>
      ) : null}

      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-3 pb-2 pt-12 transition-opacity duration-200 ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onMouseMove={(event) => event.stopPropagation()}
      >
        <div
          ref={progressRef}
          className="group/progress relative h-5 cursor-pointer py-2"
          onPointerMove={handleProgressHover}
          onPointerLeave={handleProgressLeave}
          onPointerDown={handleProgressClick}
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
            className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] shadow-md ring-2 ring-black/40 transition-transform group-hover/progress:scale-125"
            style={{ left: `${progressPct}%` }}
          />

          {hoverTime != null && spriteUrl && spriteInfo && hoverTileIndex >= 0 ? (
            <div
              className="pointer-events-none absolute -top-2 -translate-x-1/2 -translate-y-full overflow-hidden rounded-lg border border-white/15 bg-black shadow-2xl"
              style={{ left: hoverLeftPx }}
            >
              <div
                className="relative"
                style={{ width: spriteInfo.thumbW, height: spriteInfo.thumbH }}
              >
                {spriteLoaded ? null : <div className="absolute inset-0 animate-pulse bg-white/10" />}
                <img
                  src={spriteUrl}
                  alt=""
                  onLoad={() => setSpriteLoaded(true)}
                  className="absolute"
                  style={{
                    width: `${spriteInfo.thumbW * spriteInfo.cols}px`,
                    height: `${spriteInfo.thumbH * spriteInfo.rows}px`,
                    left: previewBgX,
                    top: previewBgY
                  }}
                />
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

        <div className="flex h-9 items-center gap-0.5">
          <button className="player-btn" onClick={togglePlay} aria-label={playing ? "暂停 (K)" : "播放 (K)"}>
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="player-btn" onClick={() => seekBy(-10)} aria-label="后退10秒 (J)">
            <Rewind size={18} />
          </button>
          <button className="player-btn" onClick={() => seekBy(10)} aria-label="快进10秒 (L)">
            <FastForward size={18} />
          </button>

          <div className="flex items-center gap-1.5 pl-1 group/vol">
            <button className="player-btn" onClick={() => setMuted((v) => !v)} aria-label={muted ? "取消静音 (M)" : "静音 (M)"}>
              {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>
            <input
              aria-label="音量"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(event) => { const next = Number(event.target.value); setVolume(next); setMuted(next === 0); }}
              className="player-slider w-0 overflow-hidden transition-[width] duration-150 group-hover/vol:w-20 focus:w-20"
              style={{ ["--val" as string]: `${(muted ? 0 : volume) * 100}%` }}
            />
          </div>

          <span className="ml-2 min-w-[96px] text-xs tabular-nums text-white/75 select-none">
            {formatTime(current)} / {formatTime(duration)}
          </span>

          <div className="ml-auto flex items-center gap-0.5">
            <div className="relative">
              <button
                className="player-btn min-w-[2.75rem] px-2 text-sm font-medium"
                onClick={() => setSpeedMenuOpen((v) => !v)}
                onWheel={(event) => { event.preventDefault(); cycleSpeed(event.deltaY > 0 ? 1 : -1); }}
                aria-label="播放速度"
              >
                {speed}×
              </button>
              {speedMenuOpen ? (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setSpeedMenuOpen(false)} />
                  <div className="absolute bottom-full right-0 z-20 mb-1 overflow-hidden rounded-lg border border-white/10 bg-[#1a1c22] py-1 shadow-xl">
                    {SPEEDS.map((value) => (
                      <button
                        key={value}
                        className={`flex w-20 items-center justify-center px-3 py-1.5 text-sm transition ${value === speed ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-white/70 hover:bg-white/8 hover:text-white"}`}
                        onClick={() => { setSpeed(value); setSpeedMenuOpen(false); }}
                      >
                        {value}×
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            <button className="player-btn" onClick={toggleFullscreen} aria-label={isFullscreen ? "退出全屏 (F)" : "全屏 (F)"}>
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "00:00";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
