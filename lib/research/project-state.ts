import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { analyzePaper, paperTodoIsOpen, type PaperAnalysis, type PaperHeading, type PaperMarker, type PaperNote, type PaperTodo } from "@/lib/research/paper-analysis";
import {
  bundledSkills,
  discoverSkillsInDir,
  discoverWorkspaceSkills,
  findAgentsMd,
  mergeSkills,
  workspaceRoot,
  type ProjectSkill,
} from "@/lib/research/project-skills";
import type { CurrentLocation, ProjectStateQuery } from "@/lib/research/webmcp-shared-contract";
import { getEditableTexPaper, getMindmap, getPaperEditorState, getProjectMetadata, getWikiPage, listWiki, listMindmaps, projectContentDir } from "@/lib/store";
import { DRAFT_MINDMAP_ID, texPaths, type PaperSection, type TexPaper } from "@/lib/tex-project/project";
import { buildSourceBundle } from "@/lib/tex-project/source-bundle";
import type { Mindmap, Project, WikiPage } from "@/lib/types";
import { buildSourceContextIndex, type LocatedPaperMarker, type LocatedPaperNote, type LocatedPaperTodo, type SourceContextIndex } from "./source-context";
import type { SourceDiagnostic } from "@/lib/tex-project/source-graph";
import { collectAgentMentions, type AgentFieldHashes } from "./agent-mentions";
import { readAgentInboxReceipts } from "./agent-reply-receipts";
import {
  findPrimaryMindmap,
  isPrimaryMindmap,
  nodeActivityAt,
  ordinaryMindmapCardContent,
  reconcileTodos,
  todoActivityAt,
  type TodoReconciliation,
} from "@/lib/research/todo-map";
import { openBarExpectations, type OpenBarExpectations } from "@/lib/research/expectations";
import { compactActivityChanges, compactActivityResources, readActivity, type ActivityEvent } from "@/lib/research/activity-log";
import { decodePaperSectionFragment, resolveMindmapNodeRef, resolvePaperSectionRef, type PaperSectionRefTarget } from "@/lib/research/artifact-link";

export type { CurrentLocation };

export type ProjectStateOutlineItem = {
  id: string;
  title: string;
  level: number;
  openTodos: number;
  file?: string;
  updatedAt?: string;
  sourceHash?: string;
  sourceRange?: { from: number; to: number };
  headingPath?: string[];
  excerpt?: string;
  parseStatus?: "ok" | "error";
  diagnostic?: SourceDiagnostic;
};

export type ProjectStateTodo = {
  id: string;
  /** Short TeX-owned label shown above the TODO body. */
  title?: string;
  text: string;
  sectionId?: string;
  sectionTitle?: string;
  file?: string;
  completed: boolean;
  /** TeX TODO with no card on the Primary map. */
  primaryUnplaced?: boolean;
  primaryMapNodeId?: string;
  /** Alias of primaryUnplaced for the current mindmap editor. */
  unplaced: boolean;
  mapNodeId?: string;
  href: string;
  mindmapHref?: string;
  headingPath?: string[];
  sourceStart?: number;
  sourceEnd?: number;
  fileRange?: { from: number; to: number };
  sourceHash?: string;
  excerpt?: string;
};

export type ProjectStateComment = {
  id?: string;
  text: string;
  kind?: string;
  sectionId?: string;
  sectionTitle?: string;
  /** Offset in the composed TeX source used when assigning an id on first link. */
  sourceStart?: number;
  sourceEnd?: number;
  fileRange?: { from: number; to: number };
  file?: string;
  sourceHash?: string;
  headingPath?: string[];
  href: string;
};

export type RecentActivityItem = {
  kind: "card" | "todo" | "section_edit";
  title: string;
  sectionId?: string;
  nodeId?: string;
  mapId?: string;
  at: string;
  href: string;
  actor?: ActivityEvent["actor"];
  operation?: string;
  resources?: ActivityEvent["resources"];
  changes?: ActivityEvent["changes"];
  deleted?: boolean;
};

export type SearchHit = {
  id: string;
  kind: "paper" | "todo" | "comment" | "mindmap_node" | "wiki";
  title: string;
  snippet: string;
  file?: string;
  href: string;
};

export type ProjectState = {
  agentMentions: ReturnType<typeof collectAgentMentions>;
  project: {
    slug: string;
    title: string;
    /** SHA-256 of the project metadata envelope for compare-and-swap writes. */
    hash: string;
    venue?: string;
    tagline?: string;
    overview?: string;
    researchKind?: string;
    color?: string;
    icon?: string;
    links: Project["links"];
    collaborators?: string[];
    archivedAt?: string;
    label?: string;
    engine?: Project["engine"];
    mainFile?: string;
    texliveVersion?: string;
  };
  current?: CurrentLocation;
  paper: {
    rootFile: string;
    revision: number;
    sourceHash?: string;
    title: string;
    outline: ProjectStateOutlineItem[];
    todos: ProjectStateTodo[];
    comments: ProjectStateComment[];
    markers: Array<{
      kind: string;
      text: string;
      file?: string;
      sectionId?: string;
      sectionTitle?: string;
      sourceStart: number;
      sourceEnd: number;
      sourceHash?: string;
      headingPath?: string[];
    }>;
    diagnostics: SourceDiagnostic[];
  } | null;
  mindmaps: Array<{ id: string; title: string; primary: boolean; href: string; nodeCount: number }>;
  wiki: Array<{ slug: string; title: string; href: string; updatedAt: string }>;
  recent: RecentActivityItem[];
  humanDecisions: Array<{ kind: "removed_mindmap_card"; at: string; mapId: string; nodeId: string; title?: string; text?: string; agentDraft: boolean }>;
  skills: ProjectSkill[];
  expectations: OpenBarExpectations;
  agentsMd?: { path: string; body: string; hash: string };
  workspaceAgentsMd?: { path: string; body: string; hash: string };
  /** Open mindmap only. Bound ids on this map; not agent orientation. */
  currentMap?: { id: string; primary: boolean; boundTodoIds: string[] };
  todoSync?: {
    primaryMapId: string;
    unplaced: number;
    missing: number;
    warnings: TodoReconciliation["warnings"];
  };
};

type SummarySection = {
  id: string;
  title: string;
  level: number;
  order: number;
  label: string;
  file?: string;
  tex?: string;
  sourceHash?: string;
  sourceRange: { from: number; to: number };
  headingPath: string[];
  excerpt: string;
  parseStatus: "ok" | "error";
  diagnostic?: SourceDiagnostic;
};

function legacySummarySection(section: PaperSection): SummarySection {
  return {
    ...section,
    file: section.file,
    sourceHash: section.hash,
    sourceRange: { from: 0, to: section.tex.length },
    headingPath: [],
    excerpt: section.tex.slice(0, 320),
    parseStatus: "ok",
  };
}

function locatedFields(value: PaperTodo | PaperNote | PaperMarker): {
  file?: string;
  sectionId?: string;
  sectionTitle?: string;
  headingPath?: string[];
  sourceHash?: string;
  excerpt?: string;
} {
  const candidate = value as Partial<LocatedPaperTodo & LocatedPaperNote & LocatedPaperMarker>;
  return {
    ...(typeof candidate.file === "string" ? { file: candidate.file } : {}),
    ...(typeof candidate.sectionId === "string" ? { sectionId: candidate.sectionId } : {}),
    ...(typeof candidate.sectionTitle === "string" ? { sectionTitle: candidate.sectionTitle } : {}),
    ...(Array.isArray(candidate.headingPath) ? { headingPath: candidate.headingPath } : {}),
    ...(typeof candidate.sourceHash === "string" ? { sourceHash: candidate.sourceHash } : {}),
    ...(typeof candidate.excerpt === "string" ? { excerpt: candidate.excerpt } : {}),
  };
}

function paperHref(slug: string, hash?: string): string {
  const base = `/p/${encodeURIComponent(slug)}/paper`;
  return hash ? `${base}#${encodeURIComponent(hash)}` : base;
}

function mindmapHref(slug: string, mapId?: string, nodeId?: string): string {
  const id = isPrimaryMindmap(mapId || DRAFT_MINDMAP_ID) ? "" : `/${encodeURIComponent(mapId!)}`;
  const base = `/p/${encodeURIComponent(slug)}/mindmap${id}`;
  return nodeId ? `${base}#${encodeURIComponent(nodeId)}` : base;
}

function relFile(abs: string | undefined, manuscriptDir: string): string | undefined {
  if (!abs) return undefined;
  return path.relative(manuscriptDir, abs).split(path.sep).join("/");
}

function fileMtime(file?: string): string | undefined {
  if (!file) return undefined;
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function headingBeforeLine(outline: PaperHeading[], line: number): PaperHeading | undefined {
  let hit: PaperHeading | undefined;
  for (const heading of outline) {
    if (heading.command === "title") continue;
    if (heading.line > line) break;
    hit = heading;
  }
  return hit;
}

function sectionAtSourceLine(
  source: string,
  lineIndex: number,
  outline: ProjectStateOutlineItem[],
): ProjectStateOutlineItem | undefined {
  const lines = source.split("\n");
  let title: string | undefined;
  for (let i = lineIndex; i >= 0; i--) {
    const match = lines[i]!.match(/\\(?:sub)*section\*?\{([^}]+)\}/);
    if (match) {
      title = match[1]!.trim();
      break;
    }
  }
  if (!title) return outline[0];
  return outline.find((item) => item.title.trim().toLowerCase() === title.toLowerCase()) || outline[0];
}

function matchSection(
  sections: PaperSection[],
  heading?: PaperHeading,
  sectionTitle?: string,
): PaperSection | undefined {
  const title = (sectionTitle || heading?.title || "").trim().toLowerCase();
  if (!title) return undefined;
  return sections.find((section) => section.title.trim().toLowerCase() === title);
}

function snippetAround(text: string, query: string, radius = 72): string {
  const haystack = text.replace(/\s+/g, " ").trim();
  const needle = query.trim();
  if (!needle) return haystack.slice(0, radius * 2);
  const index = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return haystack.slice(0, radius * 2);
  const start = Math.max(0, index - 40);
  const end = Math.min(haystack.length, index + needle.length + radius);
  return `${start > 0 ? "…" : ""}${haystack.slice(start, end)}${end < haystack.length ? "…" : ""}`;
}

export function openTodoStatus(todo: PaperTodo): boolean {
  return paperTodoIsOpen(todo);
}

export function commentKind(note: PaperNote): string | undefined {
  const kind = note.attrs.kind?.trim();
  return kind || undefined;
}

/** Stable TeX `[id=…]`, including a thin attrs.id fallback if PaperNote.id is unset. */
export function commentId(note: PaperNote): string | undefined {
  const id = (note.id || note.attrs.id)?.trim();
  return id || undefined;
}

export function buildPaperSummary(
  slug: string,
  paper: TexPaper,
  analysis: PaperAnalysis,
  bundle: { rootFile: string; revision: number; bundleHash?: string },
  manuscriptDir: string,
  context?: SourceContextIndex,
): NonNullable<ProjectState["paper"]> {
  const contextSections: SummarySection[] = context ? context.sections : paper.sections.map(legacySummarySection);
  const sourceTodos: Array<PaperTodo & Partial<LocatedPaperTodo>> = context?.todos || analysis.todos;
  const outline = contextSections.map((section) => {
    const openTodos = sourceTodos.filter((todo) => openTodoStatus(todo) && ("sectionId" in todo ? todo.sectionId : undefined) === section.id).length;
    return {
      id: section.id,
      title: section.title,
      level: section.level,
      openTodos,
      file: section.file || relFile(undefined, manuscriptDir),
      updatedAt: fileMtime(section.file),
      sourceHash: section.sourceHash,
      sourceRange: section.sourceRange,
      headingPath: section.headingPath,
      excerpt: section.excerpt,
      parseStatus: section.parseStatus,
      ...(section.diagnostic ? { diagnostic: section.diagnostic } : {}),
    };
  });

  const todos = sourceTodos.filter((todo) => todo.id).map((todo) => {
    const fields = locatedFields(todo);
    const section = contextSections.find((candidate) => candidate.id === fields.sectionId)
      || (matchSection(paper.sections, headingBeforeLine(analysis.outline, todo.line), todo.section)
        ? legacySummarySection(matchSection(paper.sections, headingBeforeLine(analysis.outline, todo.line), todo.section)!)
        : undefined);
    return {
      id: todo.id!,
      title: todo.title || "",
      text: todo.text,
      sectionId: section?.id,
      sectionTitle: section?.title || todo.section,
      file: fields.file || section?.file || relFile(undefined, manuscriptDir),
      completed: !paperTodoIsOpen(todo),
      primaryUnplaced: true,
      unplaced: true,
      href: paperHref(slug, todo.id!),
      ...(fields.headingPath ? { headingPath: fields.headingPath } : {}),
      sourceStart: (todo as Partial<LocatedPaperTodo>).virtualStart ?? todo.start,
      sourceEnd: (todo as Partial<LocatedPaperTodo>).virtualEnd ?? todo.end,
      fileRange: { from: todo.start, to: todo.end },
      sourceHash: fields.sourceHash || section?.sourceHash,
      excerpt: fields.excerpt || (section ? excerptFromText(section.excerpt) : todo.text),
    };
  });

  const sourceComments: Array<PaperNote & Partial<LocatedPaperNote>> = context?.comments || analysis.comments;
  const comments = sourceComments
    .filter((note) => note.macro === "obcomment")
    .map((note) => {
      const fields = locatedFields(note);
      const section = contextSections.find((candidate) => candidate.id === fields.sectionId)
        || (matchSection(paper.sections, headingBeforeLine(analysis.outline, note.line), note.section)
          ? legacySummarySection(matchSection(paper.sections, headingBeforeLine(analysis.outline, note.line), note.section)!)
          : undefined);
      const id = commentId(note);
      return {
        ...(id ? { id } : {}),
        text: note.text,
        kind: commentKind(note),
        sectionId: section?.id,
        sectionTitle: section?.title || note.section,
        sourceStart: note.virtualStart ?? note.start,
        sourceEnd: note.virtualEnd ?? note.end,
        fileRange: { from: note.start, to: note.end },
        file: fields.file || section?.file || relFile(undefined, manuscriptDir),
        sourceHash: fields.sourceHash || section?.sourceHash,
        headingPath: fields.headingPath,
        href: paperHref(slug, id || section?.id),
      };
    });

  const sourceMarkers: Array<PaperMarker & Partial<LocatedPaperMarker>> = context?.markers || analysis.markers;
  const markers = sourceMarkers.map((marker) => {
    const fields = locatedFields(marker);
    return {
    kind: marker.kind,
    text: marker.text,
    file: fields.file,
    sectionId: fields.sectionId || marker.section,
    sectionTitle: fields.sectionTitle,
    sourceStart: marker.virtualStart ?? marker.start,
    sourceEnd: marker.virtualEnd ?? marker.end,
    fileRange: { from: marker.start, to: marker.end },
    sourceHash: fields.sourceHash,
    headingPath: fields.headingPath,
    };
  });

  return {
    rootFile: bundle.rootFile,
    revision: bundle.revision,
    sourceHash: bundle.bundleHash,
    title: paper.title,
    outline,
    todos,
    comments,
    markers,
    diagnostics: context?.diagnostics || analysis.diagnostics.map((diagnostic) => ({
      severity: "error" as const,
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.line ? { filePath: `${bundle.rootFile}:${diagnostic.line}` } : {}),
    })),
  };
}

function excerptFromText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 320);
}

export function deriveRecentActivity(input: {
  slug: string;
  outline: ProjectStateOutlineItem[];
  mindmaps: Mindmap[];
  paperTodos?: PaperTodo[];
  primaryReconciliation?: TodoReconciliation;
  activity?: ActivityEvent[];
  activityWindowDays?: number;
  limit?: number;
}): RecentActivityItem[] {
  if (input.activity?.length) {
    const mapById = new Map(input.mindmaps.map((map) => [map.id || DRAFT_MINDMAP_ID, map]));
    const defaultDays = Math.max(1, Math.min(365, input.activityWindowDays || 7));
    const items: RecentActivityItem[] = [];
    for (const event of input.activity) {
      const resource = event.resources.find((item) => item.kind === "paper-todo" || item.kind === "paper-section" || item.kind === "mindmap-node")
        || event.resources[0];
      const todo = event.resources.find((item) => item.kind === "paper-todo");
      const eventMapId = event.resources.find((item) => item.mapId)?.mapId;
      const map = eventMapId ? mapById.get(eventMapId) : undefined;
      const days = map?.activityWindowDays || defaultDays;
      const since = Date.now() - days * 24 * 60 * 60 * 1000;
      if (!Number.isFinite(Date.parse(event.at)) || Date.parse(event.at) < since) continue;
      const kind: RecentActivityItem["kind"] = todo || resource?.kind === "paper-todo"
        ? "todo"
        : resource?.kind === "paper-section" || resource?.kind === "paper"
          ? "section_edit"
          : "card";
      const mapId = resource?.mapId || event.resources.find((item) => item.mapId)?.mapId;
      const nodeId = resource?.kind === "mindmap-node" ? resource.id : undefined;
      const sectionId = resource?.kind === "paper-section" ? resource.id : undefined;
      const todoId = todo?.id || (resource?.kind === "paper-todo" ? resource.id : undefined);
      const href = event.href
        || (todoId ? paperHref(input.slug, todoId) : nodeId ? mindmapHref(input.slug, mapId, nodeId) : sectionId ? paperHref(input.slug, sectionId) : paperHref(input.slug));
      items.push({
        kind,
        title: event.title || resource?.id || event.operation,
        ...(sectionId ? { sectionId } : {}),
        ...(nodeId ? { nodeId } : {}),
        ...(mapId ? { mapId } : {}),
        at: event.at,
        href,
        actor: event.actor,
        operation: event.operation,
        resources: compactActivityResources(event.resources),
        changes: compactActivityChanges(event.changes),
        ...(event.deleted ? { deleted: true } : {}),
      });
    }
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, input.limit ?? 40);
  }

  const items: RecentActivityItem[] = [];
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const texTodos = input.paperTodos || [];
  for (const map of input.mindmaps) {
    const mapId = map.id || DRAFT_MINDMAP_ID;
    const rec = isPrimaryMindmap(map) && input.primaryReconciliation
      ? input.primaryReconciliation
      : reconcileTodos(map, texTodos);
    for (const node of map.nodes) {
      const at = nodeActivityAt(node, rec);
      if (!at || Date.parse(at) < since) continue;
      items.push({
        kind: node.todoId ? "todo" : "card",
        title: rec.boundByNode.get(node.id)?.displayText || ordinaryMindmapCardContent(node).title || node.id,
        nodeId: node.id,
        mapId,
        at,
        href: mindmapHref(input.slug, mapId, node.id),
      });
    }
  }
  for (const section of input.outline) {
    if (!section.updatedAt || Date.parse(section.updatedAt) < since) continue;
    items.push({
      kind: "section_edit",
      title: section.title,
      sectionId: section.id,
      at: section.updatedAt,
      href: paperHref(input.slug, section.id),
    });
  }
  if (input.primaryReconciliation) {
    for (const item of input.primaryReconciliation.unplaced) {
      const at = todoActivityAt(item.todo);
      if (!at || Date.parse(at) < since) continue;
      const id = item.todo.id || "";
      items.push({
        kind: "todo",
        title: item.displayText,
        at,
        href: paperHref(input.slug, id),
      });
    }
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  return items.slice(0, input.limit ?? 12);
}

export function buildProjectState(input: {
  project: Project;
  paper: TexPaper | null;
  analysis?: PaperAnalysis;
  bundle?: { rootFile: string; revision: number; bundleHash?: string };
  manuscriptDir?: string;
  context?: SourceContextIndex;
  mindmaps: Mindmap[];
  agentFieldHashes?: AgentFieldHashes;
  wiki?: WikiPage[];
  skills: ProjectSkill[];
  agentsMd?: { path: string; body: string; updatedAt?: string };
  workspaceAgentsMd?: { path: string; body: string; updatedAt?: string };
  activity?: ActivityEvent[];
  current?: CurrentLocation;
}): ProjectState {
  const slug = input.project.slug;
  const paper = input.paper && input.analysis && input.bundle && input.manuscriptDir
    ? buildPaperSummary(slug, input.paper, input.analysis, input.bundle, input.manuscriptDir, input.context)
    : null;
  const primary = findPrimaryMindmap(input.mindmaps);
  const primaryMapId = primary?.id || DRAFT_MINDMAP_ID;
  const paperTodos = input.context?.todos || input.analysis?.todos || [];
  const reconciliation = reconcileTodos(primary || null, paperTodos);
  if (paper) {
    const bound = new Map(reconciliation.bound.map((item) => [item.todo.id, item]));
    paper.todos = paper.todos.map((todo) => {
      const card = bound.get(todo.id);
      const primaryUnplaced = !card;
      return {
        ...todo,
        primaryUnplaced,
        unplaced: primaryUnplaced,
        primaryMapNodeId: card?.node.id,
        mapNodeId: card?.node.id,
        mindmapHref: card ? mindmapHref(slug, primaryMapId, card.node.id) : mindmapHref(slug, primaryMapId),
      };
    });
  }
  const openMapId = input.current?.kind === "mindmap" ? (input.current.mapId || DRAFT_MINDMAP_ID) : undefined;
  const openMap = openMapId
    ? input.mindmaps.find((map) => {
      const id = map.id || DRAFT_MINDMAP_ID;
      return (isPrimaryMindmap(map) && isPrimaryMindmap(openMapId)) || id === openMapId;
    })
    : undefined;
  const agents = input.agentsMd;
  const currentNodes = new Set(input.mindmaps.flatMap((map) => map.nodes.map((node) => `${map.id || DRAFT_MINDMAP_ID}:${node.id}`)));
  const decisions: ProjectState["humanDecisions"] = [];
  const seenDecisions = new Set<string>();
  for (const event of input.activity || []) {
    if (event.actor !== "human" || event.operation !== "human_removed_mindmap_cards") continue;
    for (const change of event.changes || []) {
      if (!change.field.startsWith("node:") || !change.before || typeof change.before !== "object") continue;
      const nodeId = change.field.slice(5);
      const mapId = event.resources.find((resource) => resource.id === nodeId && resource.mapId)?.mapId;
      if (!mapId) continue;
      const key = `${mapId}:${nodeId}`;
      if (seenDecisions.has(key) || currentNodes.has(key)) continue;
      seenDecisions.add(key);
      const card = change.before as { title?: unknown; text?: unknown; agentDraft?: unknown };
      decisions.push({ kind: "removed_mindmap_card", at: event.at, mapId, nodeId,
        ...(typeof card.title === "string" && card.title ? { title: card.title } : {}),
        ...(typeof card.text === "string" && card.text ? { text: card.text } : {}),
        agentDraft: card.agentDraft === true });
      if (decisions.length >= 50) break;
    }
    if (decisions.length >= 50) break;
  }
  return {
    agentMentions: collectAgentMentions(slug, input.mindmaps, paper?.todos || [], 50, input.agentFieldHashes),
    project: {
      slug,
      title: input.project.title,
      hash: input.project.diskHash || "",
      ...(input.project.venue ? { venue: input.project.venue } : {}),
      ...(input.project.tagline ? { tagline: input.project.tagline } : {}),
      ...(input.project.overview ? { overview: input.project.overview } : {}),
      ...(input.project.researchKind ? { researchKind: input.project.researchKind } : {}),
      ...(input.project.color ? { color: input.project.color } : {}),
      ...(input.project.icon ? { icon: input.project.icon } : {}),
      links: input.project.links,
      ...(input.project.collaborators?.length ? { collaborators: input.project.collaborators } : {}),
      ...(input.project.archivedAt ? { archivedAt: input.project.archivedAt } : {}),
      ...(input.project.label ? { label: input.project.label } : {}),
      ...(input.project.engine ? { engine: input.project.engine } : {}),
      ...(input.project.mainFile ? { mainFile: input.project.mainFile } : {}),
      ...(input.project.texliveVersion ? { texliveVersion: input.project.texliveVersion } : {}),
    },
    ...(input.current ? { current: input.current } : {}),
    paper,
    mindmaps: input.mindmaps.map((map) => {
      const id = map.id || DRAFT_MINDMAP_ID;
      return {
        id,
        title: map.title || input.project.title,
        primary: isPrimaryMindmap(map),
        href: mindmapHref(slug, id),
        nodeCount: map.nodes.length,
      };
    }),
    wiki: (input.wiki || []).map(page => ({ slug: page.slug, title: page.title, href: `/p/${encodeURIComponent(slug)}/wiki/${encodeURIComponent(page.slug)}`, ...(page.bodyPath ? { path: page.bodyPath } : {}), updatedAt: page.updatedAt })),
    recent: deriveRecentActivity({
      slug,
      outline: paper?.outline || [],
      mindmaps: input.mindmaps,
      paperTodos,
      primaryReconciliation: reconciliation,
      activity: input.activity,
      activityWindowDays: primary?.activityWindowDays,
    }),
    humanDecisions: decisions,
    skills: input.skills,
    expectations: openBarExpectations(),
    ...(agents ? { agentsMd: { path: agents.path, body: agents.body, hash: hashAgents(agents.body) } } : {}),
    ...(input.workspaceAgentsMd
      ? {
          workspaceAgentsMd: {
            path: input.workspaceAgentsMd.path,
            body: input.workspaceAgentsMd.body,
            hash: hashAgents(input.workspaceAgentsMd.body),
          },
        }
      : {}),
    ...(openMap
      ? {
          currentMap: {
            id: openMap.id || DRAFT_MINDMAP_ID,
            primary: isPrimaryMindmap(openMap),
            boundTodoIds: [...new Set((openMap.nodes || []).flatMap((node) => (node.todoId?.trim() ? [node.todoId.trim()] : [])))],
          },
        }
      : {}),
    todoSync: {
      primaryMapId,
      unplaced: reconciliation.unplaced.length,
      missing: reconciliation.missing.length,
      warnings: reconciliation.warnings,
    },
  };
}

function hashAgents(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function getProjectState(slug: string, current?: CurrentLocation): ProjectState | null {
  const project = getProjectMetadata(slug);
  if (!project) return null;
  const dir = projectContentDir(slug);
  const paths = texPaths(dir);
  const paper = getEditableTexPaper(slug);
  const bundle = fs.existsSync(paths.paperFile) ? buildSourceBundle(paths.manuscriptDir) : undefined;
  const context = bundle ? buildSourceContextIndex(paths.manuscriptDir, bundle.rootFile, bundle) : undefined;
  const analysis = paper ? analyzePaper(paper.source) : undefined;
  const skills = mergeSkills(discoverSkillsInDir(dir), discoverWorkspaceSkills(), bundledSkills());
  return buildProjectState({
    project,
    paper,
    analysis,
    bundle: bundle ? { rootFile: bundle.rootFile, revision: bundle.revision, bundleHash: bundle.bundleHash } : undefined,
    manuscriptDir: paths.manuscriptDir,
    context,
    mindmaps: listMindmaps(slug),
    agentFieldHashes: projectAgentFieldHashes(dir),
    wiki: listWiki(slug),
    skills,
    agentsMd: findAgentsMd(dir),
    workspaceAgentsMd: findAgentsMd(workspaceRoot()),
    activity: readActivity(dir, 2_000),
    current,
  });
}

/** Project reads stay available while optional inbox metadata is being recovered. */
function projectAgentFieldHashes(dir: string): AgentFieldHashes | undefined {
  try { return readAgentInboxReceipts(dir).agentFieldHashes }
  catch { return undefined }
}

export function getProjectAgentMentions(slug: string, limit = 50) {
  const paper = getEditableTexPaper(slug);
  const todos = paper ? analyzePaper(paper.source).todos.map(todo => ({ ...todo, completed: !paperTodoIsOpen(todo) })) : [];
  return collectAgentMentions(slug, listMindmaps(slug), todos, limit, projectAgentFieldHashes(projectContentDir(slug)));
}

export function projectStateForAgent(state: ProjectState, query: ProjectStateQuery = {}): unknown {
  const detail = query.detail === "full" ? "full" : "summary";
  const todoLimit = query.todoLimit ?? (detail === "full" ? Infinity : 8);
  const paper = state.paper;
  const agentMentions = state.agentMentions;
  const primaryUnplaced = (todo: ProjectStateTodo) => todo.primaryUnplaced ?? todo.unplaced;
  const openTodos = paper?.todos.filter((todo) => !todo.completed) || [];
  const unplaced = paper?.todos.filter(primaryUnplaced) || [];
  const todoRows = (list: ProjectStateTodo[]) => list.slice(0, Number.isFinite(todoLimit) ? todoLimit : list.length).map((todo) => ({
    id: todo.id,
    title: todo.title,
    text: todo.text,
    sectionId: todo.sectionId,
    sectionTitle: todo.sectionTitle,
    file: todo.file,
    completed: todo.completed,
    primaryUnplaced: primaryUnplaced(todo),
    primaryMapNodeId: todo.primaryMapNodeId || todo.mapNodeId,
    unplaced: todo.unplaced,
    href: todo.href,
    mindmapHref: todo.mindmapHref,
    headingPath: todo.headingPath,
    sourceStart: todo.sourceStart,
    sourceEnd: todo.sourceEnd,
    fileRange: todo.fileRange,
    sourceHash: todo.sourceHash,
    excerpt: todo.excerpt,
  }));
  const maps = state.mindmaps.map((map) => ({
    id: map.id,
    title: map.title,
    primary: map.primary,
    nodeCount: map.nodeCount,
    href: map.href,
  }));
  const todoSync = state.todoSync && {
    primaryMapId: state.todoSync.primaryMapId,
    unplaced: state.todoSync.unplaced,
    missing: state.todoSync.missing,
    warnings: state.todoSync.warnings,
  };
  const recentForAgent = state.recent.slice(0, 6).map((item) => {
    const resources = compactActivityResources(item.resources);
    const changes = compactActivityChanges(item.changes);
    return {
      kind: item.kind,
      title: item.title,
      at: item.at,
      href: item.href,
      ...(item.sectionId ? { sectionId: item.sectionId } : {}),
      ...(item.nodeId ? { nodeId: item.nodeId } : {}),
      ...(item.mapId ? { mapId: item.mapId } : {}),
      ...(item.actor ? { actor: item.actor } : {}),
      ...(item.operation ? { operation: item.operation } : {}),
      ...(resources.length ? { resources } : {}),
      ...(changes.length ? { changes } : {}),
      ...(item.deleted ? { deleted: true } : {}),
    };
  });

  if (detail === "full") {
    return {
      detail,
      agentMentions,
      project: state.project,
      current: state.current,
      paper: paper && {
        ...paper,
        todos: todoRows(paper.todos),
      },
      todos: todoRows(paper?.todos || []),
      recent: state.recent,
      humanDecisions: state.humanDecisions,
      mindmaps: maps,
      wiki: state.wiki,
      skills: state.skills,
      agentsMd: state.agentsMd,
      workspaceAgentsMd: state.workspaceAgentsMd,
      expectations: state.expectations,
      todoSync,
    };
  }

  return {
    detail,
    agentMentions,
    project: state.project,
    current: state.current,
    paper: paper && {
      title: paper.title,
      rootFile: paper.rootFile,
      sections: paper.outline.length,
      openTodos: openTodos.length,
      primaryUnplaced: unplaced.length,
      outline: paper.outline.map((section) => ({
        id: section.id,
        title: section.title,
        openTodos: section.openTodos,
        file: section.file,
        headingPath: section.headingPath,
        ...(section.parseStatus && section.parseStatus !== "ok" ? { parseStatus: section.parseStatus, diagnostic: section.diagnostic } : {}),
      })),
    },
    todos: todoLimit > 0 ? todoRows([...unplaced, ...openTodos.filter((todo) => !primaryUnplaced(todo))]) : undefined,
    recent: recentForAgent,
    humanDecisions: state.humanDecisions,
    mindmaps: maps,
    wiki: state.wiki,
    skills: state.skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, source: skill.source })),
    expectations: { version: state.expectations.version },
    agentsMd: state.agentsMd && { path: state.agentsMd.path, hash: state.agentsMd.hash },
    workspaceAgentsMd: state.workspaceAgentsMd && { path: state.workspaceAgentsMd.path, hash: state.workspaceAgentsMd.hash },
    todoSync,
  };
}

export function searchProjectContent(input: {
  slug: string;
  query: string;
  paper?: NonNullable<ProjectState["paper"]> | null;
  paperSource?: string;
  mindmaps: Mindmap[];
  wiki?: WikiPage[];
}): SearchHit[] {
  const query = input.query.trim();
  if (!query) return [];
  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];
  const slug = input.slug;

  if (input.paper) {
    for (const section of input.paper.outline) {
      if (section.title.toLowerCase().includes(needle)) {
        hits.push({
          id: `paper:section:${section.id}`,
          kind: "paper",
          title: section.title,
          snippet: section.title,
          file: section.file,
          href: paperHref(slug, section.id),
        });
      }
    }
    for (const todo of input.paper.todos) {
      if (todo.title?.toLowerCase().includes(needle) || todo.text.toLowerCase().includes(needle) || todo.id.toLowerCase().includes(needle)) {
        hits.push({
          id: `paper:todo:${todo.id}`,
          kind: "todo",
          title: todo.title || todo.sectionTitle || "TODO",
          snippet: todo.title ? `${todo.title}\n${todo.text}` : todo.text,
          file: todo.file,
          href: todo.href,
        });
      }
    }
    for (const [index, comment] of input.paper.comments.entries()) {
      if (
        comment.text.toLowerCase().includes(needle)
        || (comment.kind || "").toLowerCase().includes(needle)
        || (comment.id || "").toLowerCase().includes(needle)
      ) {
        hits.push({
          id: comment.id ? `paper:comment:${comment.id}` : `paper:comment:${index}`,
          kind: "comment",
          title: comment.sectionTitle || comment.kind || "Comment",
          snippet: comment.text,
          href: comment.href,
        });
      }
    }
  }

  if (input.paperSource && input.paper) {
    const lines = input.paperSource.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.toLowerCase().includes(needle)) continue;
      if (line.trimStart().startsWith("% === openbarry:file")) continue;
      const section = sectionAtSourceLine(input.paperSource, i, input.paper.outline);
      hits.push({
        id: `paper:${section?.id || "source"}:${i + 1}`,
        kind: "paper",
        title: section?.title || "Paper",
        snippet: snippetAround(line, query),
        file: section?.file,
        href: paperHref(slug, section?.id),
      });
      if (hits.filter((hit) => hit.kind === "paper" && hit.id.includes(":")).length > 24) break;
    }
  }

  const todosById = new Map((input.paper?.todos || []).map((todo) => [todo.id, todo]));
  for (const map of input.mindmaps) {
    const mapId = map.id || DRAFT_MINDMAP_ID;
    const mapTitle = map.title?.trim() || mapId;
    if (mapTitle.toLowerCase().includes(needle)) {
      hits.push({
        id: `mindmap:${mapId}`,
        kind: "mindmap_node",
        title: mapTitle,
        snippet: mapTitle,
        href: mindmapHref(slug, mapId),
      });
    }
    for (const node of map.nodes) {
      const todo = node.todoId ? todosById.get(node.todoId) : undefined;
      const refBits = (node.refs || []).flatMap((ref) => [ref.kind, ref.id, ref.label, ref.url]);
      const cautionBits = node.caution ? [node.caution.critical, node.caution.important, node.caution.background] : [];
      const metadataBits = node.metadata ? Object.entries(node.metadata).flatMap(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]) : [];
      const hay = [mapTitle, node.title, node.text, node.caption, ...cautionBits, node.todoId, todo?.title, todo?.text, ...(node.tags || []), ...refBits, ...metadataBits]
        .filter(Boolean)
        .join("\n");
      if (!hay.toLowerCase().includes(needle)) continue;
      const nodeTitle = todo?.title?.trim() || (todo ? todo.text.split("\n")[0]?.trim() : "") || ordinaryMindmapCardContent(node).title || node.todoId || node.id;
      hits.push({
        id: `mindmap:${mapId}:node:${node.id}`,
        kind: "mindmap_node",
        title: `${mapTitle}: ${nodeTitle}`,
        snippet: snippetAround(hay, query),
        href: mindmapHref(slug, mapId, node.id),
      });
    }
  }

  for (const page of input.wiki || []) {
    const hay = [page.title, page.slug, page.body, ...(page.tags || [])].join("\n");
    if (!hay.toLowerCase().includes(needle)) continue;
    hits.push({
      id: `wiki:${page.slug}`,
      kind: "wiki",
      title: page.title,
      snippet: snippetAround(hay, query),
      href: `/p/${encodeURIComponent(slug)}/wiki/${encodeURIComponent(page.slug)}`,
    });
  }

  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (seen.has(hit.id)) return false;
    seen.add(hit.id);
    return true;
  }).slice(0, 40);
}

export function searchProject(slug: string, query: string): SearchHit[] {
  const project = getProjectMetadata(slug);
  if (!project) return [];
  const paper = getEditableTexPaper(slug);
  const analysis = paper ? analyzePaper(paper.source) : undefined;
  const dir = projectContentDir(slug);
  const bundle = paper ? buildSourceBundle(texPaths(dir).manuscriptDir) : undefined;
  const summary = paper && analysis && bundle
    ? buildPaperSummary(slug, paper, analysis, bundle, texPaths(dir).manuscriptDir, buildSourceContextIndex(texPaths(dir).manuscriptDir, bundle.rootFile, bundle))
    : null;
  return searchProjectContent({
    slug,
    query,
    paper: summary,
    paperSource: paper?.source,
    mindmaps: listMindmaps(slug),
    wiki: listWiki(slug),
  });
}

export function parseProjectHref(href: string): {
  slug: string;
  kind: "paper" | "mindmap" | "wiki" | "instructions";
  hash: string;
  mapId?: string;
  wikiPage?: string;
} | null {
  const match = href.trim().match(/^\/p\/([^/?#]+)\/(paper|mindmap|wiki|instructions)(?:\/([^/?#]+))?(?:#([^#]*))?$/);
  if (!match) return null;
  try {
    const slug = decodeURIComponent(match[1]!);
    const page = match[2] as "paper" | "mindmap" | "wiki" | "instructions";
    const rest = match[3] ? decodeURIComponent(match[3]) : undefined;
    const hash = decodeURIComponent(match[4] || "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) return null;
    if (rest && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rest)) return null;
    if (page === "paper" || page === "instructions") {
      if (rest) return null;
      return { slug, kind: page, hash };
    }
    if (page === "mindmap") return { slug, kind: "mindmap", hash, ...(rest ? { mapId: rest } : {}) };
    return { slug, kind: "wiki", hash, ...(rest ? { wikiPage: rest } : {}) };
  } catch {
    return null;
  }
}

export function resolveProjectNavigation(slug: string, input: { id?: string; href?: string }): { href: string } | null {
  const href = input.href?.trim();
  if (href) {
    const parsed = parseProjectHref(href);
    if (!parsed || parsed.slug !== slug) return null;
    if (parsed.kind === "mindmap") {
      const map = getMindmap(slug, parsed.mapId || DRAFT_MINDMAP_ID);
      if (!map) return null;
      if (parsed.hash && resolveMindmapNodeRef({ kind: "mindmap-node", id: parsed.hash, mapId: parsed.mapId }, [map]).status !== "resolved") return null;
    }
    if (parsed.kind === "paper" && parsed.hash) {
      const durable = decodePaperSectionFragment(parsed.hash);
      if (durable) {
        const current = paperNavigationSections(slug);
        const resolved = resolvePaperSectionRef(durable, current);
        if (resolved.status !== "resolved") return null;
        const target = resolved.section;
        return { href: paperHref(slug, target.label || target.id) };
      }
    }
    if (parsed.kind === "wiki" && parsed.wikiPage && !getWikiPage(slug, parsed.wikiPage)) return null;
    return { href };
  }
  const id = input.id?.trim();
  if (!id) return null;
  const state = getProjectState(slug);
  if (!state) return null;
  if (id.startsWith("paper:todo:")) {
    const todoId = id.slice("paper:todo:".length);
    return state.paper?.todos.some((todo) => todo.id === todoId) ? { href: paperHref(slug, todoId) } : null;
  }
  if (id.startsWith("paper:section:")) {
    const sectionId = id.slice("paper:section:".length);
    return state.paper?.outline.some((section) => section.id === sectionId) ? { href: paperHref(slug, sectionId) } : null;
  }
  if (id.startsWith("paper:comment:")) {
    const rest = id.slice("paper:comment:".length);
    const comments = state.paper?.comments || [];
    const byId = comments.find((comment) => comment.id === rest);
    if (byId) return { href: byId.href };
    return null;
  }
  if (id.startsWith("paper:")) {
    const rest = id.slice("paper:".length);
    const sectionId = rest.split(":")[0];
    return state.paper?.outline.some((section) => section.id === sectionId) ? { href: paperHref(slug, sectionId) } : null;
  }
  if (id.startsWith("todo:")) {
    const todoId = id.slice(5);
    return state.paper?.todos.some((todo) => todo.id === todoId) ? { href: paperHref(slug, todoId) } : null;
  }
  if (id.startsWith("mindmap:")) {
    const parts = id.slice("mindmap:".length).split(":");
    if (parts.length !== 1 && (parts.length !== 3 || parts[1] !== "node")) return null;
    const mapId = parts[0]?.trim();
    if (!mapId) return null;
    const map = getMindmap(slug, mapId);
    if (!map) return null;
    if (parts.length === 1) return { href: mindmapHref(slug, map.id) };
    const nodeId = parts[2]?.trim();
    if (!nodeId || !map.nodes.some((node) => node.id === nodeId)) return null;
    return { href: mindmapHref(slug, map.id, nodeId) };
  }
  if (id.startsWith("wiki:")) {
    const page = getWikiPage(slug, id.slice(5));
    return page ? { href: `/p/${encodeURIComponent(slug)}/wiki/${encodeURIComponent(page.slug)}` } : null;
  }

  if (state.paper?.todos.some((todo) => todo.id === id)) return { href: paperHref(slug, id) };
  const comment = state.paper?.comments.find((item) => item.id === id);
  if (comment) return { href: comment.href };
  if (state.paper?.outline.some((section) => section.id === id)) return { href: paperHref(slug, id) };
  const primaryMap = findPrimaryMindmap(listMindmaps(slug));
  if (primaryMap?.nodes.some(node => node.id === id)) return { href: mindmapHref(slug, primaryMap.id, id) };
  return null;
}

function paperNavigationSections(slug: string): PaperSectionRefTarget[] {
  const editor = getPaperEditorState(slug);
  return editor?.sourceContext.sections.map(section => ({
    id: section.id,
    title: section.title,
    level: section.level,
    ...(section.label ? { label: section.label } : {}),
    file: section.file,
    order: section.order,
    sourceHash: section.sourceHash,
    sourceRange: section.sourceRange,
    bodyHash: section.bodyHash,
    headingPath: section.headingPath,
    excerpt: section.excerpt,
  })) || [];
}
