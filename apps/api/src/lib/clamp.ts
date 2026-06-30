import { LIMIT_CAP, LIMIT_MIN } from "./constants.js";

export function clampLimit(raw: number, fallback: number, min = LIMIT_MIN, max = LIMIT_CAP) {
  return Number.isFinite(raw) ? Math.min(Math.max(raw, min), max) : fallback;
}
