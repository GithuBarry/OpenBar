import { findMacroMatches, parseAnchorAttrs } from "@/lib/marker-codec";
import { analyzePaper, CURLY_MARKER } from "@/lib/research/paper-analysis";
import {
  patchObtodoInSource,
  parseTodoStatus,
  type TodoAttrPatch,
  type TodoPriority,
  type TodoStatus,
} from "@/lib/todo-meta";
import {
  composePaperTex,
  isPaperChromeLine,
  readTexDocumentTitle,
  sectionCommandForLevel,
  TEX_HEADING_LINE,
  texHeadingLevel,
  type PaperBodySection,
} from "@/lib/tex-project/paper-compose";

import { headingOccurrenceKey } from "./heading-keys";
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

export const TEX_TABLE_TPL = [
  "\\begin{tabular}{l|l|l|l}",
  "\\hline",
  "Condition & Metric 1 & Metric 2 & Notes \\\\",
  "\\hline",
  "Reference & 0.00 & \\obmarker{todo}{metric} & Add note \\\\",
  "Candidate & 0.00 & \\obmarker{todo}{metric} & Add note \\\\",
  "\\hline",
  "\\end{tabular}",
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

interface HeadingHit {
  index: number;
  level: number;
  title: string;
  command: string;
  appendix?: boolean;
}

function collectHeadings(lines: string[]): HeadingHit[] {
  let appendix = false;
  return lines.flatMap((line, index) => {
    if (/^\\appendix\b/.test(line.trim())) {
      appendix = true;
      return [];
    }
    const match = TEX_HEADING_LINE.exec(line);
    if (!match) return [];
    return [{
      index,
      command: match[1]!,
      level: texHeadingLevel(match[1]!),
      title: match[2]!.replace(/\s+\{#[^}]+\}\s*$/, "").trim().toLocaleLowerCase(),
      ...(appendix ? { appendix: true } : {}),
    }];
  });
}

/**
 * Parse only the declared section slots. Nested headings stay in the body
 * of their parent section. Matching by occurrence and id keeps duplicate
 * titles aligned without relying on a colliding slug.
 */
export function parseEditorSections(source: string, expected: PaperEditorSection[]): ParsedEditorSections {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const headings = collectHeadings(lines);
  const documentTitle = readTexDocumentTitle(source);
  if (!documentTitle) {
    return { sections: [], error: "Save blocked: the source needs a \\title{...} command." };
  }

  const sections: ParsedEditorSection[] = [];
  let cursor = 0;
  for (const original of expected) {
    const heading = headings.find((candidate) =>
      candidate.index >= cursor
      && candidate.command !== "title"
      && candidate.title === original.title.trim().toLocaleLowerCase(),
    );
    if (!heading) {
      return { sections: [], error: "Save blocked: section headings or order changed. Use a structural section action." };
    }
    const end = headings.find((candidate) => candidate.index > heading.index && candidate.level <= heading.level)?.index ?? lines.length;
    sections.push({
      id: original.id,
      title: original.title,
      level: heading.level,
      tex: lines.slice(heading.index + 1, end).filter((line) => !isPaperChromeLine(line)).join("\n").trim(),
      ...(heading.appendix ? { appendix: true } : {}),
    });
    cursor = end;
  }
  return { title: documentTitle, sections };
}

export function headingCountsFrom(source: string): Map<string, number> {
  const counts = new Map<string, number>();
  accumulateHeadingCounts(source, counts);
  return counts;
}

export function accumulateHeadingCounts(source: string, counts: Map<string, number>): void {
  for (const line of source.split("\n")) {
    const match = TEX_HEADING_LINE.exec(line);
    if (!match || match[1] === "title") continue;
    headingOccurrenceKey(texHeadingLevel(match[1]!), match[2]!.trim(), counts);
  }
}

export function listBookmarks(source: string): { title: string; slug: string; line: number; level: number }[] {
  const lines = source.split("\n");
  const list: { title: string; slug: string; line: number; level: number }[] = [];
  const headingCounts = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const match = TEX_HEADING_LINE.exec(lines[i] || "");
    if (!match || match[1] === "title") continue;
    const title = match[2]!.trim();
    const level = texHeadingLevel(match[1]!);
    list.push({ level, title, slug: headingOccurrenceKey(level, title, headingCounts), line: i });
  }
  return list;
}

export type EditorTodoKind = "obtodo" | "marker";

export interface EditorTodo {
  kind: EditorTodoKind;
  text: string;
  from: number;
  to: number;
  section: string;
  id?: string;
  priority?: TodoPriority;
  due?: string;
  owner?: string;
  createdAt?: string;
  status?: TodoStatus;
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
    if (todo.macro === "ob-directive") continue;
    const span = spanOfTodo(source, todo);
    todos.push({
      kind: todo.macro === "obmarker" ? "marker" : "obtodo",
      text: todo.text.trim(),
      from: span.from,
      to: span.to,
      section: todo.section || sectionAt(source, todo.start),
      id: todo.id,
      priority: todo.priority,
      due: todo.due,
      owner: todo.owner,
      createdAt: todo.createdAt,
      status: parseTodoStatus(todo.attrs.status),
    });
  }
  CURLY_MARKER.lastIndex = 0;
  let brace: RegExpExecArray | null;
  while ((brace = CURLY_MARKER.exec(source))) {
    const already = todos.some((todo) => todo.from === brace!.index);
    if (already) continue;
    todos.push({
      kind: "marker",
      text: (brace[3] || brace[2] || brace[1] || "").trim(),
      from: brace.index,
      to: brace.index + brace[0].length,
      section: sectionAt(source, brace.index),
      id: `brace-${brace.index}`,
    });
  }
  return todos.sort((a, b) => a.from - b.from);
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
  return spanOf(source, todo.macro === "obmarker" ? "obmarker" : "obtodo", todo.text);
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
  const replacement = todo.kind === "marker" ? todo.text : "";
  return `${source.slice(0, todo.from)}${replacement}${source.slice(todo.to)}`;
}

export function locatePreviewSnippet(source: string, snippet: string, hintFrom = 0): { from: number; to: number } | null {
  const exact = snippet.trim();
  if (exact.length < 2) return null;
  let from = source.indexOf(exact, Math.max(0, hintFrom));
  if (from < 0) from = source.indexOf(exact);
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
    const bookmark = listBookmarks(source).find((item) => item.slug === slug);
    return bookmark ? offsetForBookmarkLine(source, bookmark.line) : null;
  }
  const root = parts[0]!;
  const counts = new Map<string, number>();
  const visit = (part: ReturnType<typeof splitBundleSource>[number], seen: Set<string>): number | null => {
    if (seen.has(part.filePath)) return null;
    const nextSeen = new Set(seen).add(part.filePath);
    for (const slice of sliceRootByIncludes(part.body)) {
      if (slice.kind === "tex") {
        const lines = slice.text.split("\n");
        let local = 0;
        for (let i = 0; i < lines.length; i++) {
          const match = TEX_HEADING_LINE.exec(lines[i] || "");
          if (match && match[1] !== "title") {
            const key = headingOccurrenceKey(texHeadingLevel(match[1]!), match[2]!.trim(), counts);
            if (key === slug) return part.bodyFrom + slice.from + local;
          }
          local += (lines[i] || "").length + (i < lines.length - 1 ? 1 : 0);
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
