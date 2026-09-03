/**
 * One TeX analysis pass on unified-latex.
 *
 * Live macros in comments are not TODOs (`% \obtodo` is not live).
 * OpenBar TODOs are `\obtodo` only. No MCP, no React.
 */

import { findMacroMatches, parseAnchorAttrs, serializeAnchorAttrs } from "@/lib/marker-codec";
import { todoIsComplete, todoMetaFromAttrs, todoTitleFromAttrs } from "@/lib/todo-meta";
import { escapeTexText } from "@/lib/tex-project/tex-encode";
import {
  isMacro,
  mandatoryArgs,
  nodesToPlainText,
  optionalArg,
  parseTex,
  type TexMacro,
} from "@/lib/tex-project/tex-ast";

export type PaperAnchorKind = "comment" | "todo" | "source" | "raw" | "question";

export interface PaperHeading {
  command: string;
  title: string;
  line: number;
}

export interface PaperDirective {
  raw: string;
  line: number;
}

export interface PaperTodo {
  id: string | null;
  title?: string;
  text: string;
  line: number;
  start: number;
  end: number;
  section?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  attrs: Record<string, string>;
  macro: string;
}

export interface PaperCitation {
  command: string;
  keys: string[];
  line: number;
}

export interface PaperNote {
  kind: "comment" | "source" | "raw" | "question";
  /** Stable id from `[id=…]` when present. Generated on insert / first link. */
  id?: string;
  text: string;
  line: number;
  start: number;
  end: number;
  section?: string;
  attrs: Record<string, string>;
  macro: string;
}

/** Paper-local hole. Not a mindmap TODO. `kind` is free-form (`todo`, `plot`, `verify`, …). */
export interface PaperMarker {
  kind: string;
  text: string;
  line: number;
  start: number;
  end: number;
  section?: string;
}

export interface PaperDiagnostic {
  code: string;
  message: string;
  line?: number;
  todoId?: string;
}

export interface PaperAnalysis {
  outline: PaperHeading[];
  todos: PaperTodo[];
  citations: PaperCitation[];
  comments: PaperNote[];
  markers: PaperMarker[];
  diagnostics: PaperDiagnostic[];
  directives: PaperDirective[];
}

const NOTE_MACROS: Record<string, PaperNote["kind"]> = {
  obcomment: "comment",
  obsource: "source",
  obraw: "raw",
  obquestion: "question",
};

const HEADING_COMMANDS = ["section", "subsection", "subsubsection", "paragraph", "subparagraph", "title"];
const CITE_COMMANDS = ["cite", "citep", "citet", "obcite"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function lineOf(node: unknown): number {
  if (!isRecord(node)) return 1;
  const position = node.position;
  if (isRecord(position) && isRecord(position.start) && typeof position.start.line === "number") {
    return position.start.line;
  }
  return 1;
}

function offsetOf(node: unknown, which: "start" | "end"): number | undefined {
  if (!isRecord(node)) return undefined;
  const position = node.position;
  if (!isRecord(position) || !isRecord(position[which])) return undefined;
  const offset = position[which].offset;
  return typeof offset === "number" ? offset : undefined;
}

function nodesToSource(source: string, nodes: unknown): string {
  const list = Array.isArray(nodes) ? nodes : [nodes];
  let start: number | undefined;
  let end: number | undefined;
  for (const node of list) {
    const from = offsetOf(node, "start");
    const to = offsetOf(node, "end");
    if (from == null || to == null) continue;
    if (start == null || from < start) start = from;
    if (end == null || to > end) end = to;
  }
  if (start == null || end == null) return nodesToPlainText(nodes);
  return source.slice(start, end);
}

function childArrays(node: unknown): unknown[][] {
  const out: unknown[][] = [];
  if (!isRecord(node)) return out;
  if (
    Array.isArray(node.content) &&
    node.type !== "string" &&
    node.type !== "comment" &&
    node.type !== "verb" &&
    node.type !== "verbatim_environment"
  ) {
    out.push(node.content);
  }
  if (Array.isArray(node.args)) {
    for (const arg of node.args) {
      if (isRecord(arg) && Array.isArray(arg.content)) out.push(arg.content);
    }
  }
  return out;
}

function walkLive(node: unknown, visit: (node: unknown) => void): void {
  if (!isRecord(node) || node.type === "comment") return;
  visit(node);
  for (const children of childArrays(node)) {
    for (const child of children) walkLive(child, visit);
  }
}

function walkAll(node: unknown, visit: (node: unknown) => void): void {
  if (!isRecord(node)) return;
  visit(node);
  for (const children of childArrays(node)) {
    for (const child of children) walkAll(child, visit);
  }
}

function macroNameOf(node: TexMacro): string {
  return node.content.replace(/\*$/, "");
}

function parseOptionalAttrs(source: string, node: unknown): Record<string, string> {
  const opt = optionalArg(node);
  const raw = opt?.length ? nodesToSource(source, opt) || nodesToPlainText(opt) : "";
  return parseAnchorAttrs(raw);
}

function attachCommentMatches(source: string, comments: PaperNote[]): void {
  const matches = findMacroMatches(source, ["obcomment", "obsource", "obraw", "obquestion"]);
  let index = 0;
  for (const comment of comments) {
    while (index < matches.length && matches[index]!.name !== comment.macro) index += 1;
    const match = matches[index];
    if (!match) continue;
    index += 1;
    const attrs = parseAnchorAttrs(match.attrs.replace(/,(?=[A-Za-z])/g, ", "));
    comment.attrs = { ...comment.attrs, ...attrs };
    const id = attrs.id?.trim();
    if (id) comment.id = id;
    else delete comment.id;
    comment.start = match.index;
    comment.end = match.index + match.length;
  }
}

function asPaperTodo(
  attrs: Record<string, string>,
  text: string,
  line: number,
  macro: string,
  start = 0,
  end = 0,
): PaperTodo {
  const id = attrs.id?.trim() || null;
  const title = todoTitleFromAttrs(attrs);
  const meta = todoMetaFromAttrs(attrs);
  return {
    id,
    ...(title ? { title } : {}),
    text,
    line,
    start,
    end,
    section: attrs.section || undefined,
    ...meta,
    attrs,
    macro,
  };
}

function todoDiagnostics(todos: PaperTodo[]): PaperDiagnostic[] {
  const diagnostics: PaperDiagnostic[] = [];
  const seen = new Map<string, number>();
  for (const todo of todos) {
    if (!todo.id) {
      diagnostics.push({
        code: "missing-todo-id",
        message: "This \\obtodo needs a stable id. Assign IDs to join it with the mindmap.",
        line: todo.line,
      });
      continue;
    }
    const prior = seen.get(todo.id);
    if (prior != null) {
      diagnostics.push({
        code: "duplicate-todo-id",
        message: `TODO id "${todo.id}" appears more than once. Bindings are blocked until ids are unique.`,
        line: todo.line,
        todoId: todo.id,
      });
    } else {
      seen.set(todo.id, todo.line);
    }
  }
  return diagnostics;
}

export function analyzePaper(source: string): PaperAnalysis {
  const ast = parseTex(source);
  const liveMacros: TexMacro[] = [];
  walkLive(ast, (node) => {
    if (isMacro(node)) liveMacros.push(node);
  });

  const directives: PaperDirective[] = [];
  walkAll(ast, (node) => {
    if (!isRecord(node) || node.type !== "comment") return;
    const content = typeof node.content === "string" ? node.content : "";
    if (/^\s*OB(?::|\s+)/.test(content)) {
      directives.push({ raw: content.replace(/^\s*OB(?::|\s+)/, "").trim(), line: lineOf(node) });
    }
  });

  const todos: PaperTodo[] = [];
  const comments: PaperNote[] = [];
  const markers: PaperMarker[] = [];
  const seen = new Set<unknown>();
  let currentSection: string | undefined;
  for (const node of liveMacros) {
    if (seen.has(node)) continue;
    const name = macroNameOf(node);
    if (HEADING_COMMANDS.includes(name)) {
      currentSection = nodesToPlainText(mandatoryArgs(node)[0] ?? []).trim() || currentSection;
    }
    if (name === "obtodo") {
      seen.add(node);
      const attrs = parseOptionalAttrs(source, node);
      const text = nodesToSource(source, mandatoryArgs(node)[0] ?? []).trim();
      todos.push(asPaperTodo(attrs, text, lineOf(node), name, offsetOf(node, "start") ?? 0, offsetOf(node, "end") ?? 0));
      continue;
    }
    if (name === "obmarker") {
      seen.add(node);
      const args = mandatoryArgs(node);
      markers.push({
        kind: nodesToPlainText(args[0] ?? []).trim(),
        text: nodesToSource(source, args[1] ?? []).trim(),
        line: lineOf(node),
        start: offsetOf(node, "start") ?? 0,
        end: offsetOf(node, "end") ?? 0,
        section: currentSection,
      });
      continue;
    }
    const noteKind = NOTE_MACROS[name];
    if (!noteKind) continue;
    seen.add(node);
    const attrs = parseOptionalAttrs(source, node);
    const text = nodesToSource(source, mandatoryArgs(node)[0] ?? []).trim();
    const id = attrs.id?.trim() || undefined;
    comments.push({
      kind: noteKind,
      ...(id ? { id } : {}),
      text,
      line: lineOf(node),
      start: offsetOf(node, "start") ?? 0,
      end: offsetOf(node, "end") ?? 0,
      section: attrs.section || undefined,
      attrs,
      macro: name,
    });
  }

  attachCommentMatches(source, comments);

  const outline: PaperHeading[] = [];
  for (const node of liveMacros) {
    const command = macroNameOf(node);
    if (!HEADING_COMMANDS.includes(command)) continue;
    outline.push({
      command,
      title: nodesToPlainText(mandatoryArgs(node)[0] ?? []).trim(),
      line: lineOf(node),
    });
  }
  outline.sort((a, b) => a.line - b.line);

  const citations: PaperCitation[] = [];
  for (const node of liveMacros) {
    const command = macroNameOf(node);
    if (!CITE_COMMANDS.includes(command)) continue;
    const keys = nodesToPlainText(mandatoryArgs(node)[0] ?? [])
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    citations.push({ command, keys, line: lineOf(node) });
  }

  return {
    outline,
    todos,
    citations,
    comments,
    markers,
    diagnostics: todoDiagnostics(todos),
    directives,
  };
}

export function paperTodoIsOpen(todo: PaperTodo): boolean {
  return !todoIsComplete(todo.attrs) && !todo.completedAt;
}

export function generateCommentId(now = new Date()): string {
  const random = globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
  return `c${now.getTime().toString(36)}${random}`;
}

/** Comments created in OpenBar get an id immediately. `kind` is free-form. */
export function composeObcomment(spec: { text: string; kind?: string; id?: string; now?: Date }): string {
  const attrs: Record<string, string> = {
    id: spec.id?.trim() || generateCommentId(spec.now),
  };
  const kind = spec.kind?.trim();
  if (kind) attrs.kind = kind;
  return `\\obcomment[${serializeAnchorAttrs(attrs)}]{${escapeTexText(spec.text)}}`;
}

/**
 * Assign an id the first time a comment is linked. Existing ids are left alone.
 * `at` is any offset inside the `\\obcomment` span (or the span start).
 */
export function ensureCommentId(
  source: string,
  at: number,
  now = new Date(),
): { source: string; id: string } | undefined {
  const match = findMacroMatches(source, ["obcomment"]).find(
    (item) => at >= item.index && at <= item.index + item.length,
  );
  if (!match) return undefined;
  const attrs = parseAnchorAttrs(match.attrs);
  const existing = attrs.id?.trim();
  if (existing) return { source, id: existing };
  const id = generateCommentId(now);
  attrs.id = id;
  const next = `\\obcomment[${serializeAnchorAttrs(attrs)}]{${match.body}}`;
  return {
    source: `${source.slice(0, match.index)}${next}${source.slice(match.index + match.length)}`,
    id,
  };
}
