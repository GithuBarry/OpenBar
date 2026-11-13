export const MIN_CARD_WIDTH = 180;
export const MAX_CARD_WIDTH = 1200;

/** Card width belongs to map presentation and uses canvas CSS pixels. */
export function normalizeCardWidth(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(MIN_CARD_WIDTH, Math.min(MAX_CARD_WIDTH, value)))
    : undefined;
}
