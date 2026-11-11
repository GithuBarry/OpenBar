/**
 * Shared TeX paper composition. The browser editor, WebMCP tools, and the file
 * store all read and write this one format:
 *
 *   \title{Project}
 *   \section{Abstract}
 *   <TeX body>
 *   \input{openbarry-references}
 *   \appendix
 *   \section{...}
 *
 * Section bodies retain their TeX source.
 */

import { findMacros, mandatoryArgs, nodesToPlainText, nodesToTex, parseTex } from "./tex-ast";
import { escapeTexText } from "./tex-encode";

export const PAPER_REFERENCES_FILE = "openbarry-references.tex";
export const PAPER_REFERENCES_INPUT = "\\input{openbarry-references}";

/**
 * Read the document-facing title from a TeX root without changing any source
 * bytes. Project metadata may use a shorter workspace name, so the root title
 * remains the editor's structural identity.
 */
export function readTexDocumentTitle(source: string): string | undefined {
  const title = findMacros(parseTex(source), "title")
    .map((node) => plainTexText(nodesToTex(mandatoryArgs(node)[0])))
    .find(Boolean);
  if (title) return title;

  // The parser already handles normal and nested TeX. This narrow recovery
  // path keeps a one-line title available while a source file is incomplete.
  const fallback = /^[ \t]*\\title(?:\[[^\r\n]*\])?\{(.*)\}[ \t]*(?:%.*)?$/m.exec(source)?.[1]?.trim();
  return fallback ? plainTexText(fallback) : undefined;
}

export function isPaperChromeLine(line: string): boolean {
  const t = line.trim();
  return /^\\appendix\b/.test(t)
    || /^\\input\s*\{(?:\.OpenBar\/references|openbarry\/references|openbarry-references)(?:\.tex)?\}(?:\s*%.*)?$/.test(t);
}

export function texHeadingLevel(command: string): number {
  const name = command.replace(/^\\/, "").replace(/\*$/, "");
  const levels: Record<string, number> = {
    title: 1,
    section: 2,
    subsection: 3,
    subsubsection: 4,
    paragraph: 5,
    subparagraph: 6,
  };
  return levels[name] ?? 2;
}

export function sectionCommandForLevel(level: number): string {
  return ["section", "section", "section", "subsection", "subsubsection", "paragraph", "subparagraph"][Math.min(Math.max(level, 1), 6)]!;
}

export function normalizeHeadingTitle(value: string): string {
  return plainHeadingTitle(value).toLocaleLowerCase();
}

export function plainHeadingTitle(value: string): string {
  return plainTexText(value.replace(/\s+\{#[^}]+\}\s*$/, ""));
}

export interface PaperBodySection {
  title: string;
  level: number;
  tex: string;
  appendix?: boolean;
  starred?: boolean;
}

export function composePaperTex(title: string, sections: PaperBodySection[]): string {
  const main: string[] = [`\\title{${escapeTexText(plainTexText(title))}}`];
  const appendix: string[] = [];
  let appendixOpen = false;
  for (const section of sections) {
    const star = section.starred ? "*" : "";
    const chunk = ["", `\\${sectionCommandForLevel(section.level)}${star}{${escapeTexText(plainTexText(section.title))}}`, "", section.tex.trim()];
    if (section.appendix) {
      if (!appendixOpen) {
        appendix.push("", "\\appendix");
        appendixOpen = true;
      }
      appendix.push(...chunk);
    } else {
      main.push(...chunk);
    }
  }
  return `${[...main, "", PAPER_REFERENCES_INPUT, ...appendix].join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function plainTexText(value: string): string {
  return nodesToPlainText(parseTex(value).content).replace(/\s+/g, " ").trim();
}
