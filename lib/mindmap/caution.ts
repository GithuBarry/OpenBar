export const CAUTION_LEVELS = ["critical", "important", "background"] as const;

export type CautionLevel = (typeof CAUTION_LEVELS)[number];
export type MindmapCaution = Partial<Record<CautionLevel, string>>;

export const CAUTION_LEVEL_LABELS: Record<CautionLevel, string> = {
  critical: "Critical",
  important: "Important",
  background: "AI note",
};

export function hasNoteText(value?: string): boolean {
  return Boolean(value?.replace(/[\s\p{Default_Ignorable_Code_Point}]/gu, ""));
}

/** Present saved note fields together, preserving their original text. */
export function cardNotesText(caption?: string, background?: string): string {
  if (!caption) return background || "";
  if (!background) return caption;
  return `${caption}\n\n${background}`;
}

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

/** Convert retired note formats at the storage boundary, preserving their text. */
export function migrateStoredCardNotes<T extends { caption?: string; caution?: unknown }>(node: T): Omit<T, "caution"> & { caution?: MindmapCaution } {
  const { caution, ...rest } = node;
  if (caution === undefined) return rest;
  let folded: unknown;
  let current: MindmapCaution | undefined;
  if (typeof caution === "string") {
    folded = caution;
  } else if (caution && typeof caution === "object" && !Array.isArray(caution)) {
    const { minor, ...remaining } = caution as Record<string, unknown>;
    folded = minor;
    current = normalizeMindmapCaution(remaining as MindmapCaution, { trim: false });
  } else {
    throw new TypeError("caution must be an object.");
  }
  if (folded !== undefined && typeof folded !== "string") throw new TypeError("Legacy minor caution must be a string.");
  const caption = typeof folded === "string" && folded.length
    ? [rest.caption, folded].filter(value => value !== undefined && value !== "").join("\n\n")
    : rest.caption;
  return { ...rest, ...(caption !== undefined ? { caption } : {}), ...(current ? { caution: current } : {}) };
}
