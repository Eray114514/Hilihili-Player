"use client";

import { AlertTriangle, FastForward, LoaderCircle, Maximize, Minimize, Pause, Play, Rewind, Subtitles, Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiUrl, assetUrl, type PartDetail } from "@/lib/api";
import { fadeIn, slideDown } from "@/lib/motion";
import { decodeSubtitle, findActiveCue, parseSubtitle, type SubtitleCue } from "@/lib/subtitles";
import { ProgressBar } from "@/components/player/ProgressBar";
import { SubtitleOverlay } from "@/components/player/SubtitleOverlay";
import { SpeedMenu } from "@/components/player/SpeedMenu";
import { useVideoProgress } from "@/components/player/useVideoProgress";
import { SPEEDS } from "@/components/player/constants";
import { formatTime } from "@/components/player/format";

type VideoPlayerProps = {
  itemId: string;
  part: PartDetail | undefined;
  resumePosition?: number;
  isLastPart?: boolean;
  onEnded?: () => void;
};

// 单一播放状态机，消除 playing/buffering/autoPlayBlocked/mediaError 四个布尔的组合歧义
type PlayerState = "loading" | "playing" | "paused" | "buffering" | "error";

type SubtitleMode = "chinese" | "bilingual";

export function VideoPlayer({ itemId, part, resumePosition = 0, isLastPart = false, onEnded }: VideoPlayerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const holdTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const holdingFastRef = useRef(false);
  const resumedPartRef = useRef<string | null>(null);
  const subtitleRawRef = useRef<Map<string, string>>(new Map());
  const speedBtnRef = useRef<HTMLButtonElement>(null);

  const [state, setState] = useState<PlayerState>("loading");
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [holdingFast, setHoldingFast] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [buffered, setBuffered] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const [loadedSpriteUrl, setLoadedSpriteUrl] = useState<string | null>(null);
  const [failedSpriteUrl, setFailedSpriteUrl] = useState<string | null>(null);

  const [subtitleTracks, setSubtitleTracks] = useState<Map<string, SubtitleCue[]>>(new Map());
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [subtitleMode, setSubtitleMode] = useState<SubtitleMode>("bilingual");
  const [subtitlePosition, setSubtitlePosition] = useState<"bottom" | "top">("bottom");
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [subtitleCues, setSubtitleCues] = useState<{ primary: SubtitleCue | null; secondary: SubtitleCue | null }>({ primary: null, secondary: null });

  const hasSubtitles = part && part.subtitles.length > 0;
  const primarySubtitle = useMemo(() => {
    if (!part) return null;
    return part.subtitles.find((track) => track.isDefault)
      ?? part.subtitles.find((track) => track.language === "zh")
      ?? part.subtitles[0]
      ?? null;
  }, [part]);
  const secondarySubtitle = useMemo(() => {
    if (!part || !primarySubtitle) return null;
    return part.subtitles.find((track) => track.id !== primarySubtitle.id && track.language !== primarySubtitle.language)
      ?? part.subtitles.find((track) => track.id !== primarySubtitle.id)
      ?? null;
  }, [part, primarySubtitle]);
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

  useEffect(() => {
    if (!spriteUrl) return;
    let ignore = false;
    const image = new window.Image();
    image.onload = () => {
      if (!ignore) setLoadedSpriteUrl(spriteUrl);
    };
    image.onerror = () => {
      if (!ignore) setFailedSpriteUrl(spriteUrl);
    };
    image.src = spriteUrl;
    return () => {
      ignore = true;
      image.onload = null;
      image.onerror = null;
    };
  }, [spriteUrl]);

  const spriteLoaded = !!spriteUrl && loadedSpriteUrl === spriteUrl;
  const spriteError = !!spriteUrl && failedSpriteUrl === spriteUrl;

  // 切换 part 由父组件用 key={activePart?.id} 触发 remount，所有内部 state 自然重置，
  // 这里不再需要在 render 期 setState 重置（消除原 if (part.id !== prevPartId) 反模式）。

  const { saveProgress, markFinished, latestProgressRef, checkCompletion } = useVideoProgress({
    itemId,
    part,
    duration,
    isLastPart,
    videoRef,
    onEnded
  });

  const updateSubtitleCues = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const time = video.currentTime;
    setSubtitleCues({
      primary: primarySubtitle ? findActiveCue(subtitleTracks.get(primarySubtitle.id) ?? [], time) : null,
      secondary: secondarySubtitle ? findActiveCue(subtitleTracks.get(secondarySubtitle.id) ?? [], time) : null
    });
  }, [subtitleTracks, primarySubtitle, secondarySubtitle]);

  useEffect(() => {
    if (!part || part.subtitles.length === 0) return;

    let ignore = false;
    let timer: number | null = null;
    subtitleRawRef.current = new Map();

    const load = async () => {
      const map = new Map<string, SubtitleCue[]>();
      const rawMap = new Map<string, string>();
      let changed = false;
      for (const track of part.subtitles) {
        const base = assetUrl(track.url);
        if (!base) continue;
        try {
          const response = await fetch(base, { cache: "no-store" });
          if (!response.ok) continue;
          const text = decodeSubtitle(await response.arrayBuffer());
          rawMap.set(track.id, text);
          if (subtitleRawRef.current.get(track.id) !== text) changed = true;
          map.set(track.id, parseSubtitle(text));
        } catch {
          console.warn(`[player] failed to load subtitle: ${base}`);
        }
      }
      if (ignore || !changed) return;
      subtitleRawRef.current = rawMap;
      setSubtitleTracks(map);
      const video = videoRef.current;
      if (video) {
        setSubtitleCues({
          primary: primarySubtitle ? findActiveCue(map.get(primarySubtitle.id) ?? [], video.currentTime) : null,
          secondary: secondarySubtitle ? findActiveCue(map.get(secondarySubtitle.id) ?? [], video.currentTime) : null
        });
      }
    };
    void load();
    timer = window.setInterval(load, 5000);
    return () => {
      ignore = true;
      if (timer) window.clearInterval(timer);
    };
  }, [part, primarySubtitle, secondarySubtitle]);

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
      void video.play().then(() => setState("playing")).catch(() => setState("paused"));
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
    video.currentTime = next;
    setCurrent(next);
  }, [duration]);

  const seekTo = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
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

  // 拖动进度条期间保持控件可见，拖动结束后重新启动自动隐藏计时
  const handleDraggingChange = useCallback((dragging: boolean) => {
    if (dragging) {
      setControlsVisible(true);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    } else {
      showControls();
    }
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
    const handlePointerDown = (event: PointerEvent) => {
      const shell = shellRef.current;
      if (!shell) return;
      if (shell.contains(event.target as Node)) return;
      setControlsVisible(false);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

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

  const showSpinner = (state === "loading" || state === "buffering") && !holdingFast;

  return (
    <section
      ref={shellRef}
      tabIndex={0}
      className="group relative aspect-video overflow-hidden rounded-xl bg-black shadow-2xl shadow-black/30 outline-none ring-1 ring-white/10"
      onMouseMove={showControls}
      onFocus={showControls}
      onKeyDown={(event) => {
        // 排除 Ctrl/Cmd/Alt 修饰键，避免与浏览器/系统快捷键冲突；Shift 单独放行
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.code === "Space") { event.preventDefault(); togglePlay(); }
        if (event.key.toLowerCase() === "k") { event.preventDefault(); togglePlay(); }
        if (event.key.toLowerCase() === "j") { event.preventDefault(); seekBy(-10); }
        if (event.key.toLowerCase() === "l") { event.preventDefault(); seekBy(10); }
        if (event.key === "ArrowLeft") { event.preventDefault(); seekBy(-5); }
        if (event.key === "ArrowRight") { event.preventDefault(); seekBy(5); }
        if (event.key.toLowerCase() === "f") { event.preventDefault(); toggleFullscreen(); }
        if (event.key.toLowerCase() === "m") { event.preventDefault(); setMuted((v) => !v); }
        if (event.key === "ArrowUp") { event.preventDefault(); cycleSpeed(-1); }
        if (event.key === "ArrowDown") { event.preventDefault(); cycleSpeed(1); }
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
          onPlay={() => setState("playing")}
          onPause={() => { setState("paused"); saveProgress(true); }}
          onWaiting={() => setState("buffering")}
          onPlaying={() => setState(videoRef.current?.paused ? "paused" : "playing")}
          onCanPlay={() => setState(videoRef.current?.paused ? "paused" : "playing")}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            const dur = video.duration || 0;
            setDuration(dur);
            if (resumedPartRef.current !== partId && resumePosition > 0 && resumePosition < dur - 3) {
              video.currentTime = resumePosition;
              setCurrent(resumePosition);
              resumedPartRef.current = partId;
            }
            latestProgressRef.current = { partId, positionSeconds: video.currentTime, durationSeconds: dur };
            void video.play().then(() => setState("playing")).catch(() => setState("paused"));
          }}
          onTimeUpdate={(event) => {
            const video = event.currentTarget;
            setCurrent(video.currentTime);
            updateSubtitleCues();
            latestProgressRef.current = { partId, positionSeconds: video.currentTime, durationSeconds: video.duration || duration };
            checkCompletion(video.currentTime, video.duration);
          }}
          onVolumeChange={(event) => {
            const v = event.currentTarget;
            setVolume(v.muted ? 0 : v.volume);
            setMuted(v.muted);
          }}
          onProgress={(event) => {
            const video = event.currentTarget;
            setBuffered(computeBufferedAhead(video));
          }}
          onEnded={markFinished}
          onError={() => setState("error")}
        />
      </div>

      {state === "error" ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex w-[min(90%,28rem)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 rounded-xl bg-black/80 p-5 text-center text-sm text-white/75">
          <AlertTriangle size={32} className="text-amber-400" />
          <span>{part.compatibilityStatus === "failed" ? "该视频转换失败，请检查 worker 日志或源文件是否损坏。" : "浏览器无法加载该视频，请重新扫描媒体库后再试。"}</span>
        </div>
      ) : (
        <AnimatePresence>
          {showSpinner ? (
            <motion.div
              key="buffering-spinner"
              variants={fadeIn}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            >
              <LoaderCircle className="animate-spin text-white/80" size={42} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      )}
      {holdingFast ? <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm font-semibold">3× 快进中</div> : null}
      {state === "paused" ? (
        <button className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/92 text-black shadow-xl transition hover:scale-105" onClick={togglePlay} aria-label="播放">
          <Play className="ml-1" size={28} fill="currentColor" />
        </button>
      ) : null}

      <SubtitleOverlay
        cues={subtitleCues}
        mode={subtitleMode}
        position={subtitlePosition}
        controlsVisible={controlsVisible}
        isFullscreen={isFullscreen}
        visible={showSubtitles}
      />

      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-3 pb-2 pt-12 transition-opacity duration-200 ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onMouseMove={(event) => event.stopPropagation()}
      >
        <ProgressBar
          duration={duration}
          current={current}
          buffered={buffered}
          spriteUrl={spriteUrl}
          spriteInfo={spriteInfo}
          spriteLoaded={spriteLoaded}
          spriteError={spriteError}
          onSeekTo={seekTo}
          onDraggingChange={handleDraggingChange}
        />

        <div className="flex h-9 items-center gap-0.5">
          <button className="player-btn" onClick={togglePlay} aria-label={state === "playing" ? "暂停 (K)" : "播放 (K)"}>
            {state === "playing" ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
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
                {subtitleMenuOpen ? <div className="fixed inset-0 z-10" onClick={() => setSubtitleMenuOpen(false)} /> : null}
                <AnimatePresence>
                  {subtitleMenuOpen ? (
                    <motion.div
                      key="subtitle-menu"
                      variants={slideDown}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="absolute bottom-full right-0 z-20 mb-1 w-40 overflow-hidden rounded-lg border border-white/10 bg-[#1a1c22] py-1 shadow-xl"
                    >
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
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            ) : null}

            <SpeedMenu
              speed={speed}
              onSpeedChange={setSpeed}
              open={speedMenuOpen}
              onOpenChange={setSpeedMenuOpen}
              buttonRef={speedBtnRef}
              onWheelChange={cycleSpeed}
            />

            <button className="player-btn" onClick={toggleFullscreen} aria-label={isFullscreen ? "退出全屏 (F)" : "全屏 (F)"}>
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// 计算当前播放位置之后已缓冲的终点，支持 HTTP Range 产生的多段缓冲
function computeBufferedAhead(video: HTMLVideoElement): number {
  const ranges = video.buffered;
  if (ranges.length === 0) return 0;
  const current = video.currentTime;
  for (let i = 0; i < ranges.length; i++) {
    if (current >= ranges.start(i) && current <= ranges.end(i)) {
      return ranges.end(i);
    }
  }
  // current 不在任何段内（罕见，例如 seek 到未缓冲区）：返回最接近的段端点
  return ranges.end(ranges.length - 1);
}
