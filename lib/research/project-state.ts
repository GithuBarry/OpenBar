import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { analyzePaper, paperTodoIsOpen, type PaperAnalysis, type PaperHeading, type PaperNote, type PaperTodo } from "@/lib/research/paper-analysis";
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
import { getEditableTexPaper, getMindmap, getProject, listMindmaps, projectContentDir } from "@/lib/store";
import { DRAFT_MINDMAP_ID, texPaths, type PaperSection, type TexPaper } from "@/lib/tex-project/project";
import { buildSourceBundle } from "@/lib/tex-project/source-bundle";
import type { Mindmap, Project, WikiPage } from "@/lib/types";
import {
  findPrimaryMindmap,
  isPrimaryMindmap,
  nodeActivityAt,
  ordinaryMindmapCardContent,
  reconcileTodos,
  todoActivityAt,
  type TodoReconciliation,
} from "@/lib/research/todo-map";

export type { CurrentLocation };

export type ProjectStateOutlineItem = {
  id: string;
  title: string;
  level: number;
  openTodos: number;
  file?: string;
  updatedAt?: string;
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
};

export type ProjectStateComment = {
  id?: string;
  text: string;
  kind?: string;
  sectionId?: string;
  sectionTitle?: string;
  /** Offset in the composed TeX source used when assigning an id on first link. */
  sourceStart?: number;
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
  } | null;
  mindmaps: Array<{ id: string; title: string; primary: boolean; href: string; nodeCount: number }>;
  wiki: Array<{ slug: string; title: string; href: string; updatedAt: string }>;
  recent: RecentActivityItem[];
  skills: ProjectSkill[];
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
): NonNullable<ProjectState["paper"]> {
  const outline = paper.sections.map((section) => {
    const heading = analysis.outline.find((item) => item.title.trim().toLowerCase() === section.title.trim().toLowerCase());
    const openTodos = analysis.todos.filter((todo) => {
      if (!openTodoStatus(todo)) return false;
      const matched = matchSection(paper.sections, headingBeforeLine(analysis.outline, todo.line), todo.section);
      return (matched?.id || "") === section.id || (!matched && heading && heading.title === section.title);
    }).length;
    return {
      id: section.id,
      title: section.title,
      level: section.level,
      openTodos,
      file: relFile(section.file, manuscriptDir),
      updatedAt: fileMtime(section.file),
    };
  });

  const todos = analysis.todos.filter((todo) => todo.id).map((todo) => {
    const section = matchSection(paper.sections, headingBeforeLine(analysis.outline, todo.line), todo.section);
    return {
      id: todo.id!,
      title: todo.title || "",
      text: todo.text,
      sectionId: section?.id,
      sectionTitle: section?.title || todo.section,
      file: relFile(section?.file, manuscriptDir),
      completed: !paperTodoIsOpen(todo),
      primaryUnplaced: true,
      unplaced: true,
      href: paperHref(slug, todo.id!),
    };
  });

  const comments = analysis.comments
    .filter((note) => note.macro === "obcomment")
    .map((note) => {
      const section = matchSection(paper.sections, headingBeforeLine(analysis.outline, note.line), note.section);
      const id = commentId(note);
      return {
        ...(id ? { id } : {}),
        text: note.text,
        kind: commentKind(note),
        sectionId: section?.id,
        sectionTitle: section?.title || note.section,
        sourceStart: note.start,
        href: paperHref(slug, id || section?.id),
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
  };
}

export function deriveRecentActivity(input: {
  slug: string;
  outline: ProjectStateOutlineItem[];
  mindmaps: Mindmap[];
  paperTodos?: PaperTodo[];
  primaryReconciliation?: TodoReconciliation;
  limit?: number;
}): RecentActivityItem[] {
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
        title: rec.bound.find((item) => item.node.id === node.id)?.displayText || ordinaryMindmapCardContent(node).title || node.id,
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
  mindmaps: Mindmap[];
  wiki?: WikiPage[];
  skills: ProjectSkill[];
  agentsMd?: { path: string; body: string; updatedAt?: string };
  workspaceAgentsMd?: { path: string; body: string; updatedAt?: string };
  current?: CurrentLocation;
}): ProjectState {
  const slug = input.project.slug;
  const paper = input.paper && input.analysis && input.bundle && input.manuscriptDir
    ? buildPaperSummary(slug, input.paper, input.analysis, input.bundle, input.manuscriptDir)
    : null;
  const primary = findPrimaryMindmap(input.mindmaps);
  const primaryMapId = primary?.id || DRAFT_MINDMAP_ID;
  const reconciliation = reconcileTodos(primary || null, input.analysis?.todos || []);
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
  return {
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
    wiki: [],
    recent: deriveRecentActivity({
      slug,
      outline: paper?.outline || [],
      mindmaps: input.mindmaps,
      paperTodos: input.analysis?.todos || [],
      primaryReconciliation: reconciliation,
    }),
    skills: input.skills,
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
  const project = getProject(slug);
  if (!project) return null;
  const dir = projectContentDir(slug);
  const paper = getEditableTexPaper(slug);
  const paths = texPaths(dir);
  const bundle = paper ? buildSourceBundle(paths.manuscriptDir) : undefined;
  const analysis = paper ? analyzePaper(paper.source) : undefined;
  const skills = mergeSkills(discoverSkillsInDir(dir), discoverWorkspaceSkills(), bundledSkills());
  return buildProjectState({
    project,
    paper,
    analysis,
    bundle: bundle ? { rootFile: bundle.rootFile, revision: bundle.revision, bundleHash: bundle.bundleHash } : undefined,
    manuscriptDir: paths.manuscriptDir,
    mindmaps: listMindmaps(slug),
    wiki: [],
    skills,
    agentsMd: findAgentsMd(dir),
    workspaceAgentsMd: findAgentsMd(workspaceRoot()),
    current,
  });
}

export function projectStateForAgent(state: ProjectState, query: ProjectStateQuery = {}): unknown {
  const detail = query.detail === "full" ? "full" : "summary";
  const todoLimit = query.todoLimit ?? (detail === "full" ? Infinity : 8);
  const paper = state.paper;
  const primaryUnplaced = (todo: ProjectStateTodo) => todo.primaryUnplaced ?? todo.unplaced;
  const openTodos = paper?.todos.filter((todo) => !todo.completed) || [];
  const unplaced = paper?.todos.filter(primaryUnplaced) || [];
  const todoRows = (list: ProjectStateTodo[]) => list.slice(0, Number.isFinite(todoLimit) ? todoLimit : list.length).map((todo) => ({
    id: todo.id,
    title: todo.title,
    text: todo.text,
    completed: todo.completed,
    primaryUnplaced: primaryUnplaced(todo),
    primaryMapNodeId: todo.primaryMapNodeId || todo.mapNodeId,
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

  if (detail === "full") {
    return {
      detail,
      project: state.project,
      current: state.current,
      paper: paper && {
        ...paper,
        todos: todoRows(paper.todos),
      },
      todos: todoRows(paper?.todos || []),
      recent: state.recent,
      mindmaps: maps,
      wiki: [],
      skills: state.skills,
      agentsMd: state.agentsMd,
      workspaceAgentsMd: state.workspaceAgentsMd,
      todoSync,
    };
  }

  return {
    detail,
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
      })),
    },
    todos: todoLimit > 0 ? todoRows([...unplaced, ...openTodos.filter((todo) => !primaryUnplaced(todo))]) : undefined,
    recent: state.recent.slice(0, 6).map((item) => ({
      kind: item.kind,
      title: item.title,
      at: item.at,
      href: item.href,
      mapId: item.mapId,
    })),
    mindmaps: maps,
    wiki: [],
    skills: state.skills.map((skill) => ({ id: skill.id, name: skill.name, source: skill.source })),
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
      const hay = [mapTitle, node.title, node.text, node.todoId, todo?.title, todo?.text, ...(node.tags || []), ...refBits]
        .filter(Boolean)
        .join("\n");
      if (!hay.toLowerCase().includes(needle)) continue;
      const nodeTitle = todo?.title?.trim() || (todo ? todo.text.split("\n")[0]?.trim() : "") || ordinaryMindmapCardContent(node).title || node.todoId || node.id;
      hits.push({
        id: `mindmap:${mapId}:node:${node.id}`,
        kind: "mindmap_node",
        title: `${mapTitle} · ${nodeTitle}`,
        snippet: snippetAround(hay, query),
        href: mindmapHref(slug, mapId, node.id),
      });
    }
  }

  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (seen.has(hit.id)) return false;
    seen.add(hit.id);
    return true;
  }).slice(0, 40);
}

export function searchProject(slug: string, query: string): SearchHit[] {
  const project = getProject(slug);
  if (!project) return [];
  const paper = getEditableTexPaper(slug);
  const analysis = paper ? analyzePaper(paper.source) : undefined;
  const dir = projectContentDir(slug);
  const bundle = paper ? buildSourceBundle(texPaths(dir).manuscriptDir) : undefined;
  const summary = paper && analysis && bundle
    ? buildPaperSummary(slug, paper, analysis, bundle, texPaths(dir).manuscriptDir)
    : null;
  return searchProjectContent({
    slug,
    query,
    paper: summary,
    paperSource: paper?.source,
    mindmaps: listMindmaps(slug),
    wiki: [],
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
    if (parsed.kind === "mindmap" && parsed.mapId && !getMindmap(slug, parsed.mapId)) return null;
    if (parsed.kind === "wiki") return null;
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
    if (parts.length !== 1 && (parts.length !== 4 || parts[1] !== "node")) return null;
    const mapId = parts[0]?.trim();
    if (!mapId) return null;
    const map = getMindmap(slug, mapId);
    if (!map) return null;
    if (parts.length === 1) return { href: mindmapHref(slug, map.id) };
    const nodeId = parts[3]?.trim();
    if (!nodeId || !map.nodes.some((node) => node.id === nodeId)) return null;
    return { href: mindmapHref(slug, map.id, nodeId) };
  }
  if (id.startsWith("wiki:")) return null;

  if (state.paper?.todos.some((todo) => todo.id === id)) return { href: paperHref(slug, id) };
  const comment = state.paper?.comments.find((item) => item.id === id);
  if (comment) return { href: comment.href };
  if (state.paper?.outline.some((section) => section.id === id)) return { href: paperHref(slug, id) };
  for (const map of listMindmaps(slug)) {
    if (map.nodes.some((node) => node.id === id)) {
      return { href: mindmapHref(slug, map.id, id) };
    }
  }
  return null;
}
