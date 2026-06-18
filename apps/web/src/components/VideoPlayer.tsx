"use client";

import { Gauge, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiUrl, postJson } from "@/lib/api";

type VideoPlayerProps = {
  itemId: string;
  parts: { id: string; title: string; partIndex: number }[];
};

const speeds = [0.75, 1, 1.25, 1.5, 2, 3];

export function VideoPlayer({ itemId, parts }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [activePartIndex, setActivePartIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [holdingFast, setHoldingFast] = useState(false);
  const activePart = parts[activePartIndex];
  const progress = duration > 0 ? (current / duration) * 100 : 0;

  const source = useMemo(() => activePart ? apiUrl(`/media/parts/${activePart.id}/stream`) : "", [activePart]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.playbackRate = holdingFast ? 3 : speed;
  }, [speed, holdingFast]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const timer = window.setInterval(() => {
      if (!video.paused && video.currentTime > 0) {
        void postJson(`/items/${itemId}/interactions`, {
          kind: "watch",
          partId: activePart?.id,
          positionSeconds: video.currentTime
        });
      }
    }, 15000);

    return () => window.clearInterval(timer);
  }, [activePart?.id, itemId]);

  if (!activePart) {
    return <div className="grid aspect-video place-items-center rounded-lg bg-white/5 text-white/55">没有可播放分P</div>;
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }

  function seek(delta: number) {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + delta));
  }

  function markFinished() {
    void postJson(`/items/${itemId}/interactions`, {
      kind: "finish",
      partId: activePart.id,
      positionSeconds: duration
    });
    if (activePartIndex < parts.length - 1) {
      setActivePartIndex((value) => value + 1);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-white/8 bg-[#111217]">
      <div className="relative bg-black">
        <video
          ref={videoRef}
          src={source}
          className="aspect-video w-full bg-black object-contain"
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
          onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
          onEnded={markFinished}
        />
      </div>

      <div className="border-t border-white/8 bg-[#14151a] px-3 py-3">
        <input
          aria-label="播放进度"
          type="range"
          min={0}
          max={duration || 0}
          value={current}
          onChange={(event) => {
            const next = Number(event.target.value);
            setCurrent(next);
            if (videoRef.current) {
              videoRef.current.currentTime = next;
            }
          }}
          className="h-2 w-full accent-[var(--accent)]"
          style={{ background: `linear-gradient(90deg, var(--accent) ${progress}%, rgba(255,255,255,.14) ${progress}%)` }}
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="icon-button" onClick={() => seek(-5)} title="后退 5 秒">
            <SkipBack size={19} />
          </button>
          <button className="primary-icon-button" onClick={togglePlay} title={playing ? "暂停" : "播放"}>
            {playing ? <Pause size={21} /> : <Play size={21} />}
          </button>
          <button className="icon-button" onClick={() => seek(5)} title="前进 5 秒">
            <SkipForward size={19} />
          </button>
          <button
            className="icon-button"
            onPointerDown={() => setHoldingFast(true)}
            onPointerUp={() => setHoldingFast(false)}
            onPointerLeave={() => setHoldingFast(false)}
            title="按住 3x"
          >
            <Gauge size={19} />
          </button>
          <div className="ml-0 flex items-center gap-1 rounded-lg bg-white/6 p-1 md:ml-3">
            {speeds.map((item) => (
              <button
                key={item}
                className={`rounded-md px-2 py-1 text-xs ${speed === item ? "bg-white text-black" : "text-white/62 hover:text-white"}`}
                onClick={() => setSpeed(item)}
              >
                {item}x
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-white/50">
            <Volume2 size={16} />
            {formatTime(current)} / {formatTime(duration)}
          </div>
        </div>

        {parts.length > 1 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {parts.map((part, index) => (
              <button
                key={part.id}
                className={`shrink-0 rounded-lg px-3 py-2 text-sm ${index === activePartIndex ? "bg-white text-black" : "bg-white/6 text-white/72 hover:bg-white/10"}`}
                onClick={() => setActivePartIndex(index)}
              >
                P{part.partIndex} {part.title}
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-3 hidden gap-2 text-white/35 md:flex">
          <RotateCcw size={14} /> <span className="text-xs">长按速度按钮临时 3x，松开恢复当前倍速</span> <RotateCw size={14} />
        </div>
      </div>
    </section>
  );
}

function formatTime(value: number) {
  if (!Number.isFinite(value)) {
    return "00:00";
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
