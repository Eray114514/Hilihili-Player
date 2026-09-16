"use client";

import { AnimatePresence, motion } from "motion/react";
import { slideDown } from "@/lib/motion";
import type { HlsLevelChoice } from "./useHlsSource";

type QualityMenuProps = {
  levels: HlsLevelChoice[];
  /** -1 表示自动 */
  level: number;
  onSelect: (index: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * 画质菜单。
 *
 * 默认「自动锁最高档」而不是按屏幕尺寸降档——远端用户明确表示可以接受先缓冲一会，
 * 但不能接受被悄悄降画质。想省流量时手动选低档即可。
 */
export function QualityMenu({ levels, level, onSelect, open, onOpenChange }: QualityMenuProps) {
  if (levels.length === 0) return null;
  const current = levels.find((item) => item.index === level);
  const label = level === -1 ? "自动" : current?.label ?? "画质";

  return (
    <div className="relative">
      <button
        className="player-btn min-w-[2.75rem] px-2 text-sm font-medium"
        onClick={() => onOpenChange(!open)}
        aria-label="画质"
      >
        {label}
      </button>
      {open ? <div className="fixed inset-0 z-10" onClick={() => onOpenChange(false)} /> : null}
      <AnimatePresence>
        {open ? (
          <motion.div
            key="quality-menu"
            variants={slideDown}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="absolute bottom-full right-0 z-20 mb-1 overflow-hidden rounded-lg border border-white/10 bg-[#1a1c22] py-1 shadow-xl"
          >
            <button
              className={`flex w-32 items-center justify-between gap-2 px-3 py-1.5 text-sm transition ${level === -1 ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-white/70 hover:bg-white/8 hover:text-white"}`}
              onClick={() => { onSelect(-1); onOpenChange(false); }}
            >
              <span>自动</span>
            </button>
            {levels.map((item) => (
              <button
                key={item.index}
                className={`flex w-32 items-center justify-between gap-2 px-3 py-1.5 text-sm transition ${level === item.index ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-white/70 hover:bg-white/8 hover:text-white"}`}
                onClick={() => { onSelect(item.index); onOpenChange(false); }}
              >
                <span>{item.label}</span>
                <span className="font-mono text-[11px] text-white/38">{item.bitrateKbps}k</span>
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}