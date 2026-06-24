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
  isLastPart?: boolean;
  onEnded?: () => void;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

type SubtitleMode = "chinese" | "bilingual";

export function VideoPlayer({ itemId, part, resumePosition = 0, isLastPart = false, onEnded }: VideoPlayerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const holdTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const holdingFastRef = useRef(false);
  const resumedPartRef = useRef<string | null>(null);
  const stallStartRef = useRef<number>(0);
  const latestProgressRef = useRef<{ partId: string; positionSeconds: number; durationSeconds: number } | null>(null);
  const lastSavedRef = useRef<{ partId: string; positionSeconds: number } | null>(null);
  const completionSentRef = useRef<string | null>(null);

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

  const [subtitleTracks, setSubtitleTracks] = useState<Map<string, SubtitleCue[]>>(new Map());
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>("bilingual");
  const [subtitlePosition, setSubtitlePosition] = useState<"bottom" | "top">("bottom");
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [subtitleCues, setSubtitleCues] = useState<{ primary: SubtitleCue | null; secondary: SubtitleCue | null }>({ primary: null, secondary: null });

  const hasSubtitles = part && part.subtitles.length > 0;
  const secondaryLanguage = useMemo(() => part?.subtitles.find((track) => track.language !== "zh")?.language ?? null, [part]);
  const showSubtitles = !!hasSubtitles && subtitlesEnabled;

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
    setSubtitleTracks(new Map());
    setSubtitleCues({ primary: null, secondary: null });
    setSubtitlesEnabled(part.subtitles.length > 0);
    setSubtitleMode(secondaryLanguage ? "bilingual" : "chinese");
  }

  const updateSubtitleCues = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const time = video.currentTime;
    setSubtitleCues({
      primary: findActiveCue(subtitleTracks.get("zh") ?? [], time),
      secondary: secondaryLanguage ? findActiveCue(subtitleTracks.get(secondaryLanguage) ?? [], time) : null
    });
  }, [subtitleTracks, secondaryLanguage]);

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
            primary: findActiveCue(map.get("zh") ?? [], video.currentTime),
            secondary: secondaryLanguage ? findActiveCue(map.get(secondaryLanguage) ?? [], video.currentTime) : null
          });
        }
      }
    };
    void load();
    return () => { ignore = true; };
  }, [part, secondaryLanguage]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (!speedMenuOpen && !subtitleMenuOpen) setControlsVisible(false);
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
    }).catch(() => undefined);
  }, [itemId]);

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
  }, [part, saveProgress]);

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
      positionSeconds: duration,
      durationSeconds: duration
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

  const subtitlePositionClasses = subtitlePosition === "bottom"
    ? isFullscreen ? "bottom-12 justify-end" : "bottom-[5.5rem] justify-end"
    : isFullscreen ? "top-4 justify-start" : "top-6 justify-start";

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
        if (event.key.toLowerCase() === "c") {
          event.preventDefault();
          if (hasSubtitles) {
            setSubtitlesEnabled((v) => !v);
            showControls();
          }
        }
        if (event.key.toLowerCase() === "v") {
          event.preventDefault();
          if (hasSubtitles) {
            setSubtitleMode((mode) => mode === "chinese" ? "bilingual" : "chinese");
            showControls();
          }
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
          onPause={() => { setPlaying(false); saveProgress(true); }}
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
            latestProgressRef.current = { partId, positionSeconds: video.currentTime, durationSeconds: dur };
            if (resumedPartRef.current !== partId && resumePosition > 0 && resumePosition < dur - 3) {
              video.currentTime = resumePosition;
              setCurrent(resumePosition);
              resumedPartRef.current = partId;
            }
            void video.play().catch(() => setAutoPlayBlocked(true));
          }}
          onTimeUpdate={(event) => {
            const video = event.currentTarget;
            setCurrent(video.currentTime);
            updateSubtitleCues();
            latestProgressRef.current = { partId, positionSeconds: video.currentTime, durationSeconds: video.duration || duration };
            if (isLastPart && video.duration > 0 && video.currentTime >= video.duration * 0.9 && completionSentRef.current !== partId) {
              completionSentRef.current = partId;
              saveProgress(true);
            }
          }}
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

      {showSubtitles ? (
        <div
          className={`pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center px-4 text-center sm:px-8 ${subtitlePositionClasses}`}
        >
          {subtitleCues.primary ? (
            <div className="max-w-[90%] rounded bg-black/70 px-3 py-1 text-base font-medium leading-snug text-white shadow-lg [text-shadow:0_1px_2px_rgba(0,0,0,.8)]">
              {subtitleCues.primary.text}
            </div>
          ) : null}
          {subtitleMode === "bilingual" && subtitleCues.secondary ? (
            <div className="mt-1.5 max-w-[85%] rounded bg-black/60 px-2 py-0.5 text-xs leading-snug text-white/90 shadow-md [text-shadow:0_1px_2px_rgba(0,0,0,.8)]">
              {subtitleCues.secondary.text}
            </div>
          ) : null}
        </div>
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
            {hasSubtitles ? (
              <div className="relative">
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
                        双语（中文+外语）
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
