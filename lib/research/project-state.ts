import fs from "node:fs";
import path from "node:path";

import { analyzePaper, type PaperAnalysis, type PaperHeading, type PaperNote, type PaperTodo } from "@/lib/research/paper-analysis";
import { bundledSkills, discoverSkillsInDir, findAgentsMd, type ProjectSkill } from "@/lib/research/project-skills";
import type { CurrentLocation } from "@/lib/research/webmcp-shared-contract";
import { parseTodoStatus } from "@/lib/todo-meta";
import { getEditableTexPaper, getProject, listMindmaps, listWiki, projectContentDir } from "@/lib/store";
import { DRAFT_MINDMAP_ID, texPaths, type PaperSection, type TexPaper } from "@/lib/tex-project/project";
import { buildSourceBundle } from "@/lib/tex-project/source-bundle";
import type { Mindmap, Project, WikiPage } from "@/lib/types";

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
  text: string;
  sectionId?: string;
  sectionTitle?: string;
  file?: string;
  status?: string;
  href: string;
};

export type ProjectStateComment = {
  text: string;
  kind?: string;
  sectionId?: string;
  sectionTitle?: string;
  href: string;
};

export type RecentActivityItem = {
  kind: "section_edit" | "todo_completed" | "annotation";
  title: string;
  sectionId?: string;
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
    venue?: string;
    tagline?: string;
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
  mindmaps: Array<{ id: string; title: string; href: string; nodeCount: number }>;
  recent: RecentActivityItem[];
  skills: ProjectSkill[];
  agentsMd?: { path: string };
};

function paperHref(slug: string, hash?: string): string {
  const base = `/p/${encodeURIComponent(slug)}/paper`;
  return hash ? `${base}#${encodeURIComponent(hash)}` : base;
}

function mindmapHref(slug: string, mapId?: string, nodeId?: string): string {
  const id = !mapId || mapId === DRAFT_MINDMAP_ID ? "" : `/${encodeURIComponent(mapId)}`;
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
  return parseTodoStatus(todo.attrs.status || todo.status) !== "done";
}

export function commentKind(note: PaperNote): string | undefined {
  const kind = note.attrs.kind?.trim();
  return kind || undefined;
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

  const todos = analysis.todos.map((todo) => {
    const section = matchSection(paper.sections, headingBeforeLine(analysis.outline, todo.line), todo.section);
    const status = parseTodoStatus(todo.attrs.status || todo.status);
    return {
      id: todo.id,
      text: todo.text,
      sectionId: section?.id,
      sectionTitle: section?.title || todo.section,
      file: relFile(section?.file, manuscriptDir),
      status: status === "open" ? undefined : status,
      href: paperHref(slug, todo.id),
    };
  });

  const comments = analysis.comments
    .filter((note) => note.macro === "obcomment")
    .map((note) => {
      const section = matchSection(paper.sections, headingBeforeLine(analysis.outline, note.line), note.section);
      return {
        text: note.text,
        kind: commentKind(note),
        sectionId: section?.id,
        sectionTitle: section?.title || note.section,
        href: paperHref(slug, section?.id),
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
  todos: ProjectStateTodo[];
  comments: ProjectStateComment[];
  limit?: number;
}): RecentActivityItem[] {
  const items: RecentActivityItem[] = [];
  for (const section of input.outline) {
    if (!section.updatedAt) continue;
    items.push({
      kind: "section_edit",
      title: section.title,
      sectionId: section.id,
      at: section.updatedAt,
      href: paperHref(input.slug, section.id),
    });
  }
  for (const todo of input.todos) {
    if (todo.status !== "done") continue;
    items.push({
      kind: "todo_completed",
      title: todo.text,
      sectionId: todo.sectionId,
      at: new Date().toISOString().slice(0, 10),
      href: todo.href,
    });
  }
  for (const comment of input.comments) {
    if (comment.kind !== "result" && comment.kind !== "finding") continue;
    items.push({
      kind: "annotation",
      title: comment.text,
      sectionId: comment.sectionId,
      at: new Date().toISOString(),
      href: comment.href,
    });
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
  agentsMd?: { path: string };
  current?: CurrentLocation;
}): ProjectState {
  const slug = input.project.slug;
  const paper = input.paper && input.analysis && input.bundle && input.manuscriptDir
    ? buildPaperSummary(slug, input.paper, input.analysis, input.bundle, input.manuscriptDir)
    : null;
  return {
    project: {
      slug,
      title: input.project.title,
      ...(input.project.venue ? { venue: input.project.venue } : {}),
      ...(input.project.tagline ? { tagline: input.project.tagline } : {}),
    },
    ...(input.current ? { current: input.current } : {}),
    paper,
    mindmaps: input.mindmaps.map((map) => {
      const id = map.id || DRAFT_MINDMAP_ID;
      return {
        id,
        title: map.title || input.project.title,
        href: mindmapHref(slug, id),
        nodeCount: map.nodes.length,
      };
    }),
    recent: paper
      ? deriveRecentActivity({ slug, outline: paper.outline, todos: paper.todos, comments: paper.comments })
      : [],
    skills: input.skills,
    ...(input.agentsMd ? { agentsMd: input.agentsMd } : {}),
  };
}

export function getProjectState(slug: string, current?: CurrentLocation): ProjectState | null {
  const project = getProject(slug);
  if (!project) return null;
  const dir = projectContentDir(slug);
  const paper = getEditableTexPaper(slug);
  const paths = texPaths(dir);
  const bundle = paper ? buildSourceBundle(paths.manuscriptDir) : undefined;
  const analysis = paper ? analyzePaper(paper.source) : undefined;
  const projectSkills = discoverSkillsInDir(dir);
  const skills = projectSkills.length ? projectSkills : bundledSkills();
  return buildProjectState({
    project,
    paper,
    analysis,
    bundle: bundle ? { rootFile: bundle.rootFile, revision: bundle.revision, bundleHash: bundle.bundleHash } : undefined,
    manuscriptDir: paths.manuscriptDir,
    mindmaps: listMindmaps(slug),
    wiki: listWiki(slug),
    skills,
    agentsMd: findAgentsMd(dir),
    current,
  });
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
      if (todo.text.toLowerCase().includes(needle) || todo.id.toLowerCase().includes(needle)) {
        hits.push({
          id: `paper:todo:${todo.id}`,
          kind: "todo",
          title: todo.sectionTitle || "TODO",
          snippet: todo.text,
          file: todo.file,
          href: todo.href,
        });
      }
    }
    for (const [index, comment] of input.paper.comments.entries()) {
      if (comment.text.toLowerCase().includes(needle) || (comment.kind || "").toLowerCase().includes(needle)) {
        hits.push({
          id: `paper:comment:${index}`,
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

  for (const map of input.mindmaps) {
    const mapId = map.id || DRAFT_MINDMAP_ID;
    for (const node of map.nodes) {
      if (!node.text.toLowerCase().includes(needle)) continue;
      const title = node.text.split("\n")[0]?.trim() || node.id;
      hits.push({
        id: `mindmap:${mapId}:node:${node.id}`,
        kind: "mindmap_node",
        title,
        snippet: snippetAround(node.text, query),
        href: mindmapHref(slug, mapId, node.id),
      });
    }
  }

  for (const page of input.wiki || []) {
    const blob = `${page.title}\n${page.summary}\n${page.body}`;
    if (!blob.toLowerCase().includes(needle)) continue;
    hits.push({
      id: `wiki:${page.slug}`,
      kind: "wiki",
      title: page.title,
      snippet: snippetAround(blob, query),
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
    wiki: listWiki(slug),
  });
}

export function parseProjectHref(href: string): {
  slug: string;
  kind: "paper" | "mindmap" | "wiki";
  hash: string;
  mapId?: string;
  wikiPage?: string;
} | null {
  const trimmed = href.trim();
  const [pathPart, hashPart = ""] = trimmed.split("#");
  const match = (pathPart || "").match(/^\/p\/([^/?#]+)(?:\/(paper|mindmap|wiki)(?:\/([^/?#]+))?)?/);
  if (!match) return null;
  const slug = decodeURIComponent(match[1]!);
  const page = (match[2] || "paper") as "paper" | "mindmap" | "wiki";
  const rest = match[3] ? decodeURIComponent(match[3]) : undefined;
  const hash = decodeURIComponent(hashPart);
  if (page === "mindmap") return { slug, kind: "mindmap", hash, mapId: rest };
  if (page === "wiki") return { slug, kind: "wiki", hash, wikiPage: rest };
  return { slug, kind: "paper", hash };
}

export function resolveProjectNavigation(slug: string, input: { id?: string; href?: string }): { href: string } | null {
  const href = input.href?.trim();
  if (href) {
    if (href.startsWith("/p/")) return { href };
    const parsed = parseProjectHref(href);
    if (parsed) return { href };
  }
  const id = input.id?.trim();
  if (!id) return null;
  const base = `/p/${encodeURIComponent(slug)}`;
  if (id.startsWith("paper:todo:")) return { href: paperHref(slug, id.slice("paper:todo:".length)) };
  if (id.startsWith("paper:section:")) return { href: paperHref(slug, id.slice("paper:section:".length)) };
  if (id.startsWith("paper:comment:")) {
    const state = getProjectState(slug);
    const index = Number(id.slice("paper:comment:".length));
    const comment = state?.paper?.comments[index];
    return { href: comment?.href || paperHref(slug) };
  }
  if (id.startsWith("paper:")) {
    const rest = id.slice("paper:".length);
    const sectionId = rest.split(":")[0];
    return { href: paperHref(slug, sectionId) };
  }
  if (id.startsWith("todo:")) return { href: paperHref(slug, id.slice(5)) };
  if (id.startsWith("mindmap:")) {
    const parts = id.slice("mindmap:".length).split(":");
    const mapId = parts[0];
    const nodeIndex = parts.indexOf("node");
    const nodeId = nodeIndex >= 0 ? parts[nodeIndex + 1] : parts.length === 1 ? parts[0] : parts[2];
    if (nodeIndex >= 0) return { href: mindmapHref(slug, mapId, nodeId) };
    if (parts.length === 1) return { href: mindmapHref(slug, undefined, parts[0]) };
    return { href: mindmapHref(slug, mapId, nodeId) };
  }
  if (id.startsWith("wiki:")) return { href: `${base}/wiki/${encodeURIComponent(id.slice(5))}` };

  const state = getProjectState(slug);
  if (!state) return { href: paperHref(slug) };
  if (state.paper?.todos.some((todo) => todo.id === id)) return { href: paperHref(slug, id) };
  if (state.paper?.outline.some((section) => section.id === id)) return { href: paperHref(slug, id) };
  for (const map of listMindmaps(slug)) {
    if (map.nodes.some((node) => node.id === id)) {
      return { href: mindmapHref(slug, map.id, id) };
    }
  }
  return { href: paperHref(slug) };
}
