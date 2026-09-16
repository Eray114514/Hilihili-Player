"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import { apiUrl } from "@/lib/api";

const READY_POLL_MIN_MS = 5000;
const READY_POLL_MAX_MS = 30000;
const REQUEST_TIMEOUT_MS = 10000;

export type HlsLevelChoice = {
  /** hls.js 的 level 下标；-1 表示自动 */
  index: number;
  label: string;
  height: number;
  bitrateKbps: number;
};

export type HlsSourceState = {
  /** direct = 原画直连（HLS 未就绪或不可用时的兜底）；hls = 自适应切片流 */
  mode: "direct" | "hls";
  preparation: "unknown" | "preparing" | "ready" | "failed";
  progress: number;
  error: string | null;
  level: number;
  levels: HlsLevelChoice[];
  selectLevel: (index: number) => void;
};

type UseHlsSourceOptions = {
  partId: string;
  /** part 还没就绪时不要发请求（hook 必须无条件调用，所以用它来短路） */
  enabled?: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** HLS 下 loadedmetadata 可能早于真实时长就绪，用它同步一份可靠时长 */
  onDurationReady?: (durationSeconds: number) => void;
};

/**
 * 播放源决策：优先用 HLS 切片流，未就绪时先播原画直连。
 *
 * 为什么不是一开始就等 HLS：转码可能是分钟级的，让用户盯着转圈不可接受。
 * 所以策略是「先能看，再变好」——立刻用原画直连起播，后台轮询状态，
 * 切片就绪后平滑切到 HLS（保留当前播放位置）。
 *
 * 注意：这个 hook 完全接管 <video> 的 src。VideoPlayer 不能再用 src 属性设置地址，
 * 否则 React 与 hls.js 会争夺同一个媒体元素。
 */
export function useHlsSource({ partId, enabled = true, videoRef, onDurationReady }: UseHlsSourceOptions): HlsSourceState {
  const directUrl = apiUrl(`/media/parts/${partId}/stream`);
  const masterUrl = apiUrl(`/media/parts/${partId}/hls/master.m3u8`);
  const statusUrl = apiUrl(`/media/parts/${partId}/hls/status`);
  const prepareUrl = apiUrl(`/media/parts/${partId}/hls/prepare`);

  const [mode, setMode] = useState<"direct" | "hls">("direct");
  const [preparation, setPreparation] = useState<HlsSourceState["preparation"]>("unknown");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<HlsLevelChoice[]>([]);
  const [level, setLevel] = useState(-1);
  const hlsRef = useRef<Hls | null>(null);
  // 回调放进 ref：避免调用方传内联函数时把加载 effect 反复重启。
  // 在 effect 里同步（而不是渲染期赋值）以满足 react-hooks/refs。
  const durationReadyRef = useRef(onDurationReady);
  useEffect(() => {
    durationReadyRef.current = onDurationReady;
  }, [onDurationReady]);
  // 切到 HLS 时要恢复到当前位置
  const switchPositionRef = useRef(0);

  // 1) 问一次状态；未就绪则入队并退避轮询，就绪后切到 HLS
  useEffect(() => {
    if (!enabled || !partId) return;
    let cancelled = false;
    let timer: number | null = null;
    let delay = READY_POLL_MIN_MS;
    let prepareRequested = false;

    const poll = async () => {
      try {
        const response = await fetch(statusUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        if (cancelled) return;
        if (!response.ok) throw new Error(`status ${response.status}`);
        const data = (await response.json()) as { playable: boolean; status: string; progress: number; error: string | null };
        if (cancelled) return;
        if (data.playable) {
          setPreparation("ready");
          setProgress(1);
          setError(null);
          setMode("hls");
          return;
        }
        setPreparation(data.status === "failed" ? "failed" : "preparing");
        setProgress(data.progress ?? 0);
        setError(data.error ?? null);
        // 只请求一次入队；后续轮询只观察状态
        if (!prepareRequested) {
          prepareRequested = true;
          void fetch(prepareUrl, { method: "POST", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(() => {});
        }
        // 失败或长时间没进展时不要空转：退避到 30s 一次
        if (data.status === "failed") return;
        delay = Math.min(delay * 2, READY_POLL_MAX_MS);
        timer = window.setTimeout(() => void poll(), delay);
      } catch {
        if (cancelled) return;
        // 状态接口不可达（组网抖动）时不切 HLS，也不改判定：继续用直连，稍后重试
        setError("无法获取转码状态");
        timer = window.setTimeout(() => void poll(), READY_POLL_MAX_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled, partId, prepareUrl, statusUrl]);

  // 2) 落源：direct 直接给 video.src；hls 交给 hls.js（Safari 走原生 HLS）
  useEffect(() => {
    if (!enabled || !partId) return;
    const video = videoRef.current;
    if (!video) return;

    if (mode === "direct") {
      video.src = directUrl;
      video.load();
      return;
    }

    // Safari/iOS 原生支持 HLS，直接用 src，省掉 hls.js
    if (video.canPlayType("application/vnd.apple.mpegurl") !== "") {
      const resumeAt = video.currentTime;
      video.src = masterUrl;
      video.load();
      if (resumeAt > 0) {
        video.addEventListener("loadedmetadata", () => { video.currentTime = resumeAt; }, { once: true });
      }
      return;
    }

    let disposed = false;
    const attach = async () => {
      const mod = await import("hls.js");
      if (disposed) return;
      const HlsCtor = mod.default;
      if (!HlsCtor.isSupported()) {
        // 没有 MSE（很老的浏览器）：退回原画直连，而不是让播放器空着
        video.src = directUrl;
        setMode("direct");
        return;
      }
      const resumeAt = video.currentTime;
      const hls = new HlsCtor({
        // 画质优先：不因为播放器尺寸小就自动降到低分辨率档位
        capLevelToPlayerSize: false,
        // 大缓冲：链路慢时宁可多缓一会儿，也不要频繁降档/卡顿
        maxBufferLength: 90,
        maxMaxBufferLength: 180,
        // 高 RTT 链路上多给几次重试机会
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000
      });
      hlsRef.current = hls;
      hls.on(HlsCtor.Events.MANIFEST_PARSED, (_event, data) => {
        setLevels(data.levels.map((item, index) => ({
          index,
          label: item.height ? `${item.height}p` : `${Math.round((item.bitrate ?? 0) / 1000)}k`,
          height: item.height ?? 0,
          bitrateKbps: Math.round((item.bitrate ?? 0) / 1000)
        })));
      });
      // VOD 的完整时长在 LEVEL_LOADED 才可靠；续播靠这个时机
      hls.on(HlsCtor.Events.LEVEL_LOADED, (_event, data) => {
        if (data.details.totalduration > 0) {
          durationReadyRef.current?.(data.details.totalduration);
        }
      });
      hls.on(HlsCtor.Events.LEVEL_SWITCHED, (_event, data) => setLevel(data.level));
      hls.on(HlsCtor.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === HlsCtor.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
          return;
        }
        if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        // 彻底失败：卸掉 hls.js 回落原画直连，并如实告诉用户发生了降级
        setError("切片流播放失败，已降级为原画直连");
        hls.destroy();
        hlsRef.current = null;
        setMode("direct");
      });
      hls.loadSource(masterUrl);
      hls.attachMedia(video);
      switchPositionRef.current = resumeAt;
    };
    void attach();

    return () => {
      disposed = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [directUrl, enabled, masterUrl, mode, partId, videoRef]);

  // 切到 HLS 后恢复播放位置（attachMedia 会让媒体元素回到 0）
  useEffect(() => {
    const video = videoRef.current;
    if (mode !== "hls" || !video) return;
    const resumeAt = switchPositionRef.current;
    if (resumeAt <= 0) return;
    const apply = () => {
      if (video.currentTime < resumeAt - 1) {
        video.currentTime = resumeAt;
      }
    };
    video.addEventListener("loadedmetadata", apply, { once: true });
    return () => video.removeEventListener("loadedmetadata", apply);
  }, [mode, videoRef]);

  const selectLevel = useCallback((index: number) => {
    const hls = hlsRef.current;
    setLevel(index);
    if (hls) {
      hls.currentLevel = index;
    } else if (index === -1) {
      // 原生 HLS 没有档位控制，清掉选择即可
      setLevel(-1);
    }
  }, []);

  return { mode, preparation, progress, error, level, levels, selectLevel };
}