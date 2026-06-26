import type { Variants } from "motion/react";

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const DURATION_FAST = 0.15;
export const DURATION_BASE = 0.2;
export const DURATION_SLOW = 0.3;

// Fade in/out — for content swaps, route content
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION_BASE, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DURATION_FAST, ease: "easeIn" } },
};

// Scale in/out — for modals, popovers, menus
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: DURATION_BASE, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.96, transition: { duration: DURATION_FAST, ease: "easeIn" } },
};

// Slide down — for dropdowns opening downward (avatar menu, search history)
export const slideDown: Variants = {
  hidden: { opacity: 0, y: -6 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION_BASE, ease: EASE_OUT } },
  exit: { opacity: 0, y: -6, transition: { duration: DURATION_FAST, ease: "easeIn" } },
};

// Slide up — for list item entrance
export const slideUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION_BASE, ease: EASE_OUT } },
  exit: { opacity: 0, y: -8, transition: { duration: DURATION_FAST, ease: "easeIn" } },
};

// Pop — for reaction toggles (like/coin/favorite activation)
export const pop: Variants = {
  rest: { scale: 1 },
  pop: { scale: [1, 1.25, 1], transition: { duration: DURATION_SLOW, ease: EASE_OUT } },
};
