/**
 * Map-owned progress is a small presentation state, independent of TeX TODO
 * completion. Zero is ready to start. One through five fill a pie in sixths,
 * and six shows the completed checkmark.
 */
export type MindmapProgress = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const MINDMAP_PROGRESS_STATES: readonly MindmapProgress[] = [0, 1, 2, 3, 4, 5, 6];

/** Convert old 0–100 values at the persistence boundary. New values pass through. */
export function normalizeMindmapProgress(value: unknown): MindmapProgress | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (Number.isInteger(value) && value >= 0 && value <= 6) return value as MindmapProgress;
  if (value < 0 || value > 100) return undefined;
  return Math.round((value / 100) * 6) as MindmapProgress;
}

export function progressLabel(value: MindmapProgress | undefined): string {
  return value === undefined || value === 0 ? "No progress" : `${value} of 6`;
}
