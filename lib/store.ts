/**
 * OpenBar — TeX-backed content store.
 *
 * All research content lives as human-readable, primary TeX documents at
 * `content/projects/<slug>/` with OpenBar records under `.OpenBar/`.
 *
 * This module is server-only (uses node:fs). It is imported by server
 * components, route handlers, and the MCP server — never by client code.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { type BibEntry } from "./bibtex";
import {
  hasTexProject,
  listDocumentIds,
  readBibliography,
  readBibliographyRaw,
  parseBibliography,
  readDocument,
  readDocumentTex,
  documentFile,
  readMindmapRecord,
  listMindmapRecords,
  deleteMindmapRecord,
  readProjectRecord,
  nativeBodyRel,
  resolveNativeBodyAbs,
  texPaths,
  writeDocument,
  patchDocumentState,
  writeMindmapRecord,
  writePaperProject,
  writeProjectRecord,
  type PaperSection,
  type TexPaper,
  DEFAULT_PRIMARY_MINDMAP_TITLE,
  DRAFT_MINDMAP_ID,
  resolveMindmapStorageIdentity,
} from "./tex-project/project";
import { TexEnvelopeError, sha256, withWriteLock, withWriteLockAsync } from "./tex-project/codec";
import { withProjectWriteLock, withProjectWriteLockAsync } from "./research/project-lock";
import { attachOverleafCheckout, cloneOverleafProject, getProjectGitDestination, isBlankOverleafProject, OverleafSetupError } from "./tex-project/overleaf-git";
import { overleafProjectId } from "./server/git-url";
import { mindmapDiskHash } from "./mindmap/mindmap";
import { readPaper } from "./research/paper-service";
import { analyzePaper, type PaperTodo } from "./research/paper-analysis";
import { beginAgentReplyCapture, completeAgentReplyCapture } from "./research/agent-reply-receipts";
import { buildSourceBundle } from "./tex-project/source-bundle";
import { buildSourceContextIndex } from "./research/source-context";
import { existingConfiguredTexRoot } from "./tex-project/source-graph";
import type { SourceDiagnostic } from "./tex-project/source-graph";
import type { ClientSourceBundle } from "./tex-project/source-bundle-format";
import {
  projectSchema,
} from "./schemas";
import { assertUniqueMindmapTodoIds, emptyMindmap, persistableMindmap, slugifyMindmapId } from "./mindmap-index";
import { isPrimaryMindmap } from "./research/todo-map";
import { composeObtodo } from "./todo-meta";
import { normalizeMindmap } from "./mindmap/mindmap";
import { assertHtmlCardBodies } from "./mindmap/html-card";
import { markAgentDraft } from "./mindmap/agent-draft";
import {
  canonicalizeArtifactRef,
  migrateMindmapArtifactRefs,
  type PaperSectionRefTarget,
} from "./research/artifact-link";
import { filterProjectsForPublicDemo } from "./server/demo-mode";
import { projectLastEditedAt } from "./research/project-edited";
import {
  Mindmap,
  Project,
  WikiPage,
} from "./types";

const CONTENT_ROOT =
  process.env.OPENBAR_CONTENT || path.join(process.cwd(), "content");

const projectsDir = () => path.join(CONTENT_ROOT, "projects");
const projectDir = (slug: string) => path.join(projectsDir(), safeSegment(slug, "project slug"));
const projectSetupLock = () => path.join(projectsDir(), ".project-setup");

function parseTexRecord<T>(file: string, raw: unknown, schema: z.ZodType<T>): T | null {
  try {
    return schema.parse(raw);
  } catch (error) {
    recordContentDiagnostic(file, error);
    return null;
  }
}

function safeSegment(value: string, label: string): string {
  if (!validProjectSlug(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  return value;
}

function validProjectSlug(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function recordContentDiagnostic(file: string, error: unknown) {
  const issue = error instanceof z.ZodError
    ? error.issues.map((item) => `${item.path.join(".") || "root"}: ${item.message}`).join("; ")
    : error instanceof Error
      ? error.message
      : String(error);
  console.warn(`Invalid content ${file}: ${issue}`);
}

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function fileMtime(file: string): string {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function nowISO(): string {
  return new Date().toISOString();
}

function withCreatedAt<T extends { createdAt?: string; updatedAt?: string }>(
  incoming: T,
  existing?: { createdAt?: string; updatedAt?: string } | null,
  fallback?: string,
): T & { createdAt: string; updatedAt: string } {
  return {
    ...incoming,
    createdAt: incoming.createdAt || existing?.createdAt || existing?.updatedAt || incoming.updatedAt || fallback || nowISO(),
    updatedAt: nowISO(),
  };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/** Find a pasted project address whose capitalization differs from its saved directory. */
export function findProjectSlugIgnoringCase(input: string): string | undefined {
  const key = input.toLowerCase();
  return listDir(projectsDir()).find(slug => validProjectSlug(slug)
    && slug.toLowerCase() === key && hasTexProject(projectDir(slug)));
}

export function listProjects(): Project[] {
  const dir = projectsDir();
  const slugs = listDir(dir).filter((slug) => validProjectSlug(slug) && hasTexProject(path.join(dir, slug)));
  const projects = slugs
    .map((slug) => getProject(slug))
    .filter((p): p is Project => p != null);
  return projects.sort((a, b) => (b.lastEditedAt || b.updatedAt || "").localeCompare(a.lastEditedAt || a.updatedAt || ""));
}

/** Project catalog for pages and browser WebMCP. Keep listProjects raw for scripts and checks. */
export function listVisibleProjects(): Project[] {
  return filterProjectsForPublicDemo(listProjects());
}

function listedProjectFallback(slug: string, dir: string, raw: unknown): Project {
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const text = (key: string): string => typeof rec[key] === "string" ? rec[key].trim() : "";
  const stamp = fileMtime(texPaths(dir).projectFile);
  const project: Project = {
    id: slug,
    slug,
    title: text("title") || slug,
    tagline: text("tagline"),
    overview: text("overview"),
    createdAt: text("createdAt") || stamp,
    updatedAt: text("updatedAt") || stamp,
    links: [],
  };
  if (text("icon")) project.icon = text("icon");
  if (text("venue")) project.venue = text("venue");
  if (text("label")) project.label = text("label");
  project.diskHash = projectFileHash(dir);
  return project;
}

function projectFileHash(dir: string): string | undefined {
  try {
    return sha256(fs.readFileSync(texPaths(dir).projectFile));
  } catch {
    return undefined;
  }
}

function coerceProjectLinkKinds(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const rec = raw as Record<string, unknown>;
  if (!Array.isArray(rec.links)) return raw;
  const kinds = new Set(["overleaf", "latex", "arxiv", "web", "repo"]);
  return {
    ...rec,
    links: rec.links.map((link) => {
      if (!link || typeof link !== "object") return link;
      const item = link as Record<string, unknown>;
      return { ...item, kind: typeof item.kind === "string" && kinds.has(item.kind) ? item.kind : "web" };
    }),
  };
}

/** Read project identity without scanning the project for its last edit. */
export function getProjectMetadata(slug: string): Project | null {
  if (typeof slug !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) return null;
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return null;
  const raw = coerceProjectLinkKinds(readProjectRecord<unknown>(dir));
  const parsed = parseTexRecord(texPaths(dir).projectFile, raw, projectSchema);
  if (!parsed) return listedProjectFallback(slug, dir, raw);
  return {
    ...parsed,
    tagline: parsed.tagline || "",
    overview: parsed.overview || "",
    links: parsed.links || [],
    diskHash: projectFileHash(dir),
  };
}

/** Return project identity and the latest saved project edit. */
export function getProject(slug: string): Project | null {
  const project = getProjectMetadata(slug);
  if (!project) return null;
  const dir = projectDir(slug);
  return { ...project, lastEditedAt: projectLastEditedAt(dir, texPaths(dir).paperFile, project.updatedAt) };
}

/** Drop blank optional identity fields so they can be removed from the web UI. */
function persistableProject(project: Project): Project {
  const next: Project = {
    id: project.id,
    slug: project.slug,
    title: project.title.trim() || project.slug,
    tagline: project.tagline.trim(),
    overview: project.overview.trim(),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    links: Array.isArray(project.links) ? project.links : [],
  };
  if (project.venue?.trim()) next.venue = project.venue.trim();
  if (project.color?.trim()) next.color = project.color.trim();
  if (project.icon?.trim()) next.icon = project.icon.trim();
  const collaborators = (project.collaborators ?? []).map((name) => name.trim()).filter(Boolean);
  if (collaborators.length) next.collaborators = collaborators;
  if (project.researchKind?.trim()) next.researchKind = project.researchKind.trim();
  if (project.archivedAt) next.archivedAt = project.archivedAt;
  if (project.label?.trim()) next.label = project.label.trim();
  if (project.engine) next.engine = project.engine;
  if (project.mainFile?.trim()) next.mainFile = project.mainFile.trim();
  if (project.texliveVersion?.trim()) next.texliveVersion = project.texliveVersion.trim();
  return next;
}

export function saveProject(project: Project, expectedHash?: string): void {
  const dir = projectDir(project.slug);
  const persisted = projectSchema.parse(persistableProject(project));
  withProjectWriteLock(dir, () => {
    const currentRecord = readProjectRecord<Record<string, unknown>>(dir);
    const currentMainFile = typeof currentRecord?.mainFile === "string" ? currentRecord.mainFile.trim() : "";
    const nextMainFile = typeof persisted.mainFile === "string" ? persisted.mainFile.trim() : "";
    if (nextMainFile && nextMainFile !== currentMainFile) {
      const manuscriptDir = texPaths(dir).manuscriptDir;
      if (!existingConfiguredTexRoot(manuscriptDir, nextMainFile)) {
        throw new TexEnvelopeError(`Configured TeX root "${nextMainFile}" was not found inside the manuscript.`);
      }
    }
    if (expectedHash) {
      const currentHash = projectFileHash(dir);
      if (!currentHash || currentHash !== expectedHash) {
        throw new TexEnvelopeError(`Project changed on disk${currentHash ? ` (hash ${currentHash})` : ""}. Reload before saving.`);
      }
    }
    writeProjectRecord(dir, persisted);
  });
}

export type NewProjectInput = {
  title: string;
  slug?: string;
  tagline?: string;
  destination?: "local" | "existing" | "new";
  overleafUrl?: string;
  nameChecked?: boolean;
};

export function checkProjectName(input: Pick<NewProjectInput, "title" | "slug">): string {
  const title = input.title.trim();
  if (!title) throw new OverleafSetupError("Enter a project title.");
  const slug = input.slug?.trim() || title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length > 120 || !validProjectSlug(slug)) throw new OverleafSetupError("Choose a short project address using letters, numbers, dots, underscores, or hyphens. Start with a letter or number.");
  const nameKey = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const names = listDir(projectsDir());
  if (names.some(name => name.toLowerCase() === slug.toLowerCase())) {
    throw new OverleafSetupError(`The project address "${slug}" is already in use in OpenBar.`);
  }
  for (const name of names.filter(validProjectSlug)) {
    const existing = getProjectMetadata(name);
    if (existing && nameKey(existing.title) === nameKey(title)) {
      throw new OverleafSetupError(`"${existing.title}" is already in OpenBar.`);
    }
  }
  return slug;
}

async function ensureOverleafProjectUnused(id: string, currentSlug?: string): Promise<void> {
  const slugs = listDir(projectsDir()).filter(slug => validProjectSlug(slug) && slug !== currentSlug);
  const destinations = await Promise.all(slugs.map(slug => getProjectGitDestination(projectDir(slug))));
  const used = destinations.findIndex(destination => destination.kind === "overleaf" && destination.id === id);
  if (used >= 0) {
    const slug = slugs[used]!;
    throw new OverleafSetupError(`This Overleaf project is already connected to "${getProjectMetadata(slug)?.title || slug}" in OpenBar.`);
  }
}

function selectedOverleafProject(value: string | undefined): string {
  const id = overleafProjectId(value || "");
  if (!id) throw new OverleafSetupError("Paste the Overleaf project URL or Git URL.");
  return id;
}

function writeStarterPaper(directory: string, title: string): void {
  writePaperProject(directory, title, [{
    id: "introduction",
    title: "Introduction",
    level: 2,
    order: 0,
    label: "sec-introduction",
    tex: composeObtodo({ text: "Write a good introduction: you're telling a story" }),
  }]);
}

/** Stage the selected source and publish the complete checkout as one workspace entry. */
export async function createProject(input: NewProjectInput): Promise<Project> {
  return withWriteLockAsync(projectSetupLock(), async () => {
    const title = input.title.trim();
    const slug = checkProjectName(input);
    const dir = projectDir(slug);
    const destination = input.destination || "local";
    const id = destination === "local" ? undefined : selectedOverleafProject(input.overleafUrl);
    if (destination === "new" && !input.nameChecked) throw new OverleafSetupError("Check the project name in your Overleaf dashboard before creating it there.");
    if (id) await ensureOverleafProjectUnused(id);
    const now = nowISO();
    const project: Project = {
      id: slug,
      slug,
      title,
      tagline: (input.tagline || "").trim(),
      overview: "",
      createdAt: now,
      updatedAt: now,
      links: [],
    };
    const staging = fs.mkdtempSync(path.join(projectsDir(), `.${slug}.tmp-`));
    try {
      const files = id ? await cloneOverleafProject(staging, id) : [];
      if (destination === "existing") {
        if (!hasTexProject(staging)) throw new OverleafSetupError("Choose an Overleaf project with a LaTeX main document.");
        const stored = readProjectRecord<unknown>(staging);
        const imported = projectSchema.safeParse(coerceProjectLinkKinds(stored));
        if (fs.existsSync(texPaths(staging).projectFile) && !imported.success) {
          throw new OverleafSetupError("This Overleaf project has an unreadable OpenBar project record.");
        }
        const identity = imported.success
          ? { ...imported.data, slug, id: slug, title, tagline: input.tagline === undefined ? imported.data.tagline : project.tagline, updatedAt: now }
          : project;
        writeProjectRecord(staging, persistableProject(identity));
      } else {
        if (id && !isBlankOverleafProject(staging, files)) {
          throw new OverleafSetupError("This Overleaf project already contains a draft. Choose Use an existing Overleaf project to import its files. If you just created it, clear the starter main.tex and try again.");
        }
        writeProjectRecord(staging, persistableProject(id ? { ...project, mainFile: "main.tex" } : project));
        writeStarterPaper(staging, title);
      }
      if (!fs.existsSync(texPaths(staging).mindmapFile)) {
        writeMindmapRecord(staging, emptyMindmap(slug, { id: DRAFT_MINDMAP_ID, title: DEFAULT_PRIMARY_MINDMAP_TITLE, role: "draft", rootText: title }));
      }
      checkProjectName(input);
      if (!hasTexProject(staging)) throw new OverleafSetupError("The new project needs a readable LaTeX main document.");
      fs.renameSync(staging, dir);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
    const created = getProject(slug);
    if (!created) throw new Error("Created project could not be read back.");
    return created;
  });
}

export async function connectProjectToOverleaf(slug: string, overleafUrl: string): Promise<void> {
  const id = selectedOverleafProject(overleafUrl);
  const dir = projectDir(slug);
  await withWriteLockAsync(projectSetupLock(), async () => {
    const destination = await getProjectGitDestination(dir);
    if (destination.kind === "overleaf" && destination.id === id) return;
    if (destination.kind !== "local") throw new OverleafSetupError("This project already has a Git checkout.");
    await ensureOverleafProjectUnused(id, slug);
    const staging = fs.mkdtempSync(path.join(projectsDir(), `.${slug}.git-`));
    try {
      const files = await cloneOverleafProject(staging, id);
      await withProjectWriteLockAsync(dir, () => attachOverleafCheckout(dir, staging, files));
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  });
}

// ---------------------------------------------------------------------------
// Mindmap
// ---------------------------------------------------------------------------

function paperSectionRefTargets(slug: string): PaperSectionRefTarget[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  try {
    const paths = texPaths(dir);
    const bundle = buildSourceBundle(paths.manuscriptDir);
    const context = buildSourceContextIndex(paths.manuscriptDir, bundle.rootFile, bundle);
    return context.sections.map(section => ({
      id: section.id,
      title: section.title,
      level: section.level,
      ...(section.label ? { label: section.label } : {}),
      file: section.file,
      order: section.order,
      headingPath: section.headingPath,
      bodyHash: section.bodyHash,
      sourceHash: section.sourceHash,
      sourceRange: section.sourceRange,
    }));
  } catch {
    const paper = getEditableTexPaper(slug);
    return paper?.sections.map(section => ({
      id: section.id,
      title: section.title,
      level: section.level,
      ...(section.label ? { label: section.label } : {}),
      file: section.file,
      order: section.order,
      sourceHash: section.sourceHash,
    })) || [];
  }
}

export function getMindmap(slug: string, id = DRAFT_MINDMAP_ID): Mindmap | null {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return null;
  const map = readMindmapRecord(dir, id);
  if (!map) return null;
  const normalized = normalizeMindmap(map);
  const diskHash = mindmapDiskHash(normalized);
  // Reads expose the current canonical view while preserving the hash of the
  // bytes that were read. A later save can persist the migration atomically.
  const sections = hasPaperSectionRefs(normalized) ? paperSectionRefTargets(slug) : [];
  return { ...migrateMindmapArtifactRefs(normalized, sections), diskHash };
}

function hasPaperSectionRefs(map: Mindmap): boolean {
  return map.nodes.some(node => node.refs?.some(ref => ref.kind === "paper-section"));
}

export function listMindmaps(slug: string): Mindmap[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  const maps = listMindmapRecords(dir, recordContentDiagnostic).map(normalizeMindmap);
  const sections = maps.some(hasPaperSectionRefs) ? paperSectionRefTargets(slug) : [];
  return maps.map(map => migrateMindmapArtifactRefs(map, sections));
}

export class PaperTodoBindingError extends Error {
  constructor(readonly code: "unknown_todo" | "invalid_arguments", message: string) { super(message); }
}

export function readSavedPaperTodos(slug: string, ids: Set<string>): Map<string, PaperTodo> {
  const matches = new Map<string, PaperTodo>();
  if (!ids.size) return matches;
  const { manuscriptDir } = texPaths(projectDir(slug));
  for (const todo of analyzePaper(buildSourceBundle(manuscriptDir).source).todos) {
    if (!todo.id || !ids.has(todo.id)) continue;
    if (matches.has(todo.id)) throw new PaperTodoBindingError("invalid_arguments", `Multiple paper TODOs use "${todo.id}". Give each a unique ID before placing it.`);
    matches.set(todo.id, todo);
  }
  for (const id of ids) {
    if (!matches.has(id)) throw new PaperTodoBindingError("unknown_todo", `Paper TODO "${id}" could not be found in the saved manuscript. Refresh the TODO list.`);
  }
  return matches;
}

export function saveMindmap(slug: string, mindmap: Mindmap, expectedDiskHash?: string, actor: "human" | "webmcp" = "human"): Mindmap {
  assertHtmlCardBodies(mindmap.nodes);
  const dir = projectDir(slug);
  const requestedId = mindmap.id || DRAFT_MINDMAP_ID;
  const requested = resolveMindmapStorageIdentity(dir, requestedId);
  if (mindmap.role && mindmap.role !== requested.role) {
    throw new TexEnvelopeError(`Mindmap "${requested.id}" has role "${mindmap.role}" but its storage role is "${requested.role}".`);
  }
  return withProjectWriteLock(dir, () => {
    const identity = resolveMindmapStorageIdentity(dir, requestedId);
    const current = readMindmapRecord(dir, identity.id);
    if (expectedDiskHash) {
      const currentHash = current ? mindmapDiskHash(current) : undefined;
      // A primary map can be loaded as an in-memory fallback before its first
      // durable save. The write lock makes that first creation race-safe. Once
      // a record exists, the normal compare-and-save guard remains strict.
      const firstPrimarySave = !current && identity.role === "draft";
      if (!firstPrimarySave && currentHash !== expectedDiskHash) {
        throw new TexEnvelopeError(`Mindmap changed on disk${currentHash ? ` (hash ${currentHash})` : ""}. Reload before saving.`);
      }
    }
    const normalized = normalizeMindmap({ ...mindmap, projectId: slug, id: identity.id, role: identity.role });
    const sections = hasPaperSectionRefs(normalized) ? paperSectionRefTargets(slug) : [];
    const previousNodes = new Map(current?.nodes.map(node => [node.id, node]));
    const canonicalized = {
      ...normalized,
      nodes: normalized.nodes.map(node => ({
        ...(actor === "webmcp" ? markAgentDraft(node, previousNodes.get(node.id)) : node),
        ...(node.refs ? { refs: node.refs.map(ref => canonicalizeArtifactRef(ref, sections)) } : {}),
      })),
    };
    assertUniqueMindmapTodoIds(canonicalized);
    // Check newly introduced bindings against the manuscript under the same
    // write lock. Older missing-source cards stay available for repair.
    const newBindings = new Set(canonicalized.nodes.flatMap(node =>
      node.todoId && previousNodes.get(node.id)?.todoId !== node.todoId ? [node.todoId] : []));
    readSavedPaperTodos(slug, newBindings);
    const replyCapture = beginAgentReplyCapture(dir, slug, actor, current);
    writeMindmapRecord(dir, persistableMindmap(canonicalized));
    const persisted = readMindmapRecord(dir, identity.id);
    if (!persisted) throw new Error(`Mindmap "${identity.id}" could not be read after saving.`);
    const normalizedPersisted = normalizeMindmap(persisted);
    completeAgentReplyCapture(dir, slug, replyCapture, normalizedPersisted);
    return {
      ...migrateMindmapArtifactRefs(normalizedPersisted, sections),
      diskHash: mindmapDiskHash(normalizedPersisted),
    };
  });
}

export function createMindmap(slug: string, title: string): Mindmap {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) throw new Error(`Project ${slug} has no primary TeX manuscript.`);
  const base = slugifyMindmapId(title);
  const existing = new Set(listMindmapRecords(dir, recordContentDiagnostic).map((map) => map.id));
  let id = base === DRAFT_MINDMAP_ID || base === "mindmap" ? `${base}-map` : base;
  let n = 2;
  while (existing.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  const map = emptyMindmap(slug, { id, title: title.trim() || id, role: "planning" });
  writeMindmapRecord(dir, map);
  return readMindmapRecord(dir, id)!;
}

export function deleteMindmap(slug: string, id: string): void {
  if (isPrimaryMindmap(id)) throw new Error("The primary mindmap cannot be deleted.");
  const existing = getMindmap(slug, id);
  if (isPrimaryMindmap(existing)) throw new Error("The primary mindmap cannot be deleted.");
  deleteMindmapRecord(projectDir(slug), id);
}

export { DRAFT_MINDMAP_ID };

export function getEditableTexPaper(slug: string): TexPaper | null {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return null;
  const project = getProjectMetadata(slug);
  const result = readPaper(dir, slug, project?.title || slug);
  return result.ok ? result.value : null;
}

type PaperEditorState = {
  title: string;
  sections: Array<{
    id: string;
    title: string;
    level: number;
    tex: string;
    hash: string;
    appendix?: boolean;
  }>;
  bundle: ClientSourceBundle;
  sourceContext: {
    sections: Array<{
      id: string;
      title: string;
      level: number;
      order: number;
      label: string;
      file: string;
      sourceHash: string;
      sourceRange: { from: number; to: number };
      bodyHash: string;
      writeTargetId?: string;
      excerpt: string;
      headingPath: string[];
      parseStatus: "ok" | "error";
      diagnostic?: SourceDiagnostic;
      diagnostics: SourceDiagnostic[];
    }>;
    diagnostics: SourceDiagnostic[];
  };
};

export function getPaperEditorState(slug: string): PaperEditorState | null {
  const paper = getEditableTexPaper(slug);
  if (!paper) return null;
  const manuscriptDir = texPaths(projectDir(slug)).manuscriptDir;
  const bundle = buildSourceBundle(manuscriptDir);
  const sourceContext = buildSourceContextIndex(manuscriptDir, bundle.rootFile, bundle);
  return {
    title: paper.title,
    sections: paper.sections.map((section) => ({
      id: section.id,
      title: section.title,
      level: section.level,
      tex: section.tex,
      hash: section.hash,
      appendix: section.appendix,
    })),
    bundle: {
      rootFile: bundle.rootFile,
      source: bundle.source,
      revision: bundle.revision,
      bundleHash: bundle.bundleHash,
      segments: bundle.segments,
      diagnostics: bundle.diagnostics,
    },
    sourceContext: {
      sections: sourceContext.sections.map((section) => ({
        id: section.id,
        title: section.title,
        level: section.level,
        order: section.order,
        label: section.label,
        file: section.file,
        sourceHash: section.sourceHash,
        sourceRange: section.sourceRange,
        bodyHash: section.bodyHash,
        ...(section.writeTargetId ? { writeTargetId: section.writeTargetId } : {}),
        excerpt: section.excerpt,
        headingPath: section.headingPath,
        parseStatus: section.parseStatus,
        ...(section.diagnostic ? { diagnostic: section.diagnostic } : {}),
        diagnostics: section.diagnostics,
      })),
      diagnostics: sourceContext.diagnostics,
    },
  };
}

export function projectContentDir(slug: string): string {
  return projectDir(slug);
}

// ---------------------------------------------------------------------------
// Bibliography
// ---------------------------------------------------------------------------

export function getBibliography(slug: string): BibEntry[] {
  const dir = projectDir(slug);
  return hasTexProject(dir) ? readBibliography(dir) : [];
}

export function getBibliographyRaw(slug: string): string {
  const dir = projectDir(slug);
  return hasTexProject(dir) ? readBibliographyRaw(dir) : "";
}

export function getBibliographyData(slug: string): { raw: string; entries: BibEntry[] } {
  const raw = getBibliographyRaw(slug);
  return { raw, entries: parseBibliography(raw) };
}

// ---------------------------------------------------------------------------
// Wiki
// ---------------------------------------------------------------------------

export function listWiki(slug: string): WikiPage[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  return listDocumentIds(dir, "wiki", recordContentDiagnostic)
    .map((id) => {
      try {
        return getWikiPage(slug, id);
      } catch (error) {
        recordContentDiagnostic(documentFile(dir, "wiki", id), error);
        return null;
      }
    })
    .filter((page): page is WikiPage => page !== null);
}

export function getWikiTex(slug: string, pageSlug: string): string | null {
  try {
    const safePageSlug = safeSegment(pageSlug, "wiki page slug");
    const dir = projectDir(slug);
    if (!hasTexProject(dir)) return null;
    return readDocumentTex(dir, "wiki", safePageSlug);
  } catch {
    return null;
  }
}

export function getWikiPage(slug: string, pageSlug: string): WikiPage | null {
  const safePageSlug = safeSegment(pageSlug, "wiki page slug");
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return null;
  const document = readDocument<Record<string, unknown>>(dir, "wiki", safePageSlug);
  if (!document) return null;
  const d = document.metadata as Partial<WikiPage>;
  return {
    projectId: slug,
    slug: safePageSlug,
    title: d.title || safePageSlug,
    body: document.markdown,
    tags: d.tags || [],
    bodyHash: document.hash,
    stateHash: document.stateHash,
    format: document.format,
    ...(typeof d.bodyPath === "string" ? { bodyPath: d.bodyPath } : {}),
    createdAt: d.createdAt || d.updatedAt || fileMtime(document.file),
    updatedAt: d.updatedAt || fileMtime(document.file),
  };
}

export function saveWikiPage(page: WikiPage, expectedHash?: string): void {
  const dir = projectDir(page.projectId);
  const existing = getWikiPage(page.projectId, page.slug);
  if (expectedHash !== undefined && !existing) {
    throw new Error(`Unknown wiki page: ${page.slug}`);
  }
  const now = nowISO();
  const metadata = {
    title: page.title,
    createdAt: existing?.createdAt || page.createdAt || now,
    updatedAt: now,
    ...(page.tags?.length ? { tags: page.tags } : {}),
    ...(page.format ? { format: page.format } : {}),
    ...(page.bodyPath ? { bodyPath: page.bodyPath } : {}),
  };
  if (expectedHash !== undefined) {
    patchDocumentState(dir, "wiki", page.slug, expectedHash, metadata, page.body);
    return;
  }
  writeDocument(dir, "wiki", page.slug, metadata, page.body);
}

function wikiBodyPath(page: WikiPage): string | undefined {
  if (page.format !== "markdown" && page.format !== "html") return undefined;
  return page.bodyPath || nativeBodyRel("wiki", page.slug, page.format);
}

function removeWikiEnvelope(dir: string, pageSlug: string): void {
  const file = documentFile(dir, "wiki", safeSegment(pageSlug, "wiki page slug"));
  if (fs.existsSync(file)) fs.rmSync(file);
}

function removeWikiSidecar(dir: string, page: WikiPage): void {
  const bodyPath = wikiBodyPath(page);
  if (!bodyPath) return;
  const bodyFile = resolveNativeBodyAbs(dir, bodyPath);
  if (bodyFile && fs.existsSync(bodyFile)) fs.rmSync(bodyFile);
}

export function deleteWikiPage(slug: string, pageSlug: string, expectedHash?: string): void {
  const dir = projectDir(slug);
  const safePageSlug = safeSegment(pageSlug, "wiki page slug");
  const file = documentFile(dir, "wiki", safePageSlug);
  withWriteLock(file, () => {
    const page = getWikiPage(slug, safePageSlug);
    if (expectedHash !== undefined) {
      if (!page) throw new Error(`Unknown wiki page: ${safePageSlug}`);
      if (page.stateHash !== expectedHash) {
        throw new TexEnvelopeError(`Wiki page changed on disk. Reload before deleting it.`);
      }
    }
    if (page) removeWikiSidecar(dir, page);
    removeWikiEnvelope(dir, safePageSlug);
  });
}

export function renameWikiPage(slug: string, fromSlug: string, toSlug: string, expectedHash?: string): WikiPage {
  const dir = projectDir(slug);
  const safeFromSlug = safeSegment(fromSlug, "wiki page slug");
  const nextId = safeSegment(toSlug, "wiki page slug");
  const sourceFile = documentFile(dir, "wiki", safeFromSlug);
  return withWriteLock(sourceFile, () => {
    const page = getWikiPage(slug, safeFromSlug);
    if (!page) throw new Error(`Unknown wiki page "${fromSlug}".`);
    if (expectedHash !== undefined && page.stateHash !== expectedHash) {
      throw new TexEnvelopeError(`Wiki page changed on disk. Reload before renaming it.`);
    }
    if (nextId !== safeFromSlug && getWikiPage(slug, nextId)) throw new Error(`Wiki page "${nextId}" already exists.`);
    if (nextId === safeFromSlug) return page;
    const oldBodyPath = wikiBodyPath(page);
    const nextBodyPath = page.format === "markdown" || page.format === "html"
      ? oldBodyPath === nativeBodyRel("wiki", safeFromSlug, page.format)
        ? nativeBodyRel("wiki", nextId, page.format)
        : oldBodyPath
      : undefined;
    saveWikiPage({
      ...page,
      slug: nextId,
      updatedAt: nowISO(),
      ...(nextBodyPath ? { bodyPath: nextBodyPath } : {}),
    });
    removeWikiEnvelope(dir, safeFromSlug);
    if (oldBodyPath && oldBodyPath !== nextBodyPath) {
      const oldBodyFile = resolveNativeBodyAbs(dir, oldBodyPath);
      if (oldBodyFile && fs.existsSync(oldBodyFile)) fs.rmSync(oldBodyFile);
    }
    const renamed = getWikiPage(slug, nextId);
    if (!renamed) throw new Error("Wiki page could not be renamed.");
    return renamed;
  });
}
