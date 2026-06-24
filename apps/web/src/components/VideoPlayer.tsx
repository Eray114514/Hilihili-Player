"use client";

import { AlertTriangle, FastForward, LoaderCircle, Maximize, Minimize, Pause, Play, Rewind, Subtitles, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl, assetUrl, postJson } from "@/lib/api";
import type { PartDetail } from "@/lib/api";
import { findActiveCue, parseSubtitle, type SubtitleCue } from "@/lib/subtitles";

type VideoPlayerProps = {
  itemId: string;
  part: PartDetail | undefined;
  resumePosition?: number;
  onEnded?: () => void;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

type SubtitleMode = "chinese" | "bilingual";

export function VideoPlayer({ itemId, part, resumePosition = 0, onEnded }: VideoPlayerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const speedBtnRef = useRef<HTMLButtonElement>(null);
  const holdTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const holdingFastRef = useRef(false);
  const resumedPartRef = useRef<string | null>(null);
  const stallStartRef = useRef<number>(0);
  const isDraggingRef = useRef(false);

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
  const [progressHover, setProgressHover] = useState(false);

  const [subtitleTracks, setSubtitleTracks] = useState<Map<string, SubtitleCue[]>>(new Map());
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>("bilingual");
  const [subtitlePosition, setSubtitlePosition] = useState<"bottom" | "top">("bottom");
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [subtitleCues, setSubtitleCues] = useState<{ zh: SubtitleCue | null; ko: SubtitleCue | null }>({ zh: null, ko: null });

  const hasSubtitles = part && part.subtitles.length > 0;
  const showSubtitles = hasSubtitles && subtitlesEnabled;

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
    setProgressHover(false);
    setSubtitleTracks(new Map());
    setSubtitleCues({ zh: null, ko: null });
    setSubtitlesEnabled(part.subtitles.length > 0);
    setSubtitleMode(part.subtitles.some((track) => track.language === "ko") ? "bilingual" : "chinese");
  }

  const updateSubtitleCues = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const time = video.currentTime;
    setSubtitleCues({
      zh: findActiveCue(subtitleTracks.get("zh") ?? [], time),
      ko: findActiveCue(subtitleTracks.get("ko") ?? [], time)
    });
  }, [subtitleTracks]);

  useEffect(() => {
    if (!part || part.subtitles.length === 0) return;

    let ignore = false;
    const load = async () => {
      const map = new Map<string, SubtitleCue[]>();
      for (const track of part.subtitles) {
        const url = assetUrl(track.url);
        if (!url) continue;
        try {
          const response = await fetch(url);
          if (!response.ok) continue;
          const text = await response.text();
          const cues = parseSubtitle(text);
          map.set(track.language, cues);
        } catch {
          console.warn(`[player] failed to load subtitle: ${url}`);
        }
      }
      if (!ignore) {
        setSubtitleTracks(map);
        const video = videoRef.current;
        if (video) {
          setSubtitleCues({
            zh: findActiveCue(map.get("zh") ?? [], video.currentTime),
            ko: findActiveCue(map.get("ko") ?? [], video.currentTime)
          });
        }
      }
    };
    void load();
    return () => { ignore = true; };
  }, [part]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (!speedMenuOpen && !subtitleMenuOpen && !isDraggingRef.current) setControlsVisible(false);
    }, 2600);
  }, [speedMenuOpen, subtitleMenuOpen]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().then(() => setAutoPlayBlocked(false)).catch(() => setAutoPlayBlocked(true));
    } else {
      video.pause();
    }
    showControls();
  }, [showControls]);

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
    const dur = duration || video.duration || 0;
    const next = Math.max(0, Math.min(dur, video.currentTime + delta));
    setBuffering(true);
    video.currentTime = next;
    setCurrent(next);
    showControls();
  }, [duration, showControls]);

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
    showControls();
  }, [showControls]);

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
    const btn = speedBtnRef.current;
    if (!btn) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      cycleSpeed(event.deltaY > 0 ? 1 : -1);
    };
    btn.addEventListener("wheel", handleWheel, { passive: false });
    return () => btn.removeEventListener("wheel", handleWheel as EventListener);
  }, [cycleSpeed]);

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

  useEffect(() => {
    const handleGlobalKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (!shellRef.current) return;
      const rect = shellRef.current.getBoundingClientRect();
      const inView = rect.bottom > 0 && rect.top < window.innerHeight;
      if (!inView) return;

      const key = event.key.toLowerCase();
      const code = event.code;

      if (code === "Space" || key === "k") {
        event.preventDefault();
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
          void video.play().then(() => setAutoPlayBlocked(false)).catch(() => setAutoPlayBlocked(true));
        } else {
          video.pause();
        }
      } else if (key === "j") {
        event.preventDefault();
        seekBy(-10);
      } else if (key === "l") {
        event.preventDefault();
        seekBy(10);
      } else if (key === "arrowleft") {
        event.preventDefault();
        seekBy(-5);
      } else if (key === "arrowright") {
        event.preventDefault();
        seekBy(5);
      } else if (key === "f") {
        event.preventDefault();
        toggleFullscreen();
      } else if (key === "m") {
        event.preventDefault();
        setMuted((v) => !v);
        showControls();
      } else if (key === "arrowup") {
        event.preventDefault();
        setVolume((v) => Math.min(1, v + 0.1));
        showControls();
      } else if (key === "arrowdown") {
        event.preventDefault();
        setVolume((v) => Math.max(0, v - 0.1));
        showControls();
      } else if (key === "c") {
        event.preventDefault();
        if (part && part.subtitles.length > 0) {
          setSubtitlesEnabled((v) => !v);
          showControls();
        }
      } else if (key === "v") {
        event.preventDefault();
        if (part && part.subtitles.length > 0) {
          setSubtitleMode((mode) => mode === "chinese" ? "bilingual" : "chinese");
          showControls();
        }
      }
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, [togglePlay, seekBy, toggleFullscreen, showControls, part]);

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

  function computeHover(event: PointerEvent | React.PointerEvent<HTMLDivElement>) {
    const bar = progressRef.current;
    if (!bar || !duration) return null;
    const rect = bar.getBoundingClientRect();
    const pad = 12;
    const innerW = rect.width - pad * 2;
    const x = Math.max(pad, Math.min(rect.width - pad, event.clientX - rect.left)) - pad;
    const ratio = x / innerW;
    const time = ratio * duration;
    return { ratio, time, rect, innerX: x, innerW };
  }

  function handleProgressPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const result = computeHover(event);
    if (!result) return;
    const { ratio, time, innerX, innerW } = result;
    setHoverTime(time);
    setHoverRatio(ratio);
    const halfW = spriteInfo ? spriteInfo.thumbW / 2 : 40;
    setHoverLeftPx(Math.max(halfW, Math.min(innerW - halfW, innerX)));
    showControls();
  }

  function handleProgressPointerEnter() {
    setProgressHover(true);
  }

  function handleProgressPointerLeave() {
    setHoverTime(null);
    setProgressHover(false);
  }

  function handleProgressPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const bar = progressRef.current;
    if (!bar || !duration) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    isDraggingRef.current = true;
    const result = computeHover(event);
    if (result) seekTo(result.time);
    showControls();
  }

  function handleProgressPointerMoveDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return;
    const result = computeHover(event);
    if (result) {
      setHoverTime(result.time);
      setHoverRatio(result.ratio);
      const halfW = spriteInfo ? spriteInfo.thumbW / 2 : 40;
      setHoverLeftPx(Math.max(halfW, Math.min(result.innerW - halfW, result.innerX)));
      seekTo(result.time);
    }
    showControls();
  }

  function handleProgressPointerUp() {
    isDraggingRef.current = false;
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

  const showFullControls = controlsVisible || speedMenuOpen;
  const barThick = progressHover || showFullControls;

  return (
    <section
      ref={shellRef}
      tabIndex={0}
      className="group relative aspect-video overflow-hidden rounded-xl bg-black shadow-2xl shadow-black/30 outline-none ring-1 ring-white/10"
      onMouseMove={showControls}
      onFocus={showControls}
      onPointerLeave={() => {
        if (!speedMenuOpen && !subtitleMenuOpen) {
          if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
          setControlsVisible(false);
        }
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
          onTimeUpdate={(event) => { setCurrent(event.currentTarget.currentTime); updateSubtitleCues(); }}
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
      {autoPlayBlocked || (!playing && !buffering && !mediaError) ? (
        <button className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/92 text-black shadow-xl transition hover:scale-105" onClick={togglePlay} aria-label="播放">
          <Play className="ml-1" size={28} fill="currentColor" />
        </button>
      ) : null}

      {showSubtitles ? (
        <div
          className={`pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center px-4 text-center sm:px-8 ${subtitlePosition === "bottom" ? "bottom-[4.5rem] justify-end" : "top-6 justify-start"}`}
        >
          {subtitleCues.zh ? (
            <div className="max-w-[90%] rounded bg-black/70 px-3 py-1 text-base font-medium leading-snug text-white shadow-lg [text-shadow:0_1px_2px_rgba(0,0,0,.8)]">
              {subtitleCues.zh.text}
            </div>
          ) : null}
          {subtitleMode === "bilingual" && subtitleCues.ko ? (
            <div className="mt-1.5 max-w-[85%] rounded bg-black/60 px-2 py-0.5 text-xs leading-snug text-white/90 shadow-md [text-shadow:0_1px_2px_rgba(0,0,0,.8)]">
              {subtitleCues.ko.text}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className="absolute inset-x-0 bottom-0 z-20 select-none"
        onMouseMove={showControls}
      >
        <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/92 via-black/50 to-transparent transition-opacity duration-200 ${showFullControls ? "opacity-100" : "opacity-0"}`} style={{ height: 130 }} />

        <div
          ref={progressRef}
          className="group/progress relative cursor-pointer px-3"
          style={{ height: barThick ? 28 : 14, paddingTop: barThick ? 8 : 6, paddingBottom: barThick ? 4 : 0 }}
          onPointerEnter={handleProgressPointerEnter}
          onPointerMove={(e) => { handleProgressPointerMove(e); handleProgressPointerMoveDrag(e); }}
          onPointerLeave={handleProgressPointerLeave}
          onPointerDown={handleProgressPointerDown}
          onPointerUp={handleProgressPointerUp}
          onPointerDownCapture={(e) => e.stopPropagation()}
          onPointerUpCapture={(e) => e.stopPropagation()}
        >
          <div className={`relative w-full overflow-hidden rounded-full bg-white/20 transition-[height] duration-100 ${barThick ? "h-1.5" : "h-[3px]"}`}>
            <div className="absolute inset-y-0 left-0 bg-white/35 transition-[width] duration-100" style={{ width: `${bufferedPct}%` }} />
            <div className={`pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-100 ${barThick ? "bg-[var(--accent)]" : "bg-[var(--accent)]/80"}`} style={{ width: `${progressPct}%` }} />
            {hoverTime != null ? (
              <div className="pointer-events-none absolute inset-y-0 left-0 bg-white/25" style={{ width: `${hoverPct}%` }} />
            ) : null}
            {barThick ? (
              <div
                className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] shadow-md ring-2 ring-black/40"
                style={{ left: `${progressPct}%` }}
              />
            ) : null}
          </div>

          {hoverTime != null && barThick && spriteUrl && spriteInfo && hoverTileIndex >= 0 ? (
            <div
              className="pointer-events-none absolute -translate-x-1/2 overflow-hidden rounded-lg border border-white/15 bg-black shadow-2xl"
              style={{ left: `calc(12px + ${hoverLeftPx}px)`, bottom: "100%" }}
            >
              <div className="relative overflow-hidden" style={{ width: spriteInfo.thumbW, height: spriteInfo.thumbH }}>
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
          ) : hoverTime != null && barThick ? (
            <div
              className="pointer-events-none absolute -translate-x-1/2 rounded-md bg-black/90 px-2 py-1 text-xs tabular-nums text-white shadow-lg"
              style={{ left: `calc(12px + ${hoverLeftPx}px)`, bottom: "100%" }}
            >
              {formatTime(hoverTime)}
            </div>
          ) : null}
        </div>

        <div
          className={`flex h-9 items-center gap-0.5 px-3 pb-2 transition-opacity duration-200 ${showFullControls ? "opacity-100" : "pointer-events-none opacity-0"}`}
          onPointerDownCapture={(e) => e.stopPropagation()}
          onPointerUpCapture={(e) => e.stopPropagation()}
        >
          <button className="player-btn pointer-events-auto" onClick={togglePlay} aria-label={playing ? "暂停 (K)" : "播放 (K)"}>
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="player-btn pointer-events-auto" onClick={() => seekBy(-10)} aria-label="后退10秒 (J)">
            <Rewind size={18} />
          </button>
          <button className="player-btn pointer-events-auto" onClick={() => seekBy(10)} aria-label="快进10秒 (L)">
            <FastForward size={18} />
          </button>

          <div className="pointer-events-auto flex items-center gap-1.5 pl-1 group/vol">
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
            {hasSubtitles ? (
              <div className="relative pointer-events-auto">
                <button
                  className={`player-btn ${!subtitlesEnabled ? "text-white/40" : subtitleMode === "chinese" ? "text-[var(--accent)]" : ""}`}
                  onClick={() => setSubtitleMenuOpen((v) => !v)}
                  aria-label="字幕"
                >
                  <Subtitles size={18} />
                </button>
                {subtitleMenuOpen ? (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setSubtitleMenuOpen(false)} />
                    <div className="absolute bottom-full right-0 z-20 mb-1 w-40 overflow-hidden rounded-lg border border-white/10 bg-[#1a1c22] py-1 shadow-xl">
                      <button
                        className="flex w-full items-center justify-between px-3 py-1.5 text-sm text-white/70 hover:bg-white/8 hover:text-white"
                        onClick={() => { setSubtitlesEnabled((v) => !v); setSubtitleMenuOpen(false); showControls(); }}
                      >
                        <span>{subtitlesEnabled ? "关闭字幕" : "开启字幕"}</span>
                        {subtitlesEnabled ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" /> : null}
                      </button>
                      <div className="my-1 h-px bg-white/10" />
                      <button
                        className={`flex w-full items-center px-3 py-1.5 text-sm transition ${subtitleMode === "chinese" ? "text-[var(--accent)]" : "text-white/70 hover:bg-white/8 hover:text-white"}`}
                        onClick={() => { setSubtitleMode("chinese"); setSubtitlesEnabled(true); setSubtitleMenuOpen(false); showControls(); }}
                      >
                        仅中文
                      </button>
                      <button
                        className={`flex w-full items-center px-3 py-1.5 text-sm transition ${subtitleMode === "bilingual" ? "text-[var(--accent)]" : "text-white/70 hover:bg-white/8 hover:text-white"}`}
                        onClick={() => { setSubtitleMode("bilingual"); setSubtitlesEnabled(true); setSubtitleMenuOpen(false); showControls(); }}
                      >
                        中韩双语
                      </button>
                      <div className="my-1 h-px bg-white/10" />
                      <button
                        className={`flex w-full items-center px-3 py-1.5 text-sm transition ${subtitlePosition === "bottom" ? "text-[var(--accent)]" : "text-white/70 hover:bg-white/8 hover:text-white"}`}
                        onClick={() => { setSubtitlePosition("bottom"); setSubtitleMenuOpen(false); showControls(); }}
                      >
                        底部显示
                      </button>
                      <button
                        className={`flex w-full items-center px-3 py-1.5 text-sm transition ${subtitlePosition === "top" ? "text-[var(--accent)]" : "text-white/70 hover:bg-white/8 hover:text-white"}`}
                        onClick={() => { setSubtitlePosition("top"); setSubtitleMenuOpen(false); showControls(); }}
                      >
                        顶部显示
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="relative pointer-events-auto">
              <button
                ref={speedBtnRef}
                className="player-btn min-w-[2.75rem] px-2 text-sm font-medium"
                onClick={() => setSpeedMenuOpen((v) => !v)}
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
                        onClick={() => { setSpeed(value); setSpeedMenuOpen(false); showControls(); }}
                      >
                        {value}×
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            <button className="player-btn pointer-events-auto" onClick={toggleFullscreen} aria-label={isFullscreen ? "退出全屏 (F)" : "全屏 (F)"}>
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
