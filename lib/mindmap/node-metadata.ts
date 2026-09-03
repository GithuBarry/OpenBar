export const MAX_MINDMAP_LABELS = 50;
export const MAX_MINDMAP_LABEL_CHARS = 80;

/** Normalize user-authored labels while preserving their first spelling and order. */
export function normalizeMindmapLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const label = item.trim();
    const key = label.toLocaleLowerCase();
    if (!label || label.length > MAX_MINDMAP_LABEL_CHARS || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= MAX_MINDMAP_LABELS) break;
  }
  return labels;
}

export const normalizeMindmapTags = normalizeMindmapLabels;
