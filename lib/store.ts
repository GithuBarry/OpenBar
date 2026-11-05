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
  DRAFT_MINDMAP_ID,
  resolveMindmapStorageIdentity,
} from "./tex-project/project";
import { TexEnvelopeError, sha256, withWriteLock } from "./tex-project/codec";
import { withProjectWriteLock } from "./research/project-lock";
import { mindmapDiskHash } from "./mindmap/mindmap";
import { readPaper } from "./research/paper-service";
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
  process.env.OPENBARRY_CONTENT || path.join(process.cwd(), "content");

const projectsDir = () => path.join(CONTENT_ROOT, "projects");
const projectDir = (slug: string) => path.join(projectsDir(), safeSegment(slug, "project slug"));

function parseTexRecord<T>(file: string, raw: unknown, schema: z.ZodType<T>): T | null {
  try {
    return schema.parse(raw);
  } catch (error) {
    recordContentDiagnostic(file, error);
    return null;
  }
}

function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  return value;
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

export function listProjects(): Project[] {
  const dir = projectsDir();
  const slugs = listDir(dir).filter((slug) => hasTexProject(path.join(dir, slug)));
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
  project.lastEditedAt = projectLastEditedAt(dir, texPaths(dir).paperFile, project.updatedAt);
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

export function getProject(slug: string): Project | null {
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
    lastEditedAt: projectLastEditedAt(dir, texPaths(dir).paperFile, parsed.updatedAt),
  };
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

function slugifyProjectId(title: string): string {
  const slug = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug || !/^[a-z0-9]/.test(slug)) throw new Error("Could not make a project slug from that title.");
  return slug;
}

/** Create a new TeX project under content/projects. Web and MCP both use this. */
export function createProject(input: { title: string; slug?: string; tagline?: string }): Project {
  const title = input.title.trim();
  if (!title) throw new Error("A project needs a title.");
  const slug = safeSegment(input.slug?.trim() || slugifyProjectId(title), "project slug");
  const dir = projectDir(slug);
  if (getProject(slug) || (fs.existsSync(dir) && fs.readdirSync(dir).length > 0)) {
    throw new Error(`Project "${slug}" already exists.`);
  }
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
  fs.mkdirSync(projectsDir(), { recursive: true });
  const staging = fs.mkdtempSync(path.join(projectsDir(), `.${slug}.tmp-`));
  try {
    writeProjectRecord(staging, persistableProject(project));
    writePaperProject(staging, title, [{
      id: "introduction",
      title: "Introduction",
      level: 2,
      order: 0,
      label: "sec-introduction",
      tex: composeObtodo({ text: "Write the opening motivation." }),
    }]);
    writeMindmapRecord(staging, emptyMindmap(slug, {
      id: DRAFT_MINDMAP_ID,
      title: title,
      role: "draft",
      rootText: title,
    }));
    if (fs.existsSync(dir)) throw new Error(`Project "${slug}" appeared while it was being created.`);
    if (!hasTexProject(staging)) throw new Error(`Project "${slug}" is incomplete after creation.`);
    fs.renameSync(staging, dir);
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  const created = getProject(slug);
  if (!created) throw new Error("Created project could not be read back.");
  return created;
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
  return { ...migrateMindmapArtifactRefs(normalized, paperSectionRefTargets(slug)), diskHash };
}

export function listMindmaps(slug: string): Mindmap[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  const sections = paperSectionRefTargets(slug);
  return listMindmapRecords(dir, recordContentDiagnostic).map(map => migrateMindmapArtifactRefs(normalizeMindmap(map), sections));
}

export function saveMindmap(slug: string, mindmap: Mindmap, expectedDiskHash?: string): void {
  const dir = projectDir(slug);
  const requestedId = mindmap.id || DRAFT_MINDMAP_ID;
  const requested = resolveMindmapStorageIdentity(dir, requestedId);
  if (mindmap.role && mindmap.role !== requested.role) {
    throw new TexEnvelopeError(`Mindmap "${requested.id}" has role "${mindmap.role}" but its storage role is "${requested.role}".`);
  }
  withProjectWriteLock(dir, () => {
    const identity = resolveMindmapStorageIdentity(dir, requestedId);
    if (expectedDiskHash) {
      const current = readMindmapRecord(dir, identity.id);
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
    const sections = paperSectionRefTargets(slug);
    const canonicalized = {
      ...normalized,
      nodes: normalized.nodes.map(node => ({
        ...node,
        ...(node.refs ? { refs: node.refs.map(ref => canonicalizeArtifactRef(ref, sections)) } : {}),
      })),
    };
    assertUniqueMindmapTodoIds(canonicalized);
    writeMindmapRecord(dir, persistableMindmap(canonicalized));
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
  const project = getProject(slug);
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
