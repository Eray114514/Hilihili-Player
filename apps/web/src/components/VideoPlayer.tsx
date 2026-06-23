"use client";

import { Expand, Pause, PictureInPicture, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, postJson } from "@/lib/api";

type VideoPlayerProps = {
  itemId: string;
  part: { id: string; title: string } | undefined;
  resumePosition?: number;
  onEnded?: () => void;
};

const speeds = [0.75, 1, 1.25, 1.5, 2, 3];

export function VideoPlayer({ itemId, part, resumePosition = 0, onEnded }: VideoPlayerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const holdTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const holdingFastRef = useRef(false);
  const resumedPartRef = useRef<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [holdingFast, setHoldingFast] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [autoPlayBlocked, setAutoPlayBlocked] = useState(false);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2600);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().then(() => setAutoPlayBlocked(false)).catch(() => setAutoPlayBlocked(true));
    } else {
      video.pause();
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = holdingFast ? 3 : speed;
  }, [speed, holdingFast]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !part) return;
    setAutoPlayBlocked(false);
    setCurrent(0);
    setDuration(0);
    void video.play().catch(() => setAutoPlayBlocked(true));
  }, [part]);

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

  function seekTo(value: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = value;
    setCurrent(value);
  }

  function markFinished() {
    void postJson(`/items/${itemId}/interactions`, {
      kind: "finish",
      partId,
      positionSeconds: duration
    });
    onEnded?.();
  }

  return (
    <section
      ref={shellRef}
      tabIndex={0}
      className="group relative aspect-video overflow-hidden rounded-xl bg-black shadow-2xl shadow-black/30 outline-none ring-1 ring-white/10"
      onMouseMove={showControls}
      onFocus={showControls}
      onKeyDown={(event) => {
        if (event.code === "Space") { event.preventDefault(); togglePlay(); }
        if (event.key === "ArrowLeft") seekTo(Math.max(0, current - 5));
        if (event.key === "ArrowRight") seekTo(Math.min(duration, current + 5));
        if (event.key.toLowerCase() === "f") void shellRef.current?.requestFullscreen();
        if (event.key.toLowerCase() === "m" && videoRef.current) videoRef.current.muted = !videoRef.current.muted;
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
        onPointerUp={() => { if (!finishHold()) togglePlay(); }}
        onPointerCancel={finishHold}
        onPointerLeave={() => { if (holdingFastRef.current) finishHold(); }}
      >
        <video
          ref={videoRef}
          src={apiUrl(`/media/parts/${part.id}/stream`)}
          className="h-full w-full select-none object-contain"
          playsInline
          autoPlay
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            setDuration(video.duration || 0);
            if (resumedPartRef.current !== part.id && resumePosition > 0 && resumePosition < video.duration - 3) {
              video.currentTime = resumePosition;
              setCurrent(resumePosition);
              resumedPartRef.current = part.id;
            }
            void video.play().catch(() => setAutoPlayBlocked(true));
          }}
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
          onEnded={markFinished}
        />
      </div>

      {holdingFast ? <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm font-semibold">3× 快进中</div> : null}
      {autoPlayBlocked || !playing ? (
        <button className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/92 text-black shadow-xl transition hover:scale-105" onClick={togglePlay} aria-label="播放">
          <Play className="ml-1" size={28} fill="currentColor" />
        </button>
      ) : null}

      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/65 to-transparent px-3 pb-3 pt-14 transition-opacity duration-200 ${controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      >
        <input aria-label="播放进度" type="range" min={0} max={duration || 0} value={current} onChange={(event) => seekTo(Number(event.target.value))} className="player-range w-full" />
        <div className="mt-2 flex items-center gap-2">
          <button className="player-control" onClick={togglePlay} aria-label={playing ? "暂停" : "播放"}>{playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button>
          <span className="min-w-[96px] text-xs tabular-nums text-white/75">{formatTime(current)} / {formatTime(duration)}</span>
          <div className="group/volume flex items-center gap-2">
            <button className="player-control" onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }} aria-label="静音">{volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
            <input aria-label="音量" type="range" min={0} max={1} step={0.05} value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); if (videoRef.current) videoRef.current.volume = next; }} className="player-range hidden w-20 md:block" />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <select aria-label="播放速度" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} className="rounded-md bg-transparent px-2 py-1 text-sm font-medium outline-none hover:bg-white/10">
              {speeds.map((value) => <option key={value} value={value} className="bg-[#17191f]">{value}×</option>)}
            </select>
            <button className="player-control hidden sm:grid" onClick={() => { const video = videoRef.current; if (video && document.pictureInPictureEnabled) void video.requestPictureInPicture(); }} aria-label="画中画"><PictureInPicture size={19} /></button>
            <button className="player-control" onClick={() => void shellRef.current?.requestFullscreen()} aria-label="全屏"><Expand size={20} /></button>
          </div>
        </div>
      </div>
    </section>
  );
}

function formatTime(value: number) {
  if (!Number.isFinite(value)) return "00:00";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
