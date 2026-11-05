import { bundleSections, deriveSections, headingInvocation } from "@/lib/tex-project/section-ranges";
import { maskTexLiterals } from "@/lib/tex-project/tex-literals";
import { findMacroMatches, parseAnchorAttrs } from "@/lib/marker-codec";
import { analyzePaper } from "@/lib/research/paper-analysis";
import {
  patchObtodoInSource,
  todoIsComplete,
  todoTitleFromAttrs,
  type TodoAttrPatch,
} from "@/lib/todo-meta";
import {
  composePaperTex,
  isPaperChromeLine,
  normalizeHeadingTitle,
  readTexDocumentTitle,
  sectionCommandForLevel,
  texHeadingLevel,
  type PaperBodySection,
} from "@/lib/tex-project/paper-compose";

import { headingDisplayTitle, headingOccurrenceKey } from "./heading-keys";
import { extractPreviewMacroBindings } from "@/lib/tex-project/pandoc-macros";
import {
  lookupBundlePartFrom,
  sliceRootByIncludes,
  splitBundleSource,
} from "@/lib/tex-project/source-bundle-format";

export { sectionCommandForLevel };

export interface PaperEditorSection extends PaperBodySection {
  id: string;
  hash: string;
}

export const TEX_RESULT_GRID_TPL = [
  "\\begin{tabular}{l|ccc}",
  "\\hline",
  " & Condition A & Condition B & Condition C \\\\",
  "\\hline",
  "Setting A",
  "  & \\obmarker{todo}{result}",
  "  & \\obmarker{todo}{result}",
  "  & \\obmarker{todo}{result} \\\\",
  "Setting B",
  "  & \\obmarker{todo}{result}",
  "  & \\obmarker{todo}{result}",
  "  & \\obmarker{todo}{result} \\\\",
  "\\hline",
  "\\end{tabular}",
].join("\n");

export const TEX_BLANK_TABLE_TPL = [
  "\\begin{tabular}{l|ll}",
  "\\hline",
  " &  &  \\\\",
  "\\hline",
  " &  &  \\\\",
  "\\hline",
  "\\end{tabular}",
].join("\n");

/** Default table insert: an incomplete result matrix, not a finished-looking table. */
export const TEX_TABLE_TPL = TEX_RESULT_GRID_TPL;

export const TEX_PLANNED_FIGURE_TPL = [
  "\\begin{figure}",
  "\\centering",
  "\\obmarker{figure}{Describe the intended figure}",
  "\\caption{Describe what this figure will show.}",
  "\\end{figure}",
].join("\n");

export const TEX_PLANNED_PLOT_TPL = [
  "\\begin{figure}",
  "\\centering",
  "\\obmarker{plot}{Describe the intended plot}",
  "\\caption{Describe the axes and the comparison.}",
  "\\end{figure}",
].join("\n");

export function composeInitialTex(title: string, sections: PaperEditorSection[]): string {
  return composePaperTex(title, sections);
}

export interface ParsedEditorSection {
  id: string;
  title: string;
  level: number;
  tex: string;
  appendix?: boolean;
}

export interface ParsedEditorSections {
  title?: string;
  sections: ParsedEditorSection[];
  error?: string;
}

/** Recompute editor sections from the current LaTeX and file addresses. */
export function parseEditorSections(source: string, expected: PaperEditorSection[]): ParsedEditorSections {
  const sections = bundleSections(source);
  const derived = sections.length ? sections : deriveSections(source);
  return {
    title: readTexDocumentTitle(source) || undefined,
    sections: derived.map(section => ({
      id: section.id, title: section.title, level: section.level,
      tex: source.slice(section.bodyFrom, section.to),
      ...(section.appendix ? { appendix: true } : {}),
    })),
  };
}

export function headingCountsFrom(source: string): Map<string, number> {
  const counts = new Map<string, number>();
  accumulateHeadingCounts(source, counts);
  return counts;
}

/** Keep neighboring TeX commands outside a replacement's trailing comment. */
export function sectionReplacementBody(tex: string): string {
  return `\n${tex.replace(/^\n+|\n+$/g, "")}\n`;
}

/** Read balanced heading arguments while retaining same-line body text. */
function sourceHeadings(source: string): { command: string; title: string; line: number; from: number }[] {
  const visible = maskTexLiterals(source);
  const headings: { command: string; title: string; line: number; from: number }[] = [];
  let offset = 0;
  for (const [lineNumber, line] of visible.split("\n").entries()) {
    const match = /^[\t ]*\\(section|subsection|subsubsection|paragraph|subparagraph)\*?(?![A-Za-z])/.exec(line);
    if (match) {
      const from = offset + match[0].indexOf("\\");
      const invocation = headingInvocation(visible, from);
      if (invocation) headings.push({
        command: match[1]!, title: source.slice(invocation.titleFrom, invocation.titleTo), line: lineNumber, from,
      });
    }
    offset += line.length + 1;
  }
  return headings;
}

export function accumulateHeadingCounts(source: string, counts: Map<string, number>): void {
  for (const heading of sourceHeadings(source)) {
    headingOccurrenceKey(texHeadingLevel(heading.command), heading.title, counts);
  }
}

export function listBookmarks(source: string): { title: string; slug: string; line: number; level: number }[] {
  const list: { title: string; slug: string; line: number; level: number }[] = [];
  const headingCounts = new Map<string, number>();
  const macroBindings = extractPreviewMacroBindings(source);
  for (const heading of sourceHeadings(source)) {
    const title = headingDisplayTitle(heading.title, macroBindings);
    const level = texHeadingLevel(heading.command);
    list.push({ level, title, slug: headingOccurrenceKey(level, heading.title, headingCounts), line: heading.line });
  }
  return list;
}

export type EditorTodoKind = "obtodo";

export interface EditorTodo {
  kind: EditorTodoKind;
  title?: string;
  text: string;
  from: number;
  to: number;
  section: string;
  id?: string;
  createdAt?: string;
  completed: boolean;
}

export interface EditorComment {
  id?: string;
  kind?: string;
  text: string;
  from: number;
  to: number;
  section: string;
}

function sectionAt(source: string, index: number): string {
  const before = source.slice(0, index);
  const matches = [...before.matchAll(/^\\(?:section|subsection|subsubsection)\*?\{(.+)\}\s*$/gm)];
  const last = matches.at(-1);
  return last?.[1]?.trim() || "Preamble";
}

export function collectEditorTodos(source: string): EditorTodo[] {
  const analysis = analyzePaper(source);
  const todos: EditorTodo[] = [];
  for (const todo of analysis.todos) {
    const span = spanOfTodo(source, { ...todo, id: todo.id || undefined });
    const title = todoTitleFromAttrs(todo.attrs);
    todos.push({
      kind: "obtodo",
      ...(title ? { title } : {}),
      text: todo.text.trim(),
      from: span.from,
      to: span.to,
      section: todo.section || sectionAt(source, todo.start),
      id: todo.id || undefined,
      createdAt: todo.createdAt,
      completed: todoIsComplete(todo.attrs) || Boolean(todo.completedAt),
    });
  }
  return todos.sort((a, b) => a.from - b.from);
}

export function findEditorTodo(source: string, previous: EditorTodo): EditorTodo | undefined {
  const todos = collectEditorTodos(source);
  if (previous.id) return todos.find(todo => todo.id === previous.id);
  const matches = todos.filter(todo => !todo.id && todo.kind === previous.kind && todo.section === previous.section && todo.text === previous.text);
  return matches.find(todo => todo.from === previous.from && todo.to === previous.to) || (matches.length === 1 ? matches[0] : undefined);
}

export function collectEditorComments(source: string): EditorComment[] {
  return analyzePaper(source).comments
    .filter((note) => note.macro === "obcomment")
    .map((note) => ({
      id: note.id,
      kind: note.attrs.kind?.trim() || undefined,
      text: note.text,
      from: note.start,
      to: note.end,
      section: note.section || sectionAt(source, note.start),
    }))
    .sort((a, b) => a.from - b.from);
}

function spanOfTodo(source: string, todo: { id?: string; text: string; start: number; end: number; macro?: string }): { from: number; to: number } {
  if (todo.id) {
    for (const match of findMacroMatches(source, ["obtodo"])) {
      if (parseAnchorAttrs(match.attrs).id === todo.id) {
        return { from: match.index, to: match.index + match.length };
      }
    }
  }
  if (todo.end > todo.start) return { from: todo.start, to: todo.end };
  return spanOf(source, "obtodo", todo.text);
}

function spanOf(source: string, command: string, body: string): { from: number; to: number } {
  const needle = body.trim();
  for (const match of findMacroMatches(source, [command.replace(/^\\/, "")])) {
    if (match.body.trim() === needle) {
      return { from: match.index, to: match.index + match.length };
    }
  }
  const index = source.indexOf(needle);
  return { from: Math.max(0, index), to: index >= 0 ? index + needle.length : 0 };
}

export function resolveEditorTodo(source: string, todo: EditorTodo): string {
  return `${source.slice(0, todo.from)}${source.slice(todo.to)}`;
}

export function locatePreviewSnippet(
  source: string,
  snippet: string,
  hintFrom = 0,
  range?: { from: number; to: number },
): { from: number; to: number } | null {
  const exact = snippet.trim();
  if (exact.length < 2) return null;
  const lower = Math.max(0, range?.from ?? hintFrom);
  const upper = Math.min(source.length, range?.to ?? source.length);
  let from = source.indexOf(exact, lower);
  if (from >= 0 && from + exact.length > upper) from = -1;
  if (from < 0) from = source.indexOf(exact);
  if (from >= 0 && range && (from < range.from || from + exact.length > range.to)) return null;
  if (from < 0) return null;
  return { from, to: from + exact.length };
}

export function offsetForBookmarkLine(source: string, line: number): number {
  if (line <= 0) return 0;
  const lines = source.split("\n");
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i++) offset += lines[i]!.length + 1;
  return offset;
}

/** Concatenated-bundle offset of a heading key, walking files in paper.tex include order. */
export function offsetForHeadingKey(source: string, slug: string): number | null {
  const parts = splitBundleSource(source);
  if (!parts.length) {
    const counts = new Map<string, number>();
    for (const heading of sourceHeadings(source)) {
      if (headingOccurrenceKey(texHeadingLevel(heading.command), heading.title, counts) === slug) return heading.from;
    }
    return null;
  }
  const root = parts[0]!;
  const counts = new Map<string, number>();
  const visit = (part: ReturnType<typeof splitBundleSource>[number], seen: Set<string>): number | null => {
    if (seen.has(part.filePath)) return null;
    const nextSeen = new Set(seen).add(part.filePath);
    for (const slice of sliceRootByIncludes(part.body)) {
      if (slice.kind === "tex") {
        for (const heading of sourceHeadings(slice.text)) {
          const key = headingOccurrenceKey(texHeadingLevel(heading.command), heading.title, counts);
          if (key === slug) return part.bodyFrom + slice.from + heading.from;
        }
        continue;
      }
      const child = lookupBundlePartFrom(parts, slice.raw, part.filePath);
      if (child) {
        const hit = visit(child, nextSeen);
        if (hit !== null) return hit;
      }
    }
    return null;
  };
  const hit = visit(root, new Set());
  if (hit !== null) return hit;
  return null;
}

/** Jump target for a latexmk `file.tex:line` diagnostic in the live bundle. */
export function offsetForSourceFileLine(source: string, file: string, line: number): number | null {
  const needle = file.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = splitBundleSource(source);
  const part = parts.find((item) => (
    item.filePath === needle
    || item.filePath.endsWith(`/${needle}`)
    || needle.endsWith(item.filePath)
  ));
  const body = part?.body ?? (!parts.length ? source : undefined);
  if (body == null) return null;
  const local = offsetForBookmarkLine(body, Math.max(0, line - 1));
  return (part?.bodyFrom ?? 0) + local;
}

export function patchEditorTodoAttrs(source: string, todo: EditorTodo, patch: TodoAttrPatch): string {
  if (todo.kind !== "obtodo") return source;
  return patchObtodoInSource(source, todo.from, todo.to, patch);
}
