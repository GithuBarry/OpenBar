export const CAUTION_LEVELS = ["critical", "important", "minor", "background"] as const;

export type CautionLevel = (typeof CAUTION_LEVELS)[number];
export type MindmapCaution = Partial<Record<CautionLevel, string>>;

export const CAUTION_LEVEL_LABELS: Record<CautionLevel, string> = {
  critical: "Critical",
  important: "Important",
  minor: "Minor",
  background: "Background",
};

export function cautionValidationError(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "caution must be an object.";
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record).find(key => !(CAUTION_LEVELS as readonly string[]).includes(key));
  if (extra !== undefined) return `Unknown caution level "${extra}".`;
  for (const level of CAUTION_LEVELS) {
    if (record[level] !== undefined && typeof record[level] !== "string") return `caution.${level} must be a string.`;
  }
}

export function normalizeMindmapCaution(value: MindmapCaution | undefined, { trim = true }: { trim?: boolean } = {}): MindmapCaution | undefined {
  if (value === undefined) return undefined;
  const error = cautionValidationError(value);
  if (error) throw new TypeError(error);
  const normalized: MindmapCaution = {};
  for (const level of CAUTION_LEVELS) {
    const text = trim ? value[level]?.trim() : value[level];
    if (text) normalized[level] = text;
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

/** Migrate stored scalar scratchpads once, before records enter current state. */
export function migrateStoredCaution(value: unknown): MindmapCaution | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return normalizeMindmapCaution({ minor: value });
  return normalizeMindmapCaution(value as MindmapCaution);
}
