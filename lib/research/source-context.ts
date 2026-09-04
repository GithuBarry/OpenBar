/**
 * Source-derived paper context. This is deliberately tolerant: a broken
 * OpenBar envelope is still a discoverable paper location with a repairable
 * diagnostic instead of disappearing from project state.
 */

import { parseSectionMeta, getEditBlock, sha256, type SectionMeta } from "@/lib/tex-project/codec";
import type { SourceBundle } from "@/lib/tex-project/source-bundle";
import { traverseInputGraph, type GraphNode, type SourceDiagnostic } from "@/lib/tex-project/source-graph";
import { plainHeadingTitle, texHeadingLevel } from "@/lib/tex-project/paper-compose";
import { analyzePaper, type PaperAnalysis, type PaperMarker, type PaperNote, type PaperTodo } from "./paper-analysis";

export type SourceRange = { from: number; to: number };

export type LocatedPaperTodo = PaperTodo & {
  file: string;
  sectionId?: string;
  sectionTitle?: string;
  headingPath: string[];
  sourceHash: string;
  excerpt: string;
  /** Offset in the composed source bundle used by paper actions. */
  virtualStart?: number;
  virtualEnd?: number;
};

export type LocatedPaperNote = PaperNote & {
  file: string;
  sectionId?: string;
  sectionTitle?: string;
  headingPath: string[];
  sourceHash: string;
  virtualStart?: number;
  virtualEnd?: number;
};

export type LocatedPaperMarker = PaperMarker & {
  file: string;
  sectionId?: string;
  sectionTitle?: string;
  headingPath: string[];
  sourceHash: string;
  virtualStart?: number;
  virtualEnd?: number;
};

export type SourceContextSection = SectionMeta & {
  file: string;
  absPath: string;
  sourceHash: string;
  sourceRange: SourceRange;
  editable: boolean;
  headingPath: string[];
  excerpt: string;
  parseStatus: "ok" | "error";
  diagnostic?: SourceDiagnostic;
  todos: LocatedPaperTodo[];
  comments: LocatedPaperNote[];
  markers: LocatedPaperMarker[];
};

export type SourceContextFile = {
  file: string;
  absPath: string;
  sourceHash: string;
  sourceRange: SourceRange;
  editable: boolean;
  kind: GraphNode["kind"];
};

export type SourceContextIndex = {
  rootFile: string;
  sourceHash: string;
  sections: SourceContextSection[];
  files: SourceContextFile[];
  todos: LocatedPaperTodo[];
  comments: LocatedPaperNote[];
  markers: LocatedPaperMarker[];
  diagnostics: SourceDiagnostic[];
};

const SECTION_META_LINE = /^%\s*OB-SECTION\s+(\{.*\})\s*$/m;
const EDIT_BEGIN_LINE = /^%\s*OB-EDIT-BEGIN\s+([^\s]+)\s+id=([^\s]+)\s*$/gm;
const HEADING_RE = /\\(title|section|subsection|subsubsection|paragraph|subparagraph)\*?(?:\[[^\]\n]*\])?\{([^{}\n]*)\}/g;

function lineEnd(source: string, from: number): number {
  const end = source.indexOf("\n", from);
  return end < 0 ? source.length : end + 1;
}

function excerpt(source: string, range: SourceRange): string {
  return source.slice(range.from, range.to).replace(/\s+/g, " ").trim().slice(0, 320);
}

function rawSectionId(source: string): string | undefined {
  const match = source.match(SECTION_META_LINE)?.[1];
  if (!match) return undefined;
  try {
    const value = JSON.parse(match) as { id?: unknown };
    return typeof value.id === "string" && value.id.trim() ? value.id.trim() : undefined;
  } catch {
    return /"id"\s*:\s*"([^"\\]+)"/.exec(match)?.[1]?.trim() || undefined;
  }
}

function sectionMeta(node: GraphNode): { meta?: SectionMeta; id?: string; diagnostic?: SourceDiagnostic } {
  const id = rawSectionId(node.source);
  try {
    return { meta: parseSectionMeta(node.source), id };
  } catch (error) {
    return {
      id,
      diagnostic: {
        severity: "error",
        code: "malformed_section",
        message: error instanceof Error ? error.message : String(error),
        filePath: node.filePath,
      },
    };
  }
}

function headingPath(source: string, baseLevel: number, start: number, end: number): string[] {
  const stack: Array<{ level: number; title: string }> = [];
  for (const match of source.matchAll(HEADING_RE)) {
    const at = match.index ?? 0;
    if (at < start || at > end) continue;
    const command = match[1] || "section";
    const level = texHeadingLevel(command);
    const title = plainHeadingTitle(match[2] || "").trim();
    if (!title || level <= baseLevel) continue;
    while (stack.at(-1) && stack.at(-1)!.level >= level) stack.pop();
    stack.push({ level, title });
  }
  return stack.map((item) => item.title);
}

function bodyRange(source: string, id: string | undefined): { range: SourceRange; valid: boolean; error?: string } {
  if (!id) return { range: { from: 0, to: source.length }, valid: false };
  try {
    const block = getEditBlock(source, id);
    if (block) return { range: { from: block.bodyStart, to: block.bodyEnd }, valid: true };
  } catch (error) {
    // The fallback below preserves the section and lets the caller report the
    // exact envelope failure instead of dropping the file.
    const begin = [...source.matchAll(EDIT_BEGIN_LINE)].find((match) => match[2] === id);
    return {
      range: begin ? { from: lineEnd(source, begin.index ?? 0), to: source.length } : { from: 0, to: source.length },
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const begin = [...source.matchAll(EDIT_BEGIN_LINE)].find((match) => match[2] === id);
  return {
    range: begin ? { from: lineEnd(source, begin.index ?? 0), to: source.length } : { from: 0, to: source.length },
    valid: false,
  };
}

function safeAnalysis(source: string): PaperAnalysis {
  try {
    return analyzePaper(source);
  } catch (error) {
    return {
      outline: [],
      todos: [],
      citations: [],
      comments: [],
      markers: [],
      directives: [],
      diagnostics: [{ code: "tex_parse_failed", message: error instanceof Error ? error.message : String(error) }],
    };
  }
}

function inRange(start: number, range: SourceRange): boolean {
  return start >= range.from && start < Math.max(range.from + 1, range.to);
}

function locateTodo(
  todo: PaperTodo,
  node: GraphNode,
  section: SourceContextSection | undefined,
  range: SourceRange,
  toVirtual?: (node: GraphNode, offset: number) => number,
): LocatedPaperTodo {
  const sectionId = section?.id;
  const sectionTitle = section?.title;
  const path = headingPath(node.source, section?.level ?? 1, range.from, todo.end || range.to);
  return {
    ...todo,
    file: node.filePath,
    ...(sectionId ? { sectionId } : {}),
    ...(sectionTitle ? { sectionTitle } : {}),
    headingPath: path,
    sourceHash: node.hash,
    excerpt: excerpt(node.source, { from: todo.start, to: Math.min(node.source.length, todo.end + 220) }),
    ...(toVirtual ? { virtualStart: toVirtual(node, todo.start), virtualEnd: toVirtual(node, todo.end) } : {}),
  };
}

function locateNote<T extends PaperNote | PaperMarker>(
  item: T,
  node: GraphNode,
  section: SourceContextSection | undefined,
  range: SourceRange,
  toVirtual?: (node: GraphNode, offset: number) => number,
): T & { file: string; sectionId?: string; sectionTitle?: string; headingPath: string[]; sourceHash: string; virtualStart?: number; virtualEnd?: number } {
  return {
    ...item,
    file: node.filePath,
    ...(section?.id ? { sectionId: section.id } : {}),
    ...(section?.title ? { sectionTitle: section.title } : {}),
    headingPath: headingPath(node.source, section?.level ?? 1, range.from, item.end || range.to),
    sourceHash: node.hash,
    ...(toVirtual ? { virtualStart: toVirtual(node, item.start), virtualEnd: toVirtual(node, item.end) } : {}),
  };
}

function makeSection(node: GraphNode, analysis: PaperAnalysis, toVirtual?: (node: GraphNode, offset: number) => number): SourceContextSection | null {
  const parsed = sectionMeta(node);
  if (!parsed.meta && !parsed.id && node.kind !== "section") return null;
  const id = parsed.meta?.id || parsed.id || node.filePath.replace(/[^A-Za-z0-9._-]+/g, "-") || "section";
  const range = bodyRange(node.source, id);
  const diagnostic = parsed.diagnostic || (!range.valid
    ? {
        severity: "error" as const,
        code: "malformed_section",
        message: range.error || `Section "${id}" is missing a complete editable OpenBar envelope.`,
        filePath: node.filePath,
      }
    : undefined);
  const fallback: SectionMeta = parsed.meta || {
    id,
    title: id,
    level: 2,
    order: Number.MAX_SAFE_INTEGER,
    label: id,
  };
  const section: SourceContextSection = {
    ...fallback,
    file: node.filePath,
    absPath: node.absPath,
    sourceHash: node.hash,
    sourceRange: { from: 0, to: node.source.length },
    editable: node.editable,
    headingPath: headingPath(node.source, fallback.level, range.range.from, node.source.length),
    excerpt: excerpt(node.source, range.range),
    parseStatus: diagnostic ? "error" : "ok",
    ...(diagnostic ? { diagnostic } : {}),
    todos: [],
    comments: [],
    markers: [],
  };
  section.todos = analysis.todos.filter((todo) => inRange(todo.start, range.range)).map((todo) => locateTodo(todo, node, section, range.range, toVirtual));
  section.comments = analysis.comments.filter((item) => inRange(item.start, range.range)).map((item) => locateNote(item, node, section, range.range, toVirtual));
  section.markers = analysis.markers.filter((item) => inRange(item.start, range.range)).map((item) => locateNote(item, node, section, range.range, toVirtual));
  return section;
}

export function buildSourceContextIndex(manuscriptDir: string, rootFile?: string, bundle?: SourceBundle): SourceContextIndex {
  const graph = traverseInputGraph(manuscriptDir, rootFile);
  const firstSegmentByFile = new Map<string, SourceBundle["segments"][number]>();
  for (const segment of bundle?.segments || []) {
    if (!firstSegmentByFile.has(segment.filePath)) firstSegmentByFile.set(segment.filePath, segment);
  }
  const toVirtual = (node: GraphNode, offset: number): number => {
    const segment = firstSegmentByFile.get(node.filePath);
    return segment ? segment.virtualFrom + segment.fileFrom + Math.max(0, Math.min(offset, node.source.length)) : offset;
  };
  const sections: SourceContextSection[] = [];
  const files = graph.nodes.map((node) => ({
    file: node.filePath,
    absPath: node.absPath,
    sourceHash: node.hash,
    sourceRange: { from: 0, to: node.source.length },
    editable: node.editable,
    kind: node.kind,
  }));
  const allTodos: LocatedPaperTodo[] = [];
  const allComments: LocatedPaperNote[] = [];
  const allMarkers: LocatedPaperMarker[] = [];
  const diagnostics = [...graph.diagnostics];
  for (const node of graph.nodes) {
    if (!node.editable && node.kind !== "section") continue;
    const analysis = safeAnalysis(node.source);
    const section = makeSection(node, analysis, toVirtual);
    if (section) {
      sections.push(section);
      if (section.diagnostic) diagnostics.push(section.diagnostic);
      allTodos.push(...section.todos);
      allComments.push(...section.comments);
      allMarkers.push(...section.markers);
      continue;
    }
    allTodos.push(...analysis.todos.map((todo) => locateTodo(todo, node, undefined, { from: 0, to: node.source.length }, toVirtual)));
    allComments.push(...analysis.comments.map((item) => locateNote(item, node, undefined, { from: 0, to: node.source.length }, toVirtual)));
    allMarkers.push(...analysis.markers.map((item) => locateNote(item, node, undefined, { from: 0, to: node.source.length }, toVirtual)));
    diagnostics.push(...analysis.diagnostics.map((item) => ({ ...item, severity: "error" as const, filePath: node.filePath })));
  }
  sections.sort((left, right) => left.order - right.order || left.file.localeCompare(right.file) || left.id.localeCompare(right.id));
  const sourceHash = sha256(JSON.stringify(graph.nodes.map((node) => ({ file: node.filePath, hash: node.hash }))));
  return {
    rootFile: graph.rootFile,
    sourceHash,
    sections,
    files,
    todos: allTodos,
    comments: allComments,
    markers: allMarkers,
    diagnostics,
  };
}
