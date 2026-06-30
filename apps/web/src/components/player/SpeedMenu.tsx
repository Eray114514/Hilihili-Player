"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { slideDown } from "@/lib/motion";
import { SPEEDS } from "./constants";

type SpeedMenuProps = {
  speed: number;
  onSpeedChange: (value: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // 按钮由父组件持有 ref（与原实现一致），子组件在此 ref 上挂滚轮监听
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  // 滚轮方向：1 为减速、-1 为加速，与原 cycleSpeed 入参一致
  onWheelChange: (direction: number) => void;
};

// 倍速菜单：按钮 + 下拉列表 + 滚轮快速切换档位
export function SpeedMenu({ speed, onSpeedChange, open, onOpenChange, buttonRef, onWheelChange }: SpeedMenuProps) {
  useEffect(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      onWheelChange(event.deltaY > 0 ? 1 : -1);
    };
    btn.addEventListener("wheel", onWheel, { passive: false });
    return () => btn.removeEventListener("wheel", onWheel);
  }, [buttonRef, onWheelChange]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        className="player-btn min-w-[2.75rem] px-2 text-sm font-medium"
        onClick={() => onOpenChange(!open)}
        aria-label="播放速度"
      >
        {speed}×
      </button>
      {open ? <div className="fixed inset-0 z-10" onClick={() => onOpenChange(false)} /> : null}
      <AnimatePresence>
        {open ? (
          <motion.div
            key="speed-menu"
            variants={slideDown}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute bottom-full right-0 z-20 mb-1 overflow-hidden rounded-lg border border-white/10 bg-[#1a1c22] py-1 shadow-xl"
          >
            {SPEEDS.map((value) => (
              <button
                key={value}
                className={`flex w-20 items-center justify-center px-3 py-1.5 text-sm transition ${value === speed ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-white/70 hover:bg-white/8 hover:text-white"}`}
                onClick={() => { onSpeedChange(value); onOpenChange(false); }}
              >
                {value}×
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
