/** Stable heading keys shared by the TeX editor decorations and the live preview. */

import { plainHeadingTitle, texHeadingLevel } from "@/lib/tex-project/paper-compose";
import type { PreviewMacroBinding } from "@/lib/tex-project/pandoc-macros";

export { texHeadingLevel };

/** Use project macro text in labels while keeping source-derived navigation keys. */
export function headingDisplayTitle(title: string, bindings: PreviewMacroBinding[]): string {
  const macros = new Map(bindings.map((binding) => [binding.name, binding]));
  const expanded = title.replace(/\\([A-Za-z]+)\b/g, (command, name: string) => {
    const binding = macros.get(name);
    return binding?.kind === "text" ? binding.text : binding?.kind === "identity" ? "" : command;
  });
  return plainHeadingTitle(expanded);
}

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
