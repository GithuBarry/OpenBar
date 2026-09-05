/**
 * Source-native TeX structure inspection.
 *
 * OpenBar envelopes provide stable write boundaries, but they are not the
 * manuscript's structural grammar. The outline and environment diagnostics
 * below come from TeX commands, with a small lexical recovery path for
 * malformed input that a full TeX AST cannot represent.
 */

import { macroName, mandatoryArgs, nodesToPlainText, parseTex } from "./tex-ast";
import { plainHeadingTitle, texHeadingLevel } from "./paper-compose";

const HEADING_COMMANDS = new Set(["section", "subsection", "subsubsection", "paragraph", "subparagraph"]);
const VERBATIM_ENVIRONMENTS = new Set(["verbatim", "Verbatim", "lstlisting", "minted", "alltt"]);

export type TexHeading = {
  command: string;
  title: string;
  level: number;
  line: number;
  start: number;
  label?: string;
  /** Full TeX heading ancestry, including this heading. */
  path?: string[];
};

export type TexHeadingRange = {
  from: number;
  to: number;
};

export type TexStructureDiagnostic = {
  severity: "error" | "warning";
  code: "unclosed_environment" | "mismatched_environment";
  message: string;
  line: number;
  environment: string;
};

function positionOf(value: unknown, key: "start" | "end"): { offset?: number; line?: number } {
  if (!value || typeof value !== "object") return {};
  const position = (value as { position?: { start?: unknown; end?: unknown } }).position;
  const point = position?.[key];
  if (!point || typeof point !== "object") return {};
  const offset = (point as { offset?: unknown }).offset;
  const line = (point as { line?: unknown }).line;
  return {
    ...(typeof offset === "number" ? { offset } : {}),
    ...(typeof line === "number" ? { line } : {}),
  };
}

function childArrays(value: unknown): unknown[][] {
  if (!value || typeof value !== "object") return [];
  const record = value as { content?: unknown; args?: unknown };
  const children: unknown[][] = [];
  if (Array.isArray(record.content)) children.push(record.content);
  if (Array.isArray(record.args)) {
    for (const arg of record.args) {
      if (arg && typeof arg === "object" && Array.isArray((arg as { content?: unknown }).content)) {
        children.push((arg as { content: unknown[] }).content);
      }
    }
  }
  return children;
}

function nearbyLabel(source: string, from: number): string | undefined {
  const tail = source.slice(from, Math.min(source.length, from + 500));
  const match = /\\label\s*\{([^{}\n]+)\}/.exec(tail);
  const label = match?.[1]?.trim();
  return label || undefined;
}

function validStableId(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value));
}

function fallbackHeadingId(filePath: string, index: number, title: string): string {
  const filePart = filePath.replace(/\.[^.\/]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "paper";
  const titlePart = title.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
  return `sec-${filePart}-${titlePart}-${index + 1}`;
}

function regexHeadings(source: string): TexHeading[] {
  const result: TexHeading[] = [];
  const pattern = /\\(section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\s*\[[^\]\n]*\])?\s*\{([^{}\n]*)\}/g;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    const line = source.slice(0, start).split("\n").length;
    const title = plainHeadingTitle(match[2] || "").trim();
    if (!title) continue;
    result.push({
      command: match[1] || "section",
      title,
      level: texHeadingLevel(match[1] || "section"),
      line,
      start,
      ...(validStableId(nearbyLabel(source, start)) ? { label: nearbyLabel(source, start) } : {}),
    });
  }
  return result;
}

/** Discover headings from the TeX AST, recovering with a narrow lexer if needed. */
export function discoverTexHeadings(source: string, filePath = "paper.tex"): TexHeading[] {
  const found: TexHeading[] = [];
  const seen = new Set<number>();
  const ast = parseTex(source);
  const visit = (nodes: unknown[]) => {
    for (const node of nodes) {
      const name = macroName(node);
      if (name && HEADING_COMMANDS.has(name)) {
        const args = mandatoryArgs(node);
        const title = plainHeadingTitle(nodesToPlainText(args[0] || [])).trim();
        const start = positionOf(node, "start").offset;
        if (title && typeof start === "number" && !seen.has(start)) {
          seen.add(start);
          const label = nearbyLabel(source, start);
          found.push({
            command: name,
            title,
            level: texHeadingLevel(name),
            line: positionOf(node, "start").line || source.slice(0, start).split("\n").length,
            start,
            ...(validStableId(label) ? { label } : {}),
          });
        }
      }
      for (const children of childArrays(node)) visit(children);
    }
  };
  const root = ast && typeof ast === "object" && Array.isArray((ast as { content?: unknown }).content)
    ? (ast as { content: unknown[] }).content
    : [];
  visit(root);
  const headings = found.length ? found : regexHeadings(source);
  const ordered = headings
    .sort((a, b) => a.start - b.start)
    .map((heading, index) => ({
      ...heading,
      label: heading.label || fallbackHeadingId(filePath, index, heading.title),
    }));
  return ordered.map((heading) => ({
    ...heading,
    path: headingPathAt(ordered, heading.start),
  }));
}

/** Return the smallest AST-discovered heading range containing an offset. */
export function texHeadingRange(source: string, headings: TexHeading[], index: number): TexHeadingRange {
  const heading = headings[index];
  if (!heading) return { from: 0, to: source.length };
  const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
  return { from: heading.start, to: next?.start ?? source.length };
}

/** Return the section/subsection ancestry at a source offset. */
export function headingPathAt(headings: TexHeading[], offset: number): string[] {
  const stack: Array<{ level: number; title: string }> = [];
  for (const heading of headings) {
    if (heading.start > offset) break;
    while (stack.at(-1) && stack.at(-1)!.level >= heading.level) stack.pop();
    stack.push({ level: heading.level, title: heading.title });
  }
  return stack.map((item) => item.title);
}

function withoutComments(source: string): string {
  let result = "";
  let escaped = false;
  let inComment = false;
  for (const char of source) {
    if (char === "\n") {
      result += char;
      escaped = false;
      inComment = false;
      continue;
    }
    if (inComment) {
      result += " ";
      continue;
    }
    if (char === "%" && !escaped) {
      result += " ";
      inComment = true;
      continue;
    }
    result += char;
    escaped = char === "\\" ? !escaped : false;
  }
  return result;
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

/** Find author-source environments that are visibly left open. */
export function inspectTexEnvironments(source: string): TexStructureDiagnostic[] {
  const code = withoutComments(source);
  const token = /\\(begin|end)\s*\{([^{}\n]+)\}/g;
  const stack: Array<{ name: string; offset: number }> = [];
  const diagnostics: TexStructureDiagnostic[] = [];
  let verbatim: string | undefined;
  for (const match of code.matchAll(token)) {
    const command = match[1];
    const name = (match[2] || "").trim();
    const offset = match.index ?? 0;
    if (verbatim) {
      if (command === "end" && name === verbatim) verbatim = undefined;
      continue;
    }
    if (command === "begin") {
      stack.push({ name, offset });
      if (VERBATIM_ENVIRONMENTS.has(name)) verbatim = name;
      continue;
    }
    const open = stack.at(-1);
    if (!open) {
      diagnostics.push({ severity: "error", code: "mismatched_environment", message: `Environment "${name}" has an end marker without a matching begin.`, line: lineAt(source, offset), environment: name });
      continue;
    }
    if (open.name !== name) {
      diagnostics.push({ severity: "error", code: "mismatched_environment", message: `Environment "${name}" closes "${open.name}".`, line: lineAt(source, offset), environment: name });
      continue;
    }
    stack.pop();
  }
  for (const open of stack) {
    diagnostics.push({ severity: "error", code: "unclosed_environment", message: `Environment "${open.name}" has no \\end{${open.name}} marker.`, line: lineAt(source, open.offset), environment: open.name });
  }
  return diagnostics;
}
