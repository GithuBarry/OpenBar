export const CAUTION_LEVELS = ["critical", "important", "background"] as const;

export type CautionLevel = (typeof CAUTION_LEVELS)[number];
export type MindmapCaution = Partial<Record<CautionLevel, string>>;

export const CARD_NOTE_FIELDS = ["caption", "background", "critical", "important"] as const;
export type CardNoteField = (typeof CARD_NOTE_FIELDS)[number];

export function hasNoteText(value?: string): boolean {
  return Boolean(value && /[^\s\p{Default_Ignorable_Code_Point}]/u.test(value));
}

/** Project saved fields into Notes while keeping the stored source untouched. */
export function cardNotesText(caption?: string, caution?: MindmapCaution): string {
  const fields = [caption, caution?.background, caution?.critical, caution?.important]
    .filter((field): field is string => hasNoteText(field));
  if (fields.length < 2) return fields[0] ?? "";

  // Repeated text within an authored field can be meaningful, including code fences.
  const separator = /\r?\n(?:[\t ]*\r?\n)+/;
  const merged = [fields[0]!];
  const seen = new Set(fields[0]!.split(separator));
  for (const field of fields.slice(1)) {
    const paragraphs = field.split(separator);
    const additional = paragraphs.filter(paragraph => hasNoteText(paragraph) && !seen.has(paragraph));
    if (additional.length) merged.push(additional.length === paragraphs.length ? field : additional.join("\n\n"));
    for (const paragraph of additional) seen.add(paragraph);
  }
  return merged.join("\n\n");
}

/** Restore the active card's note fields while retaining its other live fields. */
export function restoreCardNotes(
  current: { caption?: string; caution?: MindmapCaution },
  baseline: { caption?: string; caution?: MindmapCaution },
  fields: ReadonlySet<CardNoteField>,
): { caption?: string; caution?: MindmapCaution } {
  const patch: { caption?: string; caution?: MindmapCaution } = {};
  if (fields.has("caption")) patch.caption = baseline.caption;
  const levels = CAUTION_LEVELS.filter(level => fields.has(level));
  if (levels.length) {
    patch.caution = { ...current.caution };
    for (const level of levels) patch.caution[level] = baseline.caution?.[level];
  }
  return patch;
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
