/**
 * Shared TeX paper composition. The browser editor, WebMCP tools, and the file
 * store all read and write this one format:
 *
 *   \title{Project}
 *   \section{Abstract}
 *   <TeX body>
 *   \input{openbarry/references}
 *   \appendix
 *   \section{...}
 *
 * Section bodies are TeX. Do not run markdownToTex on this document.
 */

import { findMacros, isMacro, macroName, mandatoryArgs, nodesToPlainText, nodesToTex, parseTex, type TexMacro } from "./tex-ast";
import { escapeTexText } from "./tex-encode";

const HEADING_COMMANDS = new Set([
  "title",
  "section",
  "subsection",
  "subsubsection",
  "paragraph",
  "subparagraph",
]);

/** Line matcher for consumers that still scan row-by-row. Capture 1 = command, 2 = title. */
export const TEX_HEADING_LINE =
  /^\\(title|section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\[[^\]]*\])?\{(.+)\}\s*$/;

export const PAPER_REFERENCES_INPUT = "\\input{openbarry/references}";

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
  return /^\\appendix\b/.test(t) || /^\\input\s*\{openbarry\/references(?:\.tex)?\}(?:\s*%.*)?$/.test(t);
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

export function looksLikeMarkdownPaper(source: string): boolean {
  const hasTexHeading = /^\\(title|section)\*?\{/m.test(source);
  const hasMdHeading = /^#{1,6}\s+\S/m.test(source);
  return hasMdHeading && !hasTexHeading;
}

export function splitPaperTex(source: string): PaperBodySection[] {
  const text = source.replace(/\r\n/g, "\n");
  return splitPaperTexFromAst(text) ?? splitPaperTexFromLines(text);
}

function splitPaperTexFromAst(text: string): PaperBodySection[] | null {
  const ast = parseTex(text);
  if (isFallbackParse(ast, text)) return null;

  const macros = collectStructuralMacros(ast);
  const headings: Array<{
    start: number;
    end: number;
    title: string;
    level: number;
    starred?: boolean;
    appendix?: boolean;
  }> = [];
  let appendix = false;
  for (const node of macros) {
    const name = macroName(node);
    if (name === "appendix") {
      appendix = true;
      continue;
    }
    if (!name || name === "title" || !HEADING_COMMANDS.has(name)) continue;
    const extent = headingExtent(text, node);
    if (!extent) continue;
    headings.push({
      ...extent,
      level: texHeadingLevel(name),
      ...(isStarredHeading(node) ? { starred: true } : {}),
      ...(appendix ? { appendix: true } : {}),
    });
  }

  if (headings.length === 0) {
    const lineHasSection = text.split("\n").some((line) => {
      const heading = TEX_HEADING_LINE.exec(line);
      return Boolean(heading && heading[1] !== "title");
    });
    return lineHasSection ? null : [];
  }

  return headings.map((heading, index) => {
    const until = headings[index + 1]?.start ?? text.length;
    const section: PaperBodySection = {
      title: heading.title,
      level: heading.level,
      tex: stripChrome(text.slice(heading.end, until)),
    };
    if (heading.starred) section.starred = true;
    if (heading.appendix) section.appendix = true;
    return section;
  });
}

function splitPaperTexFromLines(source: string): PaperBodySection[] {
  const lines = source.split("\n");
  const sections: Array<PaperBodySection & { body: string[] }> = [];
  let current: (PaperBodySection & { body: string[] }) | null = null;
  let appendix = false;
  for (const line of lines) {
    if (/^\\appendix\b/.test(line.trim())) {
      appendix = true;
      continue;
    }
    if (isPaperChromeLine(line)) continue;
    const heading = TEX_HEADING_LINE.exec(line);
    if (heading) {
      if (heading[1] === "title") continue;
      if (current) sections.push(current);
      const command = heading[1]!;
      current = {
        title: plainHeadingTitle(heading[2]!),
        level: texHeadingLevel(command),
        tex: "",
        body: [],
        ...(starredCommandLine(line, command) ? { starred: true } : {}),
        ...(appendix ? { appendix: true } : {}),
      };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) sections.push(current);
  return sections.map((section) => {
    const next: PaperBodySection = {
      title: section.title,
      level: section.level,
      tex: section.body.join("\n").trim(),
    };
    if (section.starred) next.starred = true;
    if (section.appendix) next.appendix = true;
    return next;
  });
}

function starredCommandLine(line: string, command: string): boolean {
  return new RegExp(String.raw`^\\${command}\*`).test(line.trim());
}

function stripChrome(tex: string): string {
  return tex.split("\n").filter((line) => !isPaperChromeLine(line)).join("\n").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFallbackParse(root: unknown, source: string): boolean {
  if (!isRecord(root) || root.type !== "root" || !Array.isArray(root.content)) return true;
  if (!source) return false;
  if (root.content.length !== 1) return false;
  const only = root.content[0];
  return isRecord(only) && only.type === "string" && only.content === source;
}

function collectStructuralMacros(root: unknown): TexMacro[] {
  const out: TexMacro[] = [];
  const walk = (node: unknown) => {
    if (!isRecord(node)) return;
    if (node.type === "comment" || node.type === "verb" || node.type === "verbatim_environment") return;
    if (isMacro(node)) {
      const name = macroName(node);
      if (name && (HEADING_COMMANDS.has(name) || name === "appendix")) out.push(node);
      return;
    }
    if (Array.isArray(node.content) && node.type !== "string") {
      for (const child of node.content) walk(child);
    }
  };
  walk(root);
  return out;
}

function isStarredHeading(node: TexMacro): boolean {
  if (String(node.content).endsWith("*")) return true;
  const args = Array.isArray(node.args) ? node.args : [];
  return args.some((arg) => {
    if (!isRecord(arg) || arg.openMark !== "") return false;
    const content = Array.isArray(arg.content) ? arg.content : [];
    return content.some((child) => isRecord(child) && child.type === "string" && child.content === "*");
  });
}

function headingExtent(source: string, node: TexMacro): { start: number; end: number; title: string } | undefined {
  const start = macroStartOffset(node);
  if (start == null || source[start] !== "\\") return undefined;
  let i = start + 1;
  while (i < source.length && /[A-Za-z]/.test(source[i]!)) i += 1;
  const skipSpace = () => {
    while (i < source.length && /\s/.test(source[i]!)) i += 1;
  };
  skipSpace();
  if (source[i] === "*") {
    i += 1;
    skipSpace();
  }
  if (source[i] === "[") {
    const close = source.indexOf("]", i);
    if (close < 0) return undefined;
    i = close + 1;
    skipSpace();
  }
  if (source[i] !== "{") return undefined;
  const end = matchDelimited(source, i);
  if (end == null) return undefined;
  const title = plainHeadingTitle(source.slice(i + 1, end - 1));
  return { start, end, title };
}

function plainTexText(value: string): string {
  return nodesToPlainText(parseTex(value).content).replace(/\s+/g, " ").trim();
}

function macroStartOffset(node: unknown): number | undefined {
  if (!isRecord(node) || !isRecord(node.position) || !isRecord(node.position.start)) return undefined;
  const offset = node.position.start.offset;
  return typeof offset === "number" ? offset : undefined;
}

function matchDelimited(source: string, openPos: number): number | null {
  if (source[openPos] !== "{") return null;
  let depth = 1;
  let pos = openPos + 1;
  while (pos < source.length && depth > 0) {
    if (source[pos] === "\\") {
      pos += 2;
      continue;
    }
    if (source[pos] === "{") depth += 1;
    else if (source[pos] === "}") depth -= 1;
    pos += 1;
  }
  return depth === 0 ? pos : null;
}
