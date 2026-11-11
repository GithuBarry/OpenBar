/** Keep the easing consistent across displays with different refresh rates. */
export function scrollFollowSmoothingMs(): number {
  return window.matchMedia("(max-width: 1023px), (pointer: coarse)").matches ? 85 : 120;
}

export function smoothScrollStep(current: number, target: number, elapsedMs: number, reducedMotion: boolean, smoothingMs = 85): number {
  if (reducedMotion || Math.abs(target - current) < 0.75) return target;
  const fraction = 1 - Math.exp(-Math.min(Math.max(elapsedMs, 0), 50) / smoothingMs);
  return current + (target - current) * fraction;
}

export type PdfScrollSync = {
  progress: number | null;
  follow: (() => void) | null;
};
