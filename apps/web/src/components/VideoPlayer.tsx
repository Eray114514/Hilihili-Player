"use client";

import { AlertTriangle, FastForward, LoaderCircle, Maximize, Minimize, Pause, Play, Rewind, Subtitles, Volume2, VolumeX } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assetUrl, type PartDetail } from "@/lib/api";
import { fadeIn, slideDown } from "@/lib/motion";
import { decodeSubtitle, findActiveCue, parseSubtitle, type SubtitleCue } from "@/lib/subtitles";
import { ProgressBar } from "@/components/player/ProgressBar";
import { SubtitleOverlay } from "@/components/player/SubtitleOverlay";
import { SpeedMenu } from "@/components/player/SpeedMenu";
import { QualityMenu } from "@/components/player/QualityMenu";
import { useHlsSource } from "@/components/player/useHlsSource";
import { useVideoProgress } from "@/components/player/useVideoProgress";
import { SPEEDS, HOLD_RATE, HOLD_RATE_REASSERT_LIMIT } from "@/components/player/constants";
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
  const holdRateRetryRef = useRef(0);
  const resumedPartRef = useRef<string | null>(null);
  // 已解析字幕的缓存（按分P维度）。用于避免切换字幕语言时重复下载同一批字幕文件。
  const subtitleCacheRef = useRef<{ partId: string; cues: Map<string, SubtitleCue[]> }>({ partId: "", cues: new Map() });
  const speedBtnRef = useRef<HTMLButtonElement>(null);

  const [state, setState] = useState<PlayerState>("loading");
  // state 的镜像：事件回调里需要在不重建闭包的前提下读到"当前是不是加载/缓冲态"
  const stateRef = useRef<PlayerState>("loading");
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
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
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

  // 扫描时 ffprobe 记录的时长，作为元素自身时长的兜底。
  // 有些容器（fMP4 的空 moov、没有 duration 元素的 WebM 等）会让浏览器报 duration = Infinity，
  // 而 ffprobe 会读到真实时长；只信元素会把进度条永久钉死。
  const recordedDuration = typeof part?.durationSeconds === "number" && Number.isFinite(part.durationSeconds) && part.durationSeconds > 0
    ? part.durationSeconds
    : 0;
  // 全站唯一的"总时长"口径：元素报的有限正值优先，否则回落到扫描结果。
  const effectiveDuration = duration > 0 ? duration : recordedDuration;

  const applyState = useCallback((next: PlayerState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // 只在元素报出有限正值时才接受：Infinity / NaN 会污染 formatTime、进度条百分比和完成度判定
  const syncDuration = useCallback((video: HTMLVideoElement) => {
    const value = video.duration;
    if (Number.isFinite(value) && value > 0) setDuration(value);
  }, []);

  // 把"元素的实际播放真相"对账回状态机。
  // force=false 时只负责把 loading/buffering 落地（时间在推进就说明根本不在缓冲），
  // force=true 表示由 canplay/playing/seeked 这类"确定就绪"的事件驱动，直接以元素为准。
  const syncPlaybackState = useCallback((video: HTMLVideoElement, force = false) => {
    if (video.readyState < 2) return;
    const currentState = stateRef.current;
    if (currentState === "error") return;
    if (!force && currentState !== "loading" && currentState !== "buffering") return;
    applyState(video.paused ? "paused" : "playing");
  }, [applyState]);

  const { saveProgress, markFinished, latestProgressRef, checkCompletion } = useVideoProgress({
    itemId,
    part,
    duration: effectiveDuration,
    isLastPart,
    videoRef,
    onEnded
  });

  // 所有 hook 必须在下面的 `if (!part) return` 之前调用，所以这里用可空 id
  const activePartId = part?.id ?? "";

  /**
   * 应用续播位置。
   *
   * 抽成函数是因为「时长何时可信」有三种情况：
   * 直连 MP4 在 loadedmetadata 就有完整时长；HLS 下 loadedmetadata 可能早于真实时长，
   * 要等 hls.js 的 LEVEL_LOADED。三处都调用同一个函数，靠 resumedPartRef 保证只生效一次。
   */
  const tryApplyResume = useCallback((video: HTMLVideoElement, knownDuration = 0) => {
    if (!activePartId || resumedPartRef.current === activePartId) return;
    const elementDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const dur = knownDuration > 0 ? knownDuration : elementDuration || effectiveDuration;
    if (resumePosition <= 0 || dur <= 0 || resumePosition >= dur - 3) return;
    resumedPartRef.current = activePartId;
    video.currentTime = resumePosition;
    setCurrent(resumePosition);
    latestProgressRef.current = { partId: activePartId, positionSeconds: resumePosition, durationSeconds: dur };
  }, [activePartId, effectiveDuration, latestProgressRef, resumePosition]);

  // 播放源决策：优先 HLS 切片流，未就绪先播原画直连。这个 hook 完全接管 <video> 的 src。
  const hlsSource = useHlsSource({
    partId: activePartId,
    enabled: Boolean(part),
    videoRef,
    onDurationReady: (value) => {
      const video = videoRef.current;
      if (!video) return;
      setDuration(value);
      tryApplyResume(video, value);
    }
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
    // 换分P 时废弃上一集缓存的字幕
    if (subtitleCacheRef.current.partId !== part.id) {
      subtitleCacheRef.current = { partId: part.id, cues: new Map() };
    }

    const load = async () => {
      // 只下载还没解析过的轨道，并并发发起（原来是无条件整批重下、且 for 循环里串行 await，
      // 还额外挂了 60s 轮询——字幕文件在播放期间不会变，那些请求纯属浪费带宽）
      const cached = subtitleCacheRef.current.cues;
      const map = new Map<string, SubtitleCue[]>(cached);
      const missing = part.subtitles.filter((track) => !map.has(track.id));
      const loaded = await Promise.all(missing.map(async (track) => {
        const base = assetUrl(track.url);
        if (!base) return null;
        try {
          const response = await fetch(base, { signal: AbortSignal.timeout(15000) });
          if (!response.ok) return null;
          return { id: track.id, cues: parseSubtitle(decodeSubtitle(await response.arrayBuffer())) };
        } catch {
          console.warn(`[player] failed to load subtitle: ${base}`);
          return null;
        }
      }));
      for (const entry of loaded) {
        if (entry) map.set(entry.id, entry.cues);
      }
      if (ignore) return;
      subtitleCacheRef.current = { partId: part.id, cues: map };
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
    return () => {
      ignore = true;
    };
  }, [part, primarySubtitle, secondarySubtitle]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (!speedMenuOpen && !subtitleMenuOpen && !qualityMenuOpen) setControlsVisible(false);
    }, 2600);
  }, [speedMenuOpen, subtitleMenuOpen, qualityMenuOpen]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().then(() => applyState("playing")).catch(() => applyState("paused"));
    } else {
      video.pause();
    }
  }, [applyState]);

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
    const target = video.currentTime + delta;
    // 元素时长可能是 NaN/Infinity（未知时长容器），非有限值时不做上界裁剪
    const rawLimit = effectiveDuration || video.duration;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : target;
    const next = Math.max(0, Math.min(limit, target));
    video.currentTime = next;
    setCurrent(next);
  }, [effectiveDuration]);

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
    const target = holdingFast ? HOLD_RATE : speed;
    // defaultPlaybackRate 是元素内部重新加载资源时的回落值，一并对齐：
    // 任何一次内部 load 都不会把倍速打回 1x
    video.defaultPlaybackRate = target;
    if (video.playbackRate !== target) video.playbackRate = target;
  }, [speed, holdingFast]);

  // 部分环境（音频渲染管线不支持时间拉伸、资源内部重载等）会把 playbackRate 悄悄改写回 1x，
  // 表现就是"长按只快进一瞬间"。按住期间由播放器持有倍速，被改回去就重新压回来。
  // 次数有上限，避免和浏览器互相改写形成死循环。
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onRateChange = () => {
      if (!holdingFastRef.current || video.playbackRate === HOLD_RATE) return;
      if (holdRateRetryRef.current <= 0) {
        console.warn("[player] 当前环境未接受长按快进倍速，本次长按降级为原速");
        return;
      }
      holdRateRetryRef.current -= 1;
      video.defaultPlaybackRate = HOLD_RATE;
      video.playbackRate = HOLD_RATE;
    };
    video.addEventListener("ratechange", onRateChange);
    return () => video.removeEventListener("ratechange", onRateChange);
  }, []);

  // 缓存命中的视频可能在 React 挂上监听器之前就已经把 loadedmetadata/canplay/playing 发完了，
  // 只靠事件会把"加载中"永久卡住。这里在挂载后补几轮对账，直到元素真的有了数据。
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      syncDuration(video);
      // 只收掉"假加载态"：真缓冲由 waiting 事件驱动，且此时时间不会推进
      if (stateRef.current === "loading") syncPlaybackState(video);
      if (video.readyState >= 2 || attempts >= 20) window.clearInterval(timer);
    }, 150);
    return () => window.clearInterval(timer);
  }, [syncDuration, syncPlaybackState]);

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

  // mount 时聚焦播放器外壳，让键盘快捷键立即可用
  useEffect(() => {
    shellRef.current?.focus();
  }, []);

  // 字幕菜单打开时按 Escape 关闭
  useEffect(() => {
    if (!subtitleMenuOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setSubtitleMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [subtitleMenuOpen]);

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
      aria-label="视频播放器"
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
            holdRateRetryRef.current = HOLD_RATE_REASSERT_LIMIT;
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
          // 不设 src：地址完全由 useHlsSource 接管（直连 / hls.js / Safari 原生 HLS 三种落源方式）
          className="h-full w-full select-none object-contain"
          playsInline
          autoPlay
          // 不用 auto：远端带宽受限时，auto 会让浏览器把预读窗口拉到很大，
          // 把同一时刻的封面/接口请求全挤掉。metadata 足够起播对账，后续按播放进度取数。
          preload="metadata"
          onPlay={() => applyState("playing")}
          onPause={() => { applyState("paused"); saveProgress(true); }}
          onWaiting={() => applyState("buffering")}
          onPlaying={(event) => syncPlaybackState(event.currentTarget, true)}
          onCanPlay={(event) => syncPlaybackState(event.currentTarget, true)}
          onCanPlayThrough={(event) => syncPlaybackState(event.currentTarget, true)}
          // seek 结束后必须重新对账：seeking→waiting 之后若不补一次，转圈会一直挂着
          onSeeked={(event) => syncPlaybackState(event.currentTarget, true)}
          onDurationChange={(event) => {
            syncDuration(event.currentTarget);
            // HLS 下时长往往是 durationchange 才变准，续播不能只挂在 loadedmetadata 上
            tryApplyResume(event.currentTarget);
          }}
          onLoadedData={(event) => { syncDuration(event.currentTarget); syncPlaybackState(event.currentTarget, true); }}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            syncDuration(video);
            // 续播位置由 tryApplyResume 统一处理（它会判断时长是否已经可信）
            tryApplyResume(video);
            latestProgressRef.current = { partId, positionSeconds: video.currentTime, durationSeconds: effectiveDuration || video.duration || 0 };
            void video.play().then(() => applyState("playing")).catch(() => applyState("paused"));
          }}
          onTimeUpdate={(event) => {
            const video = event.currentTarget;
            setCurrent(video.currentTime);
            syncDuration(video);
            // 时间在推进 = 数据在进来且没被暂停，此时还挂着 loading/buffering 一定是事件漏了
            if (!video.seeking) syncPlaybackState(video);
            updateSubtitleCues();
            latestProgressRef.current = { partId, positionSeconds: video.currentTime, durationSeconds: effectiveDuration || video.duration || 0 };
            checkCompletion(video.currentTime, effectiveDuration || video.duration);
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
          onError={() => applyState("error")}
        />
      </div>

      {state === "error" ? (
        <div className="pointer-events-none absolute left-1/2 top-1/2 flex w-[min(90%,28rem)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 rounded-xl bg-black/80 p-5 text-center text-sm text-white/75">
          <AlertTriangle size={32} className="text-amber-400" aria-hidden="true" />
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
              <LoaderCircle className="animate-spin text-white/80" size={42} aria-hidden="true" />
            </motion.div>
          ) : null}
        </AnimatePresence>
      )}
      {holdingFast ? <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm font-semibold">3× 快进中</div> : null}
      {/* 远程场景：切片流还在生成时，如实告诉用户当前放的是原画直连、离就绪还有多远 */}
      {hlsSource.preparation === "preparing" ? (
        <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/68 px-2.5 py-1 text-[11px] text-white/82 backdrop-blur-sm">
          正在准备切片版 {Math.round(hlsSource.progress * 100)}% · 当前为原画直连
        </div>
      ) : null}
      {hlsSource.error?.includes("降级") ? (
        <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-amber-500/85 px-2.5 py-1 text-[11px] font-medium text-black backdrop-blur-sm">
          {hlsSource.error}
        </div>
      ) : null}
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
          duration={effectiveDuration}
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
            {formatTime(current)} / {formatTime(effectiveDuration)}
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

            <QualityMenu
              levels={hlsSource.levels}
              level={hlsSource.level}
              onSelect={hlsSource.selectLevel}
              open={qualityMenuOpen}
              onOpenChange={(open) => { setQualityMenuOpen(open); if (open) showControls(); }}
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
