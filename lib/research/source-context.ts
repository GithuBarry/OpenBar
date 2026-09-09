/** Paper locations and ownership derived from the current LaTeX include graph. */

import { sha256, type SectionMeta } from "@/lib/tex-project/codec";
import { deriveSections } from "@/lib/tex-project/section-ranges";
import type { SourceBundle } from "@/lib/tex-project/source-bundle";
import { orderedSourceRanges, traverseInputGraph, type GraphNode, type SourceDiagnostic } from "@/lib/tex-project/source-graph";
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
  /** Optional enclosing write target. */
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

function excerpt(source: string, range: SourceRange): string {
  return source.slice(range.from, range.to).replace(/\s+/g, " ").trim().slice(0, 320);
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

function makeSections(node: GraphNode): { sections: SourceContextSection[]; headings: TexHeading[] } {
  const derived = deriveSections(node.source, node.filePath);
  const headings = derived.map(section => section.heading);
  const diagnostics: SourceDiagnostic[] = inspectTexEnvironments(node.source).map(item => ({
    severity: item.severity, code: item.code, message: `${item.message} (line ${item.line})`, filePath: node.filePath,
  }));
  const sections = derived.map(({ heading, from, bodyFrom, to, ...section }) => ({
    ...section,
    ...(node.appendix ? { appendix: true } : {}),
    file: node.filePath,
    absPath: node.absPath,
    sourceHash: node.hash,
    sourceRange: { from, to },
    editable: node.editable,
    headingPath: heading.path || [],
    excerpt: excerpt(node.source, { from, to }),
    parseStatus: diagnostics.some(item => item.severity === "error") ? "error" as const : "ok" as const,
    ...(diagnostics[0] ? { diagnostic: diagnostics[0] } : {}),
    diagnostics,
    todos: [] as LocatedPaperTodo[],
    comments: [] as LocatedPaperNote[],
    markers: [] as LocatedPaperMarker[],
  }));
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
  // Recompute ownership in actual include order, including heading-free files.
  const stack: SourceContextSection[] = [];
  const order = new Map<string, number>();
  for (const section of sections) { section.todos = []; section.comments = []; section.markers = []; }
  for (const range of orderedSourceRanges(graph)) {
    const events = [
      ...sections.filter(item => item.file === range.node.filePath).map(item => ({ at: item.sourceRange.from, section: item })),
      ...allTodos.filter(item => item.file === range.node.filePath).map(item => ({ at: item.start, todo: item })),
      ...allComments.filter(item => item.file === range.node.filePath).map(item => ({ at: item.start, comment: item })),
      ...allMarkers.filter(item => item.file === range.node.filePath).map(item => ({ at: item.start, marker: item })),
    ].filter(event => event.at >= range.from && event.at < range.to).sort((a, b) => a.at - b.at);
    for (const event of events) {
      if ("section" in event) {
        const section = event.section;
        while (stack.length && stack.at(-1)!.level >= section.level) stack.pop();
        stack.push(section);
        section.headingPath = stack.map(item => item.title);
        if (!order.has(section.id)) order.set(section.id, order.size);
        continue;
      }
      const owner = stack.at(-1);
      const item = "todo" in event ? event.todo : "comment" in event ? event.comment : event.marker;
      item.sectionId = owner?.id;
      item.sectionTitle = owner?.title;
      item.headingPath = stack.map(section => section.title);
      if (owner) {
        if ("todo" in event) { if (!owner.todos.includes(event.todo)) owner.todos.push(event.todo); }
        else if ("comment" in event) { if (!owner.comments.includes(event.comment)) owner.comments.push(event.comment); }
        else if (!owner.markers.includes(event.marker)) owner.markers.push(event.marker);
      }
    }
  }
  sections.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  sections.forEach((section, index) => { section.order = index; });
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
