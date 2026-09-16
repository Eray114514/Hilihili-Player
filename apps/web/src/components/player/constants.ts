// 播放器倍速档位
export const SPEEDS: number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

// 长按画面时的快进倍速
export const HOLD_RATE = 3;

// 长按期间允许重新压回快进倍速的次数上限，避免与浏览器互相改写形成死循环
export const HOLD_RATE_REASSERT_LIMIT = 3;
