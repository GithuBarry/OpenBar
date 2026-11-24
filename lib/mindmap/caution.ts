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
  return projectCardNotes(caption, caution).text;
}

export function projectCardNotes(caption?: string, caution?: MindmapCaution, anchor?: { field: string; offset: number }) {
  // Repeated text within an authored field can be meaningful, including code fences.
  const fields = { caption, ...caution };
  const seen = new Map<string, number>();
  let text = "";
  let workingMentionAt: number | undefined;
  for (const field of CARD_NOTE_FIELDS) {
    const source = fields[field];
    if (!source || !hasNoteText(source)) continue;
    const parts = source.split(/(\r?\n(?:[\t ]*\r?\n)+)/);
    const preserveSeparators = !text || parts.every((part, i) => i % 2 || (hasNoteText(part) && !seen.has(part)));
    const added = new Map<string, number>();
    if (text) text += preserveSeparators ? "\n\n" : "";
    const sourceStart = text.length;
    if (preserveSeparators) text += source;
    let sourceOffset = 0;
    for (let i = 0; i < parts.length; i += 2) {
      const paragraph = parts[i]!;
      let outputOffset = seen.get(paragraph);
      if (preserveSeparators) {
        outputOffset = sourceStart + sourceOffset;
        if (!added.has(paragraph)) added.set(paragraph, outputOffset);
      } else if (hasNoteText(paragraph) && outputOffset === undefined) {
        text += "\n\n";
        outputOffset = text.length;
        if (!added.has(paragraph)) added.set(paragraph, outputOffset);
        text += paragraph;
      }
      if (anchor?.field === field && outputOffset !== undefined && anchor.offset >= sourceOffset && anchor.offset < sourceOffset + paragraph.length) {
        workingMentionAt = outputOffset + anchor.offset - sourceOffset;
      }
      sourceOffset += paragraph.length + (parts[i + 1]?.length ?? 0);
    }
    for (const [paragraph, offset] of added) if (!seen.has(paragraph)) seen.set(paragraph, offset);
  }
  return { text, workingMentionAt };
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
