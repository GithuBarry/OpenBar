/** Stable heading keys shared by the TeX editor decorations and the live preview. */

import { texHeadingLevel } from "@/lib/tex-project/paper-compose";

export { texHeadingLevel };

export function slugifyHeading(title: string): string {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function headingOccurrenceKey(level: number, text: string, counts: Map<string, number>): string {
  const title = text
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\\(?:title|section|subsection|subsubsection|paragraph|subparagraph)\*?\{/, "")
    .replace(/\}\s*$/, "")
    .replace(/\s+\{#[^}]+\}\s*$/, "")
    .trim();
  const base = `${level}:${slugifyHeading(title)}`;
  const occurrence = counts.get(base) || 0;
  counts.set(base, occurrence + 1);
  return `${base}:${occurrence}`;
}

export function headingKeyForElement(element: HTMLElement, counts: Map<string, number>): string {
  const assignedKey = element.dataset.obHeadingKey;
  if (assignedKey) return assignedKey;
  const level = Number(element.tagName.slice(1));
  return headingOccurrenceKey(level, element.textContent || "", counts);
}
