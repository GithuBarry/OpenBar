"use server";

/**
 * OpenBar — server actions (the single write layer).
 *
 * Every interactive module calls these instead of talking to the store or the
 * filesystem directly. Keeping writes in one "use server" module means the
 * client bundles stay clean, revalidation is consistent, and there is exactly
 * one place that mutates content. Signatures are a locked contract the feature
 * modules code against.
 */

import { revalidatePath } from "next/cache";

import {
  getEditableTexPaper,
  getPaperEditorState,
  getWikiPage,
  renameEditablePaperSection,
  setEditablePaperSectionHeading,
  addEditablePaperSection,
  removeEditablePaperSection,
  projectContentDir,
  saveProject,
  getProject,
  listVisibleProjects,
  createProject,
  getMindmap,
  saveMindmap,
  createMindmap,
  deleteMindmap,
  saveWikiPage,
  deleteWikiPage,
  renameWikiPage,
} from "@/lib/store";
import {
  Mindmap,
  Project,
  WikiPage,
} from "@/lib/types";
import { getPaperCompileStatus, requestPaperCompile } from "@/lib/tex-project/compile";
import { FIGURE_MAX_BYTES, uploadFigureAsset, texPaths, patchDocument, patchDocumentState, readDocument, DRAFT_MINDMAP_ID, resolveMindmapStorageIdentity } from "@/lib/tex-project/project";
import { persistSourceBundle, applyConversionWrite, repairPaperSectionEnvelope } from "@/lib/tex-project/source-persist";
import { getOverleafGitHistory, getOverleafGitStatus, pushOverleafGit, refreshOverleafGitStatus } from "@/lib/tex-project/overleaf-git";
import { inspectRepository } from "@/lib/tex-project/source-graph";
import { getConversionPlan, previewManuscriptConversion } from "@/lib/tex-project/pandoc";
import { convertComplexTables } from "@/lib/tex-project/pandoc-tables";
import { getRuntimeCapabilities } from "@/lib/research/capabilities";
import { okResult, type OperationResult } from "@/lib/research/operation-result";
import { getProjectState, projectStateForAgent, resolveProjectNavigation, searchProject } from "@/lib/research/project-state";
import { ensureCommentId } from "@/lib/research/paper-analysis";
import { isPrimaryMindmap } from "@/lib/research/todo-map";
import type { MindmapTodoConversion, MindmapTodoConversionFailure, MindmapTodoConversionResult } from "@/lib/research/webmcp-mindmap-contract";
import type { CurrentLocation, ProjectMetadataPatch, ProjectStateQuery } from "@/lib/research/webmcp-shared-contract";
import type { WorkspaceProjectResult } from "@/lib/research/webmcp-workspace-contract";
import {
  deleteProjectSkill,
  deleteWorkspaceSkill,
  readAnySkill,
  writeAgentsMd,
  writeProjectSkill,
  writeWorkspaceSkill,
  workspaceRoot,
} from "@/lib/research/project-skills";
import { persistPaperTodoOperation, insertTodoAtSection, persistPaperTodoPlacement, previewPaperTodoPlacement, relocatePaperTodo } from "@/lib/research/paper-todo-persist";
import { convertMindmapCardToTodo } from "@/lib/research/mindmap-todo-conversion";
import { remoteSyncResult } from "@/lib/research/project-sync";
import { applyMindmapAction, newNodeId } from "@/features/mindmap/mindmap-state";
import { analyzePaper } from "@/lib/research/paper-analysis";
import type { SourceOperation } from "@/lib/research/operations";
import { buildSourceBundle } from "@/lib/tex-project/source-bundle";
import { requireProjectAccess, requireWorkbenchAccess } from "@/lib/server/project-access";
import { assertAdministrativeWriteAllowed, isPublicDemoMode } from "@/lib/server/demo-mode";
import { wikiMetadataPatchSchema } from "@/lib/schemas";
import { normalizeMindmap, mindmapDiskHash } from "@/lib/mindmap/mindmap";
import { assertUniqueMindmapTodoIds } from "@/lib/mindmap-index";
import { normalizeMindmapLabels } from "@/lib/mindmap/node-metadata";
import { normalizeMindmapProgress } from "@/lib/mindmap/progress";
import {
  saveWorkspaceSettings,
  type WorkspaceSettings,
  type WorkspaceSettingsInput,
} from "@/lib/workspace";

/** Revalidate everything under a project (layout scope covers all sub-routes). */
function bust(slug: string) {
  revalidatePath(`/p/${slug}`, "layout");
  revalidatePath("/");
}

/** Guard the editable canvas against malformed client payloads and tree cycles. */
function normalizeMindmapForSave(slug: string, mindmap: Mindmap): Mindmap {
  if (mindmap.projectId !== slug) throw new Error("Mindmap project does not match the current project.");
  if (!Array.isArray(mindmap.nodes) || mindmap.nodes.length === 0) throw new Error("A mindmap needs a root topic.");
  if (mindmap.nodes.length > 2_000) throw new Error("Mindmaps are limited to 2,000 topics.");
  const identity = resolveMindmapStorageIdentity(projectContentDir(slug), mindmap.id || DRAFT_MINDMAP_ID);
  if (mindmap.role && mindmap.role !== identity.role) {
    throw new Error(`Mindmap "${identity.id}" has role "${mindmap.role}" but its storage role is "${identity.role}".`);
  }

  const nodeById = new Map<string, Mindmap["nodes"][number]>();
  for (const node of mindmap.nodes) {
    if (!node || typeof node.id !== "string" || !node.id.trim()) throw new Error("Every mindmap topic needs an id.");
    if (node.title !== undefined && typeof node.title !== "string") throw new Error(`Mindmap topic "${node.id}" has an invalid title.`);
    if (typeof node.text !== "string") throw new Error(`Mindmap topic "${node.id}" needs text.`);
    if (nodeById.has(node.id)) throw new Error(`Mindmap has duplicate topic id "${node.id}".`);
    if (node.parentId !== null && typeof node.parentId !== "string") throw new Error(`Mindmap topic "${node.id}" has an invalid parent.`);
    if (node.order !== undefined && !Number.isFinite(node.order)) throw new Error(`Mindmap topic "${node.id}" has an invalid order.`);
    nodeById.set(node.id, node);
  }

  assertUniqueMindmapTodoIds(mindmap);

  const root = nodeById.get(mindmap.rootId);
  if (!root || root.parentId !== null) throw new Error("Mindmap root is missing or has a parent.");
  if (mindmap.nodes.filter((node) => node.parentId === null).length !== 1) throw new Error("A mindmap must have exactly one root topic.");

  for (const node of mindmap.nodes) {
    if (node.parentId && !nodeById.has(node.parentId)) throw new Error(`Mindmap topic "${node.id}" points to a missing parent.`);
    const seen = new Set<string>();
    let current = node;
    while (current.parentId) {
      if (seen.has(current.id)) throw new Error("Mindmap cannot contain a parent cycle.");
      seen.add(current.id);
      const parent = nodeById.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
  }

  const now = new Date().toISOString();
  const mapCreatedAt = isIsoDateTime(mindmap.createdAt)
    ? mindmap.createdAt
    : isIsoDateTime(mindmap.updatedAt)
      ? mindmap.updatedAt
      : now;
  return {
    ...mindmap,
    projectId: slug,
    id: identity.id,
    role: identity.role,
    createdAt: mapCreatedAt,
    updatedAt: now,
    nodes: mindmap.nodes.map((node) => {
      const createdAt = isIsoDateTime(node.createdAt) ? node.createdAt : mapCreatedAt;
      const updatedAt = isIsoDateTime(node.updatedAt) ? node.updatedAt : createdAt;
      const tags = normalizeMindmapLabels(node.tags);
      const progress = normalizeMindmapProgress(node.progress);
      return {
        ...node,
        ...(node.id === mindmap.rootId ? { parentId: null, shape: "root" as const } : {}),
        ...(tags.length ? { tags } : {}),
        ...(!tags.length && node.tags ? { tags: undefined } : {}),
        ...(progress === undefined ? {} : { progress }),
        ...(progress === undefined && node.progress !== undefined ? { progress: undefined } : {}),
        createdAt,
        updatedAt,
      };
    }),
  };
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export async function saveProjectAction(project: Project, expectedHash = project.diskHash): Promise<void> {
  await requireProjectAccess(project.slug);
  assertAdministrativeWriteAllowed("Project metadata changes");
  saveProject(project, expectedHash);
  bust(project.slug);
}

/** Save the visible product identity in the tracked content tree. */
export async function saveWorkspaceSettingsAction(
  input: WorkspaceSettingsInput,
): Promise<WorkspaceSettings> {
  await requireWorkbenchAccess();
  assertAdministrativeWriteAllowed("Workspace identity changes");
  const saved = saveWorkspaceSettings(input);
  revalidatePath("/", "layout");
  return saved;
}

export async function createProjectAction(input: {
  title: string;
  slug?: string;
  tagline?: string;
}): Promise<{ slug: string }> {
  await requireWorkbenchAccess();
  assertAdministrativeWriteAllowed("Project creation");
  const project = createProject(input);
  bust(project.slug);
  return { slug: project.slug };
}

export async function saveMindmapAction(
  slug: string,
  mindmap: Mindmap,
  expectedDiskHash?: string,
): Promise<Mindmap> {
  await requireProjectAccess(slug);
  const saved = normalizeMindmapForSave(slug, mindmap);
  const current = getMindmap(slug, saved.id);
  if (isPublicDemoMode() && !current) {
    throw new Error("Mindmap creation is disabled in the public demo.");
  }
  if (expectedDiskHash && current) {
    const currentHash = mindmapDiskHash(current);
    if (currentHash !== expectedDiskHash) {
      throw new Error(`conflict: mindmap changed (hash ${currentHash}). Reload before saving.`);
    }
  }
  const normalized = normalizeMindmap({
    ...saved,
    revision: (current?.revision ?? 0) + 1,
  });
  const diskHash = mindmapDiskHash(normalized);
  const next = { ...normalized, diskHash };
  saveMindmap(slug, next, expectedDiskHash);
  bust(slug);
  return next;
}

/** Read the latest persisted map after a compare-and-swap conflict. */
export async function getMindmapAction(slug: string, id: string): Promise<Mindmap | null> {
  await requireProjectAccess(slug);
  return getMindmap(slug, id);
}

export async function getProjectGitStatusAction(slug: string, refreshRemote = false) {
  await requireProjectAccess(slug);
  const projectDir = projectContentDir(slug);
  return refreshRemote ? refreshOverleafGitStatus(projectDir) : getOverleafGitStatus(projectDir);
}

export async function getProjectGitHistoryAction(slug: string, since?: string, limit = 40) {
  await requireProjectAccess(slug);
  return getOverleafGitHistory(projectContentDir(slug), since, limit);
}

export async function commitAndPushProjectAction(slug: string, message?: string) {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Git commit and push");
  const result = await pushOverleafGit(
    projectContentDir(slug),
    message?.trim() || `OpenBar: save ${slug}`,
  );
  if (result.ok) bust(slug);
  return result;
}

export async function createMindmapAction(slug: string, title: string): Promise<{ id: string; title: string }> {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Mindmap creation");
  const map = createMindmap(slug, title);
  bust(slug);
  return { id: map.id || title, title: map.title || title };
}

export async function deleteMindmapAction(slug: string, id: string): Promise<void> {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Mindmap deletion");
  if (isPrimaryMindmap(id)) throw new Error("The primary mindmap cannot be deleted.");
  const existing = getMindmap(slug, id);
  if (isPrimaryMindmap(existing)) throw new Error("The primary mindmap cannot be deleted.");
  deleteMindmap(slug, id);
  bust(slug);
}

export async function getEditablePaperAction(slug: string) {
  await requireProjectAccess(slug);
  const paper = getPaperEditorState(slug);
  if (!paper) return null;
  const pandocTables = await convertComplexTables({
    source: paper.bundle.source,
    cwd: texPaths(projectContentDir(slug)).manuscriptDir,
  });
  return { ...paper, pandocTables };
}

export async function repairPaperSectionEnvelopeAction(
  slug: string,
  filePath: string,
  sectionId: string,
  expectedSourceHash?: string,
) {
  await requireProjectAccess(slug);
  const result = repairPaperSectionEnvelope({
    manuscriptDir: texPaths(projectContentDir(slug)).manuscriptDir,
    filePath,
    sectionId,
    expectedSourceHash,
  });
  if (result.ok) bust(slug);
  return result;
}

export async function previewTableFallbacksAction(slug: string, source: string) {
  await requireProjectAccess(slug);
  return convertComplexTables({
    source,
    cwd: texPaths(projectContentDir(slug)).manuscriptDir,
  });
}

export async function persistSourceBundleAction(
  slug: string,
  nextSource: string,
  expectedBundleHash: string,
  dryRun = false,
) {
  await requireProjectAccess(slug);
  const result = persistSourceBundle({
    manuscriptDir: texPaths(projectContentDir(slug)).manuscriptDir,
    nextSource,
    expectedBundleHash,
    dryRun,
  });
  if (result.ok && !dryRun) bust(slug);
  return result;
}

export async function renamePaperSectionAction(slug: string, id: string, title: string) {
  await requireProjectAccess(slug);
  renameEditablePaperSection(slug, id, title);
  bust(slug);
  return getPaperEditorState(slug);
}

export async function setPaperSectionHeadingAction(
  slug: string,
  id: string,
  heading: { level?: number; appendix?: boolean },
) {
  await requireProjectAccess(slug);
  setEditablePaperSectionHeading(slug, id, heading);
  bust(slug);
  return getPaperEditorState(slug);
}

export async function addPaperSectionAction(
  slug: string,
  spec: { title: string; afterId?: string; level?: number; appendix?: boolean },
) {
  await requireProjectAccess(slug);
  addEditablePaperSection(slug, spec);
  bust(slug);
  return getPaperEditorState(slug);
}

export async function removePaperSectionAction(slug: string, id: string) {
  await requireProjectAccess(slug);
  removeEditablePaperSection(slug, id);
  bust(slug);
  return getPaperEditorState(slug);
}

export async function requestPaperCompileAction(slug: string) {
  await requireProjectAccess(slug);
  if (!getEditableTexPaper(slug)) throw new Error("This project has no TeX paper.");
  return requestPaperCompile(projectContentDir(slug));
}

export async function getPaperCompileStatusAction(slug: string) {
  await requireProjectAccess(slug);
  return getPaperCompileStatus(projectContentDir(slug));
}

export async function uploadPaperFigureAction(slug: string, formData: FormData): Promise<{
  id: string;
  markdown: string;
  tex: string;
  path: string;
}> {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Figure uploads");
  if (!getEditableTexPaper(slug)) throw new Error("This project has not been migrated to a complete TeX manuscript.");
  const candidate = formData.get("file");
  if (!candidate || typeof candidate === "string" || typeof candidate.arrayBuffer !== "function") {
    throw new Error("Choose a figure file to upload.");
  }
  const file = candidate as File;
  if (typeof file.size === "number" && file.size > FIGURE_MAX_BYTES) {
    throw new Error("Figures are limited to 8 MB.");
  }
  const upload = uploadFigureAsset(projectContentDir(slug), file.name, Buffer.from(await file.arrayBuffer()));
  return { id: upload.id, markdown: upload.markdown, tex: upload.tex, path: upload.path };
}

export async function uploadMindmapImageAction(slug: string, formData: FormData): Promise<{
  ref: { kind: "figure"; id: string; label: string };
  path: string;
  sha256: string;
}> {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Mindmap image uploads");
  if (!getEditableTexPaper(slug)) throw new Error("This project has not been migrated to a complete TeX manuscript.");
  const candidate = formData.get("file");
  if (!candidate || typeof candidate === "string" || typeof candidate.arrayBuffer !== "function") {
    throw new Error("Choose an image file to upload.");
  }
  const file = candidate as File;
  if (typeof file.size === "number" && file.size > FIGURE_MAX_BYTES) {
    throw new Error("Images are limited to 8 MB.");
  }
  const upload = uploadFigureAsset(projectContentDir(slug), file.name, Buffer.from(await file.arrayBuffer()));
  return {
    ref: { kind: "figure", id: upload.path, label: file.name },
    path: upload.path,
    sha256: upload.sha256,
  };
}

export async function getCapabilitiesAction() {
  await requireWorkbenchAccess();
  return getRuntimeCapabilities();
}

function workspaceProjectSummary(project: Project): WorkspaceProjectResult {
  const tagline = project.tagline.trim();
  const icon = project.icon?.trim();
  return {
    slug: project.slug,
    title: project.title,
    href: `/p/${encodeURIComponent(project.slug)}/paper`,
    ...(tagline ? { tagline } : {}),
    ...(icon ? { icon } : {}),
  };
}

export async function listWorkspaceProjectsAction(): Promise<WorkspaceProjectResult[]> {
  await requireWorkbenchAccess();
  return listVisibleProjects().map(workspaceProjectSummary);
}

export async function searchWorkspaceProjectsAction(query: string): Promise<WorkspaceProjectResult[]> {
  await requireWorkbenchAccess();
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return listVisibleProjects()
    .filter((project) => [project.slug, project.title, project.tagline, project.label]
      .some((value) => value?.toLowerCase().includes(needle)))
    .map(workspaceProjectSummary);
}

export async function openWorkspaceProjectAction(slug: string): Promise<WorkspaceProjectResult | null> {
  await requireProjectAccess(slug);
  const project = getProject(slug);
  return project ? workspaceProjectSummary(project) : null;
}

export async function inspectRepositoryAction(slug: string) {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Repository inspection");
  return inspectRepository(texPaths(projectContentDir(slug)).manuscriptDir);
}

export async function getProjectStateAction(slug: string, current?: CurrentLocation, query?: ProjectStateQuery) {
  await requireProjectAccess(slug);
  const state = getProjectState(slug, current);
  return state ? projectStateForAgent(state, query) : null;
}

export async function searchProjectAction(slug: string, query: string) {
  await requireProjectAccess(slug);
  return { results: searchProject(slug, query) };
}

/** Assign a stable id only when a researcher links an existing paper comment. */
export async function ensurePaperCommentAction(slug: string, sourceStart: number, expectedBundleHash: string) {
  await requireProjectAccess(slug);
  if (!Number.isInteger(sourceStart) || sourceStart < 0) throw new Error("Comment source position is invalid.");
  if (!/^[a-f0-9]{64}$/i.test(expectedBundleHash)) throw new Error("Paper bundle hash is invalid.");
  const manuscriptDir = texPaths(projectContentDir(slug)).manuscriptDir;
  const bundle = buildSourceBundle(manuscriptDir);
  if (bundle.bundleHash !== expectedBundleHash) {
    throw new Error("Paper changed on disk. Reload before linking the comment.");
  }
  const ensured = ensureCommentId(bundle.source, sourceStart);
  if (!ensured) throw new Error("Could not locate that paper comment in the current source.");
  if (ensured.source === bundle.source) return { id: ensured.id, hash: bundle.bundleHash, changed: false };
  const result = persistSourceBundle({
    manuscriptDir,
    nextSource: ensured.source,
    expectedBundleHash,
  });
  if (!result.ok) throw new Error(result.message);
  bust(slug);
  return { id: ensured.id, hash: result.diskHash || result.value.bundleHash, changed: true };
}

export async function resolveProjectNavigationAction(slug: string, input: { id?: string; href?: string }) {
  await requireProjectAccess(slug);
  return resolveProjectNavigation(slug, input);
}

export async function readProjectSkillAction(slug: string, id: string) {
  await requireProjectAccess(slug);
  const local = readAnySkill(projectContentDir(slug), id);
  if (local) return { ...local.skill, body: local.body };
  throw new Error(`Unknown skill "${id}".`);
}

export async function updateProjectAction(
  slug: string,
  patch: ProjectMetadataPatch,
) {
  await requireProjectAccess(slug);
  const current = getProject(slug);
  if (!current) throw new Error(`Unknown project "${slug}".`);
  if (!patch.expectedHash) throw new Error("Read project state and pass project.hash before saving.");
  saveProject({
    ...current,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.venue !== undefined ? { venue: patch.venue } : {}),
    ...(patch.tagline !== undefined ? { tagline: patch.tagline } : {}),
    ...(patch.overview !== undefined ? { overview: patch.overview } : {}),
    ...(patch.researchKind !== undefined ? { researchKind: patch.researchKind } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.links !== undefined ? { links: patch.links } : {}),
    ...(patch.collaborators !== undefined ? { collaborators: patch.collaborators } : {}),
    ...(patch.archivedAt !== undefined ? { archivedAt: patch.archivedAt || undefined } : {}),
    updatedAt: new Date().toISOString(),
  }, patch.expectedHash);
  bust(slug);
  return getProject(slug);
}

export async function placeTodoOnMindmapAction(slug: string, todoId: string, parentId: string) {
  await requireProjectAccess(slug);
  const map = getMindmap(slug, DRAFT_MINDMAP_ID);
  if (!map || !isPrimaryMindmap(map)) throw new Error("Primary mindmap is missing.");
  const existing = map.nodes.find((node) => node.todoId === todoId);
  if (existing) {
    if (existing.parentId === parentId) return { todoId, parentId, nodeId: existing.id };
    const next = applyMindmapAction(map, { type: "reparent", id: existing.id, parentId });
    saveMindmap(slug, next.mindmap, map.diskHash);
    bust(slug);
    return { todoId, parentId, nodeId: existing.id };
  }
  const next = applyMindmapAction(map, { type: "add-node", parentId, id: newNodeId(), todoId });
  saveMindmap(slug, next.mindmap, map.diskHash);
  bust(slug);
  return { todoId, parentId, nodeId: next.selectedId };
}

export async function previewConversionAction(
  slug: string,
  filePath: string,
  source = "",
  to = "html5",
  expandProject = false,
) {
  await requireProjectAccess(slug);
  const cwd = texPaths(projectContentDir(slug)).manuscriptDir;
  const preview = await previewManuscriptConversion({
    projectId: slug,
    manuscriptDir: cwd,
    filePath,
    source,
    to,
    expandProject,
  });
  if (!preview.ok) throw new Error(preview.message);
  const plan = preview.plan;
  return {
    id: plan.id,
    filePath: plan.filePath,
    toFormat: plan.toFormat,
    loss: plan.artifact.loss,
    diagnostics: plan.artifact.diagnostics,
    unsupported: plan.artifact.unsupported,
    sourceHash: plan.artifact.sourceHash,
    sourceFileHash: plan.artifact.sourceFileHash,
    outputHash: plan.artifact.outputHash,
    output: plan.artifact.output,
    expandMethod: plan.artifact.expandMethod,
  };
}

export async function applyConversionAction(slug: string, planId: string, expectedHash: string, acknowledgeLoss: boolean, dryRun = false) {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Conversion");
  const manuscriptDir = texPaths(projectContentDir(slug)).manuscriptDir;
  const plan = getConversionPlan(planId, manuscriptDir);
  if (!plan || plan.projectId !== slug) {
    return { ok: false as const, code: "invalid_arguments", message: "Unknown conversion plan.", retryable: false };
  }
  if (!expectedHash || plan.artifact.sourceHash !== expectedHash) {
    return { ok: false as const, code: "stale_disk_state", message: "Conversion plan is stale.", retryable: true, currentHash: plan.artifact.sourceHash };
  }
  const result = await applyConversionWrite({
    manuscriptDir,
    filePath: plan.filePath,
    output: plan.artifact.output,
    loss: plan.artifact.loss,
    acknowledgeLoss,
    expectedSourceFileHash: plan.artifact.sourceFileHash,
    expectedSourceBundleHash: plan.artifact.sourceBundleHash,
    expectedExpandedSourceHash: plan.artifact.sourceHash,
    expandProject: plan.artifact.expandMethod !== "none",
    dryRun,
  });
  if (result.ok && !dryRun) bust(slug);
  return result;
}

export async function readDocumentAction(slug: string, kind: "wiki", id: string) {
  await requireProjectAccess(slug);
  const document = readDocument(projectContentDir(slug), kind, id);
  return document ? { ...document, bodyHash: document.hash, hash: document.stateHash } : null;
}

export async function patchDocumentAction(
  slug: string,
  kind: "wiki",
  id: string,
  baseHash: string,
  body: string,
) {
  await requireProjectAccess(slug);
  const next = patchDocument(projectContentDir(slug), kind, id, baseHash, body);
  bust(slug);
  return { ...next, bodyHash: next.hash, hash: next.stateHash };
}

/** One CAS keeps wiki body and visible metadata in sync for web and WebMCP edits. */
export async function patchWikiPageAction(
  slug: string,
  id: string,
  baseHash: string,
  body: string,
  metadata: unknown,
) {
  await requireProjectAccess(slug);
  if (!/^[a-f0-9]{64}$/i.test(baseHash)) throw new Error("Wiki page hash is invalid.");
  if (typeof body !== "string" || body.length > 1_000_000) throw new Error("Wiki page body is too large.");
  const parsed = wikiMetadataPatchSchema.safeParse(metadata);
  if (!parsed.success) throw new Error(parsed.error.issues.map((issue) => issue.message).join("; "));
  const current = getWikiPage(slug, id);
  if (!current) throw new Error(`Unknown wiki page: ${id}`);
  const { body: _body, bodyHash: _bodyHash, stateHash: _stateHash, ...currentMetadata } = current;
  const next = patchDocumentState(
    projectContentDir(slug),
    "wiki",
    id,
    baseHash,
    {
      ...currentMetadata,
      ...parsed.data,
      projectId: slug,
      slug: id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    },
    body,
  );
  bust(slug);
  const updated = getWikiPage(slug, id);
  if (!updated) throw new Error(`Updated wiki page could not be read: ${id}`);
  return { page: updated, hash: next.stateHash };
}

export async function renderPreviewAction(slug: string, kind: "wiki", id: string) {
  await requireProjectAccess(slug);
  const page = getWikiPage(slug, id);
  const document = readDocument(projectContentDir(slug), kind, id);
  return {
    format: "markdown" as const,
    body: document?.markdown || page?.body || "",
    hash: document?.stateHash,
  };
}

export async function saveWikiAction(page: WikiPage): Promise<WikiPage> {
  await requireProjectAccess(page.projectId);
  if (getWikiPage(page.projectId, page.slug)) {
    throw new Error("A wiki page with this slug already exists. Open it and save with its current hash.");
  }
  saveWikiPage(page);
  bust(page.projectId);
  const created = getWikiPage(page.projectId, page.slug);
  if (!created) throw new Error("Wiki page could not be read after create.");
  return created;
}

export async function persistPaperTodoAction(
  slug: string,
  operation: SourceOperation,
  expectedBundleHash?: string,
) {
  await requireProjectAccess(slug);
  const result = persistPaperTodoOperation({
    manuscriptDir: texPaths(projectContentDir(slug)).manuscriptDir,
    operation,
    expectedBundleHash,
  });
  if (result.ok) bust(slug);
  return result;
}

export async function insertPaperTodoAtSectionAction(
  slug: string,
  sectionId: string,
  text: string,
  expectedBundleHash?: string,
  title?: string,
) {
  await requireProjectAccess(slug);
  const manuscriptDir = texPaths(projectContentDir(slug)).manuscriptDir;
  const bundle = buildSourceBundle(manuscriptDir);
  const inserted = insertTodoAtSection(bundle.source, sectionId, text, undefined, title);
  if (!inserted.sectionFound || inserted.error) {
    return {
      ok: false as const,
      code: inserted.sectionFound ? "invalid_tex" : "unknown_section",
      message: inserted.error || `Unknown paper section id "${sectionId}".`,
      retryable: false,
    };
  }
  const result = persistSourceBundle({
    manuscriptDir,
    nextSource: inserted.source,
    expectedBundleHash: expectedBundleHash ?? bundle.bundleHash,
  });
  if (result.ok) bust(slug);
  return { ...result, id: inserted.id };
}

export async function previewPaperTodoPlacementAction(
  slug: string,
  sectionId: string,
  text: string,
  title?: string,
  id?: string,
) {
  await requireProjectAccess(slug);
  return previewPaperTodoPlacement({
    manuscriptDir: texPaths(projectContentDir(slug)).manuscriptDir,
    sectionId,
    text,
    title,
    id,
  });
}

export async function persistPaperTodoPlacementAction(
  slug: string,
  sectionId: string,
  text: string,
  title?: string,
  id?: string,
  expectedBundleHash?: string,
) {
  await requireProjectAccess(slug);
  const result = persistPaperTodoPlacement({
    manuscriptDir: texPaths(projectContentDir(slug)).manuscriptDir,
    sectionId,
    text,
    title,
    id,
    expectedBundleHash,
  });
  if (result.ok) bust(slug);
  return result;
}

export async function relocatePaperTodoAction(
  slug: string,
  todoId: string,
  sectionId: string,
  expectedBundleHash?: string,
) {
  await requireProjectAccess(slug);
  const result = relocatePaperTodo({
    manuscriptDir: texPaths(projectContentDir(slug)).manuscriptDir,
    todoId,
    sectionId,
    expectedBundleHash,
  });
  if (result.ok) bust(slug);
  return result;
}

export async function convertMindmapCardToTodoAction(
  slug: string,
  mindmap: Mindmap,
  cardId: string,
  sectionId: string,
  expectedMapDiskHash?: string,
  expectedBundleHash?: string,
  requestId?: string,
): Promise<MindmapTodoConversionResult> {
  await requireProjectAccess(slug);
  const current = normalizeMindmapForSave(slug, mindmap);
  const local = await convertMindmapCardToTodo({
    projectDir: projectContentDir(slug),
    slug,
    mindmap: current,
    cardId,
    sectionId,
    expectedMapDiskHash,
    expectedBundleHash,
    requestId,
  });
  if (!local.ok) {
    const failure: MindmapTodoConversionFailure = {
      ...local,
      local: {
        paper: "failed",
        map: "not_attempted",
        message: local.message,
      },
      remote: {
        status: "failed",
        code: "not_attempted",
        message: "Remote sync was not attempted because the local conversion did not complete.",
        retryable: false,
      },
    };
    return failure;
  }

  // Local durability is the user-visible success boundary. A remote failure
  // leaves this result intact and can be retried independently.
  bust(slug);
  let remote: MindmapTodoConversion["remote"];
  try {
    const pushed = await commitAndPushProjectAction(slug, "OpenBar: convert mindmap card to paper TODO");
    remote = remoteSyncResult(pushed);
  } catch (error) {
    remote = {
      status: "failed",
      code: "remote_sync_failed",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  }
  return okResult({
    todoId: local.value.todoId,
    mindmap: local.value.mindmap,
    local: local.value.local,
    remote,
  }, { revision: local.value.mindmap.revision, diskHash: local.value.mindmap.diskHash });
}

export async function removePaperTodoAction(slug: string, todoId: string, expectedBundleHash?: string) {
  await requireProjectAccess(slug);
  const manuscriptDir = texPaths(projectContentDir(slug)).manuscriptDir;
  const bundle = buildSourceBundle(manuscriptDir);
  const todo = analyzePaper(bundle.source).todos.find((item) => item.id === todoId);
  if (!todo) throw new Error(`Unknown TODO "${todoId}".`);
  // TeX owns the TODO lifecycle. Referencing cards remain in their maps so
  // their hierarchy and descendants stay available for repair or conversion.
  const result = persistPaperTodoOperation({
    manuscriptDir,
    operation: { type: "replace_range", from: todo.start, to: todo.end, text: "" },
    expectedBundleHash: expectedBundleHash ?? bundle.bundleHash,
  });
  if (!result.ok) return result;
  bust(slug);
  return result;
}

export async function deleteWikiPageAction(slug: string, pageSlug: string, expectedHash: string) {
  await requireProjectAccess(slug);
  const page = getWikiPage(slug, pageSlug);
  if (!page) throw new Error(`Unknown wiki page: ${pageSlug}`);
  if (page.stateHash !== expectedHash) throw new Error(`Wiki page changed on disk. Reload before deleting it.`);
  deleteWikiPage(slug, pageSlug, expectedHash);
  bust(slug);
}

export async function renameWikiPageAction(slug: string, fromSlug: string, toSlug: string, expectedHash: string) {
  await requireProjectAccess(slug);
  const page = getWikiPage(slug, fromSlug);
  if (!page) throw new Error(`Unknown wiki page: ${fromSlug}`);
  if (page.stateHash !== expectedHash) throw new Error(`Wiki page changed on disk. Reload before renaming it.`);
  const renamed = renameWikiPage(slug, fromSlug, toSlug, expectedHash);
  bust(slug);
  return renamed;
}

export async function writeAgentsMdAction(slug: string, body: string, expectedHash?: string) {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Project instructions");
  const result = writeAgentsMd(projectContentDir(slug), body, expectedHash);
  bust(slug);
  return result;
}

export async function writeProjectSkillAction(
  slug: string,
  spec: { id: string; name?: string; description?: string; body: string },
  expectedHash?: string,
) {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Project skills");
  const skill = writeProjectSkill(projectContentDir(slug), spec, expectedHash);
  bust(slug);
  return skill;
}

export async function deleteProjectSkillAction(slug: string, id: string, expectedHash: string) {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Project skills");
  deleteProjectSkill(projectContentDir(slug), id, "project", expectedHash);
  bust(slug);
}

export async function writeWorkspaceAgentsMdAction(body: string, expectedHash?: string) {
  await requireWorkbenchAccess();
  assertAdministrativeWriteAllowed("Workspace instructions");
  return writeAgentsMd(workspaceRoot(), body, expectedHash);
}

export async function writeWorkspaceSkillAction(
  spec: { id: string; name?: string; description?: string; body: string },
  expectedHash?: string,
) {
  await requireWorkbenchAccess();
  assertAdministrativeWriteAllowed("Workspace skills");
  return writeWorkspaceSkill(spec, expectedHash);
}

export async function deleteWorkspaceSkillAction(id: string, expectedHash: string) {
  await requireWorkbenchAccess();
  assertAdministrativeWriteAllowed("Workspace skills");
  deleteWorkspaceSkill(id, expectedHash);
}
