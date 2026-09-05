/**
 * Source-derived paper context. This is deliberately tolerant: a broken
 * OpenBar envelope is still a discoverable paper location with a repairable
 * diagnostic instead of disappearing from project state.
 */

import { parseSectionMeta, getEditBlock, sha256, type SectionMeta } from "@/lib/tex-project/codec";
import type { SourceBundle } from "@/lib/tex-project/source-bundle";
import { traverseInputGraph, type GraphNode, type SourceDiagnostic } from "@/lib/tex-project/source-graph";
import {
  discoverTexHeadings,
  headingPathAt,
  inspectTexEnvironments,
  texHeadingRange,
  type TexHeading,
} from "@/lib/tex-project/tex-structure";
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
  /** Stable managed envelope used for writes when this is a natural nested heading. */
  writeTargetId?: string;
  headingPath: string[];
  excerpt: string;
  parseStatus: "ok" | "error";
  diagnostic?: SourceDiagnostic;
  diagnostics: SourceDiagnostic[];
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
    if (!SECTION_META_LINE.test(node.source)) return { id };
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
  headings: TexHeading[],
  toVirtual?: (node: GraphNode, offset: number) => number,
): LocatedPaperTodo {
  const sectionId = section ? (section.writeTargetId || section.id) : undefined;
  const sectionTitle = section?.title;
  const path = headings.length ? headingPathAt(headings, todo.start) : (section?.headingPath || []);
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
  headings: TexHeading[],
  toVirtual?: (node: GraphNode, offset: number) => number,
): T & { file: string; sectionId?: string; sectionTitle?: string; headingPath: string[]; sourceHash: string; virtualStart?: number; virtualEnd?: number } {
  return {
    ...item,
    file: node.filePath,
    ...((section?.writeTargetId || section?.id) ? { sectionId: section.writeTargetId || section.id } : {}),
    ...(section?.title ? { sectionTitle: section.title } : {}),
    headingPath: headings.length ? headingPathAt(headings, item.start) : (section?.headingPath || []),
    sourceHash: node.hash,
    ...(toVirtual ? { virtualStart: toVirtual(node, item.start), virtualEnd: toVirtual(node, item.end) } : {}),
  };
}

function fallbackHeadingId(node: GraphNode, heading: TexHeading): string {
  return heading.label || `${node.filePath.replace(/[^A-Za-z0-9._-]+/g, "-")}:${heading.start}`;
}

/**
 * Build logical manuscript headings from the TeX AST. A file is only a source
 * location: one file may contain many headings, and a heading may be backed by
 * an OpenBar envelope or remain source-native/read-only.
 */
function makeSections(node: GraphNode): { sections: SourceContextSection[]; headings: TexHeading[] } {
  const parsed = sectionMeta(node);
  const headings = discoverTexHeadings(node.source, node.filePath);
  if (!parsed.meta && !parsed.id && !headings.length && node.kind !== "section") return { sections: [], headings };

  const managedId = parsed.meta?.id || parsed.id;
  const naturalOnly = !parsed.meta && !parsed.id;
  const primaryIndex = headings.length
    ? Math.max(0, headings.findIndex((heading) => (
      (managedId && (heading.label === managedId || heading.label === parsed.meta?.label))
      || (parsed.meta && heading.level === parsed.meta.level && heading.title.trim().toLowerCase() === parsed.meta.title.trim().toLowerCase())
    )))
    : -1;
  const envelope = managedId ? bodyRange(node.source, managedId) : undefined;
  const environmentDiagnostics = inspectTexEnvironments(node.source);
  const candidates = headings.length
    ? headings.map((heading, index) => ({ heading, index }))
    : [{ heading: undefined, index: -1 }];

  const sections = candidates.map(({ heading, index }) => {
    const primary = index < 0 || index === primaryIndex;
    const naturalRange = heading && index >= 0
      ? texHeadingRange(node.source, headings, index)
      : (envelope?.range || { from: 0, to: node.source.length });
    const range = primary && envelope && !heading ? envelope.range : naturalRange;
    const id = primary
      ? (managedId || heading?.label || node.filePath.replace(/[^A-Za-z0-9._-]+/g, "-") || "section")
      : fallbackHeadingId(node, heading!);
    const missingEnd = primary && envelope?.error?.includes(`OB-EDIT block "${id}" has no end marker.`) === true;
    const diagnostics: SourceDiagnostic[] = [];
    if (primary && parsed.diagnostic) diagnostics.push(parsed.diagnostic);
    if (primary && naturalOnly) {
      diagnostics.push({
        severity: "warning",
        code: "unmanaged_section",
        message: `Discovered ${heading?.command || "section"} "${heading?.title || id}" from the TeX AST. This source has no OpenBar edit envelope, so source-range writes must be explicit.`,
        filePath: node.filePath,
      });
    } else if (primary && envelope && !envelope.valid) {
      diagnostics.push({
        severity: "error",
        code: missingEnd ? "missing_edit_end" : "malformed_section",
        message: envelope.error || `Section "${id}" is missing a complete editable OpenBar envelope.`,
        filePath: node.filePath,
        ...(missingEnd ? { repair: { kind: "missing-edit-end" as const, sectionId: id, filePath: node.filePath } } : {}),
      });
    }
    if (primary) {
      for (const item of environmentDiagnostics) {
        diagnostics.push({
          severity: item.severity,
          code: item.code,
          message: `${item.message} (line ${item.line})`,
          filePath: node.filePath,
        });
      }
    }

    const fallback: SectionMeta = primary && parsed.meta
      ? parsed.meta
      : {
          id,
          title: heading?.title || parsed.meta?.title || id,
          level: (heading?.level || parsed.meta?.level || 2) as SectionMeta["level"],
          order: parsed.meta?.order ?? Number.MAX_SAFE_INTEGER,
          label: heading?.label || parsed.meta?.label || id,
          ...(parsed.meta?.appendix ? { appendix: true } : {}),
        };
    return {
      ...fallback,
      file: node.filePath,
      absPath: node.absPath,
      sourceHash: node.hash,
      sourceRange: range,
      editable: Boolean(primary && node.editable && parsed.meta && envelope?.valid),
      ...(parsed.meta?.id && !primary ? { writeTargetId: parsed.meta.id } : {}),
      headingPath: heading?.path || [],
      excerpt: excerpt(node.source, range),
      parseStatus: diagnostics.some((item) => item.severity === "error") ? "error" : "ok",
      ...(diagnostics[0] ? { diagnostic: diagnostics[0] } : {}),
      diagnostics,
      todos: [],
      comments: [],
      markers: [],
    } satisfies SourceContextSection;
  });
  return { sections, headings };
}

function ownerForOffset(sections: SourceContextSection[], offset: number): SourceContextSection | undefined {
  return sections
    .filter((section) => inRange(offset, section.sourceRange))
    .sort((left, right) => {
      const leftSize = left.sourceRange.to - left.sourceRange.from;
      const rightSize = right.sourceRange.to - right.sourceRange.from;
      return leftSize - rightSize || right.level - left.level;
    })[0];
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
    const discovered = makeSections(node);
    if (discovered.sections.length) {
      sections.push(...discovered.sections);
      diagnostics.push(...discovered.sections.flatMap((section) => section.diagnostics));
      for (const todo of analysis.todos) {
        const owner = ownerForOffset(discovered.sections, todo.start);
        const located = locateTodo(todo, node, owner, discovered.headings, toVirtual);
        allTodos.push(located);
        owner?.todos.push(located);
      }
      for (const comment of analysis.comments) {
        const owner = ownerForOffset(discovered.sections, comment.start);
        const located = locateNote(comment, node, owner, discovered.headings, toVirtual);
        allComments.push(located);
        owner?.comments.push(located);
      }
      for (const marker of analysis.markers) {
        const owner = ownerForOffset(discovered.sections, marker.start);
        const located = locateNote(marker, node, owner, discovered.headings, toVirtual);
        allMarkers.push(located);
        owner?.markers.push(located);
      }
      continue;
    }
    const headings = discoverTexHeadings(node.source, node.filePath);
    allTodos.push(...analysis.todos.map((todo) => locateTodo(todo, node, undefined, headings, toVirtual)));
    allComments.push(...analysis.comments.map((item) => locateNote(item, node, undefined, headings, toVirtual)));
    allMarkers.push(...analysis.markers.map((item) => locateNote(item, node, undefined, headings, toVirtual)));
    diagnostics.push(...analysis.diagnostics.map((item) => ({ ...item, severity: "error" as const, filePath: node.filePath })));
  }
  const graphOrder = new Map(graph.nodes.map((node, index) => [node.filePath, index]));
  sections.sort((left, right) => (
    (graphOrder.get(left.file) || 0) - (graphOrder.get(right.file) || 0)
    || left.sourceRange.from - right.sourceRange.from
    || left.level - right.level
    || left.id.localeCompare(right.id)
  ));
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
