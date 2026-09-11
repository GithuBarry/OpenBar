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
import { after } from "next/server";

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
} from "@/lib/store";
import {
  Mindmap,
  Project,
  WikiPage,
} from "@/lib/types";
import { getPaperCompileStatus, requestPaperCompile } from "@/lib/tex-project/compile";
import { synctexEdit, synctexView } from "@/lib/tex-project/synctex";
import { FIGURE_MAX_BYTES, uploadFigureAsset, texPaths, readDocument, DRAFT_MINDMAP_ID, resolveMindmapStorageIdentity } from "@/lib/tex-project/project";
import { persistSourceBundle, applyConversionWrite } from "@/lib/tex-project/source-persist";
import { syncProjectCommand } from "@/lib/research/sync-project-command";
import { getOverleafSyncDetails, prepareForceSync, confirmForceSync, finishForceSync, type ForceSyncDirection, prepareOverleafPull, finishOverleafPull, type OverleafConflictChoice, commitOverleafGit, getProjectGitHistory, getOverleafGitStatus, pullOverleafGit, pushOverleafGit, refreshOverleafGitStatus, syncOverleafGit } from "@/lib/tex-project/overleaf-git";
import { inspectRepository } from "@/lib/tex-project/source-graph";
import { getConversionPlan, previewManuscriptConversion } from "@/lib/tex-project/pandoc";
import { getRuntimeCapabilities } from "@/lib/research/capabilities";
import { okResult, type OperationResult } from "@/lib/research/operation-result";
import { getProjectState, projectStateForAgent, resolveProjectNavigation, searchProject } from "@/lib/research/project-state";
import { ensureCommentId } from "@/lib/research/paper-analysis";
import { isPrimaryMindmap } from "@/lib/research/todo-map";
import type { MindmapTodoConversionFailure, MindmapTodoConversionResult } from "@/lib/research/webmcp-mindmap-contract";
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
import { scheduleRemoteSyncAfterResponse } from "@/lib/research/project-sync";
import { applyMindmapAction, newNodeId } from "@/features/mindmap/mindmap-state";
import { analyzePaper } from "@/lib/research/paper-analysis";
import type { SourceOperation } from "@/lib/research/operations";
import { buildSourceBundle } from "@/lib/tex-project/source-bundle";
import { stableJson } from "@/lib/tex-project/codec";
import { requireProjectAccess, requireWorkbenchAccess } from "@/lib/server/project-access";
import { assertAdministrativeWriteAllowed, isPublicDemoMode } from "@/lib/server/demo-mode";
import { normalizeMindmap, mindmapDiskHash } from "@/lib/mindmap/mindmap";
import { assertUniqueMindmapTodoIds } from "@/lib/mindmap-index";
import { normalizeMindmapLabels } from "@/lib/mindmap/node-metadata";
import { normalizeMindmapProgress } from "@/lib/mindmap/progress";
import { appendActivity, type ActivityChange } from "@/lib/research/activity-log";
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

function recordActivity(
  slug: string,
  event: Omit<Parameters<typeof appendActivity>[1], "actor">,
): void {
  try {
    appendActivity(projectContentDir(slug), { projectId: slug, ...event, actor: "human" });
  } catch (error) {
    // The authored operation already reached local storage. Keep the durable
    // write receipt useful when activity storage is temporarily unavailable.
    console.warn("OpenBar activity record failed", error instanceof Error ? error.message : String(error));
  }
}

/** Wiki storage remains readable while its dormant mutation surface is unavailable. */
class CapabilityUnavailableError extends Error {
  readonly code = "capability_unavailable" as const;

  constructor(message: string) {
    super(message);
    this.name = "CapabilityUnavailableError";
  }
}

function wikiMutationUnavailable(): never {
  throw new CapabilityUnavailableError("Wiki editing is currently unavailable. Use paper TODOs for actionable work.");
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

const MINDMAP_ACTIVITY_NODE_FIELDS = [
  "title",
  "text",
  "caption",
  "todoId",
  "parentId",
  "order",
  "shape",
  "color",
  "tags",
  "progress",
  "priority",
  "tableLayout",
  "refs",
  "metadata",
  "contentFormat",
] as const;

function activityValuesEqual(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function mindmapNodeActivitySnapshot(node: Mindmap["nodes"][number]): Record<string, unknown> {
  return Object.fromEntries(
    MINDMAP_ACTIVITY_NODE_FIELDS
      .filter((field) => node[field] !== undefined)
      .map((field) => [field, node[field]]),
  );
}

/** Describe the authored map fields that changed while keeping one save event bounded. */
function mindmapActivityChanges(before: Mindmap | null, after: Mindmap): ActivityChange[] {
  const changes: ActivityChange[] = [];
  for (const field of ["title", "activityWindowDays"] as const) {
    if (!activityValuesEqual(before?.[field], after[field])) {
      changes.push({ field, before: before?.[field], after: after[field] });
    }
  }
  const beforeById = new Map((before?.nodes || []).map((node) => [node.id, node]));
  const afterById = new Map(after.nodes.map((node) => [node.id, node]));
  const nodeIds = [...new Set([...beforeById.keys(), ...afterById.keys()])].sort();
  for (const id of nodeIds) {
    const left = beforeById.get(id);
    const right = afterById.get(id);
    if (!left || !right) {
      changes.push({
        field: `node:${id}`,
        ...(left ? { before: mindmapNodeActivitySnapshot(left) } : {}),
        ...(right ? { after: mindmapNodeActivitySnapshot(right) } : {}),
      });
    } else {
      for (const field of MINDMAP_ACTIVITY_NODE_FIELDS) {
        if (!activityValuesEqual(left[field], right[field])) {
          changes.push({ field: `node:${id}.${field}`, before: left[field], after: right[field] });
        }
        if (changes.length >= 50) break;
      }
    }
    if (changes.length >= 50) break;
  }
  return changes.slice(0, 50);
}

export async function saveProjectAction(project: Project, expectedHash = project.diskHash): Promise<void> {
  await requireProjectAccess(project.slug);
  assertAdministrativeWriteAllowed("Project metadata changes");
  saveProject(project, expectedHash);
  recordActivity(project.slug, {
    operation: "update_project",
    resources: [{ kind: "project", id: project.slug }],
    title: project.title,
    href: `/p/${encodeURIComponent(project.slug)}/paper`,
  });
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
    const currentHash = current.diskHash || mindmapDiskHash(current);
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
  const beforeNodes = new Map((current?.nodes || []).map((node) => [node.id, node]));
  const afterNodes = new Map(next.nodes.map((node) => [node.id, node]));
  const changedNodeIds = [...new Set([
    ...beforeNodes.keys(),
    ...afterNodes.keys(),
  ])]
    .filter((id) => {
      const beforeNode = beforeNodes.get(id);
      const afterNode = afterNodes.get(id);
      if (!beforeNode || !afterNode) return true;
      return MINDMAP_ACTIVITY_NODE_FIELDS.some((field) => !activityValuesEqual(beforeNode[field], afterNode[field]));
    })
    .sort()
    .slice(0, 48);
  const mapTitle = next.title || next.id || "Mindmap";
  const activityTitle = changedNodeIds.length === 1
    ? `${mapTitle} · ${afterNodes.get(changedNodeIds[0])?.title?.trim() || changedNodeIds[0]}`
    : changedNodeIds.length > 1
      ? `${mapTitle} · ${changedNodeIds.length} cards changed`
      : mapTitle;
  recordActivity(slug, {
    operation: "save_mindmap",
    resources: [
      { kind: "mindmap", id: next.id || DRAFT_MINDMAP_ID, mapId: next.id || DRAFT_MINDMAP_ID },
      ...changedNodeIds.map((id) => ({ kind: "mindmap-node", id, mapId: next.id || DRAFT_MINDMAP_ID })),
    ],
    title: activityTitle,
    href: `/p/${encodeURIComponent(slug)}/mindmap${next.id && !isPrimaryMindmap(next) ? `/${encodeURIComponent(next.id)}` : ""}`,
    changes: mindmapActivityChanges(current, next),
  });
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

/** Read cached Git change details without modifying the checkout. */
export async function getProjectSyncDetailsAction(slug: string) {
  await requireProjectAccess(slug);
  return getOverleafSyncDetails(projectContentDir(slug));
}

/** Bring a clean checkout forward using Git's fast-forward rule. */
export async function pullProjectUpdatesAction(slug: string) {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Git pull");
  const result = await pullOverleafGit(projectContentDir(slug));
  if (result.ok) bust(slug);
  return result;
}

export async function getProjectGitHistoryAction(slug: string, since?: string, limit = 40) {
  await requireProjectAccess(slug);
  return getProjectGitHistory(projectContentDir(slug), since, limit);
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

/** Save the accepted manuscript/OpenBar paths into a local commit without network access. */
export async function commitProjectAction(slug: string, message?: string) {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Git local commit");
  const result = await commitOverleafGit(projectContentDir(slug), message?.trim() || `OpenBar: save ${slug}`);
  if (result.ok) bust(slug);
  return result;
}

/** Push an existing local commit to the explicit validated Git branch. */
export async function syncProjectAction(slug: string, commitHash?: string) {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Git remote synchronization");
  const result = await syncOverleafGit(projectContentDir(slug), commitHash);
  if (result.ok) bust(slug);
  return result;
}

export async function createMindmapAction(slug: string, title: string): Promise<{ id: string; title: string }> {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Mindmap creation");
  const map = createMindmap(slug, title);
  recordActivity(slug, {
    operation: "create_mindmap",
    resources: [{ kind: "mindmap", id: map.id || title, mapId: map.id || title }],
    title: map.title || title,
    href: `/p/${encodeURIComponent(slug)}/mindmap/${encodeURIComponent(map.id || title)}`,
  });
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
  recordActivity(slug, {
    operation: "delete_mindmap",
    resources: [{ kind: "mindmap", id, mapId: id }],
    title: id,
    href: `/p/${encodeURIComponent(slug)}/mindmap/${encodeURIComponent(id)}`,
    deleted: true,
  });
  bust(slug);
}

export async function getEditablePaperAction(slug: string) {
  await requireProjectAccess(slug);
  return getPaperEditorState(slug);
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
  if (result.ok && !dryRun) {
    recordActivity(slug, {
      operation: "save_paper_source",
      resources: [{ kind: "paper", id: "source" }],
      title: "Paper source",
      href: `/p/${encodeURIComponent(slug)}/paper`,
    });
    bust(slug);
  }
  return result;
}

export async function renamePaperSectionAction(slug: string, id: string, title: string) {
  await requireProjectAccess(slug);
  renameEditablePaperSection(slug, id, title);
  recordActivity(slug, {
    operation: "rename_paper_section",
    resources: [{ kind: "paper-section", id }],
    title,
    href: `/p/${encodeURIComponent(slug)}/paper#${encodeURIComponent(id)}`,
    changes: [{ field: "title", after: title }],
  });
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
  recordActivity(slug, {
    operation: "edit_paper_section_heading",
    resources: [{ kind: "paper-section", id }],
    title: id,
    href: `/p/${encodeURIComponent(slug)}/paper#${encodeURIComponent(id)}`,
    changes: Object.entries(heading).map(([field, after]) => ({ field, after })),
  });
  bust(slug);
  return getPaperEditorState(slug);
}

export async function addPaperSectionAction(
  slug: string,
  spec: { title: string; afterId?: string; level?: number; appendix?: boolean },
) {
  await requireProjectAccess(slug);
  const paper = addEditablePaperSection(slug, spec);
  const added = paper.sections.find((section) => section.title === spec.title) || paper.sections.at(-1);
  recordActivity(slug, {
    operation: "add_paper_section",
    resources: [{ kind: "paper-section", id: added?.id || spec.title }],
    title: added?.title || spec.title,
    href: `/p/${encodeURIComponent(slug)}/paper#${encodeURIComponent(added?.id || spec.title)}`,
  });
  bust(slug);
  return getPaperEditorState(slug);
}

export async function removePaperSectionAction(slug: string, id: string) {
  await requireProjectAccess(slug);
  removeEditablePaperSection(slug, id);
  recordActivity(slug, {
    operation: "delete_paper_section",
    resources: [{ kind: "paper-section", id }],
    title: id,
    href: `/p/${encodeURIComponent(slug)}/paper#${encodeURIComponent(id)}`,
    deleted: true,
  });
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

export async function synctexViewAction(slug: string, file: string, line: number, column = 0, artifactId?: string) {
  await requireProjectAccess(slug);
  return synctexView(projectContentDir(slug), file, line, column, artifactId);
}

export async function synctexEditAction(slug: string, page: number, x: number, y: number, artifactId?: string) {
  await requireProjectAccess(slug);
  return synctexEdit(projectContentDir(slug), page, x, y, artifactId);
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
  return state ? { ...(projectStateForAgent(state, query) as Record<string, unknown>), sync: await getOverleafSyncDetails(projectContentDir(slug)) } : null;
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
  assertAdministrativeWriteAllowed("Project metadata changes");
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
    ...(patch.engine !== undefined ? { engine: patch.engine } : {}),
    ...(patch.mainFile !== undefined ? { mainFile: patch.mainFile } : {}),
    ...(patch.texliveVersion !== undefined ? { texliveVersion: patch.texliveVersion } : {}),
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
  void slug;
  void kind;
  void id;
  void baseHash;
  void body;
  return wikiMutationUnavailable();
}

/** One CAS keeps wiki body and visible metadata in sync for web and WebMCP edits. */
export async function patchWikiPageAction(
  slug: string,
  id: string,
  baseHash: string,
  body: string,
  metadata: unknown,
) {
  void slug;
  void id;
  void baseHash;
  void body;
  void metadata;
  return wikiMutationUnavailable();
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
  void page;
  return wikiMutationUnavailable();
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
  if (result.ok) {
    const todoId = "id" in operation && typeof operation.id === "string" ? operation.id : undefined;
    recordActivity(slug, {
      operation: operation.type,
      resources: [todoId ? { kind: "paper-todo", id: todoId } : { kind: "paper", id: "source" }],
      ...(todoId ? { title: todoId, href: `/p/${encodeURIComponent(slug)}/paper#${encodeURIComponent(todoId)}` } : {}),
    });
    bust(slug);
  }
  return result;
}

export async function insertPaperTodoAtSectionAction(
  slug: string,
  sectionId: string | undefined,
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
  if (result.ok) {
    recordActivity(slug, {
      operation: "insert_paper_todo",
      resources: [{ kind: "paper-todo", id: inserted.id }, ...(inserted.sectionId ? [{ kind: "paper-section", id: inserted.sectionId }] : [])],
      title: title || text.slice(0, 120),
      href: `/p/${encodeURIComponent(slug)}/paper#${encodeURIComponent(inserted.id)}`,
    });
    bust(slug);
  }
  return { ...result, id: inserted.id };
}

export async function previewPaperTodoPlacementAction(
  slug: string,
  sectionId: string | undefined,
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
  sectionId: string | undefined,
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
  if (result.ok) {
    recordActivity(slug, {
      operation: "place_paper_todo",
      resources: [{ kind: "paper-todo", id: result.value?.id || id || "todo" }, ...(result.value?.sectionId ? [{ kind: "paper-section", id: result.value.sectionId }] : [])],
      title: title || text.slice(0, 120),
      href: `/p/${encodeURIComponent(slug)}/paper#${encodeURIComponent(result.value?.id || id || "todo")}`,
    });
    bust(slug);
  }
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
  if (result.ok) {
    recordActivity(slug, {
      operation: "relocate_paper_todo",
      resources: [{ kind: "paper-todo", id: todoId }, { kind: "paper-section", id: sectionId }],
      title: todoId,
      href: `/p/${encodeURIComponent(slug)}/paper#${encodeURIComponent(todoId)}`,
    });
    bust(slug);
  }
  return result;
}

export async function convertMindmapCardToTodoAction(
  slug: string,
  mindmap: Mindmap,
  cardId: string,
  sectionId?: string,
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
  recordActivity(slug, {
    operation: "convert_mindmap_card_to_todo",
    requestId,
    resources: [
      { kind: "paper-todo", id: local.value.todoId },
      { kind: "mindmap-node", id: cardId, mapId: current.id || DRAFT_MINDMAP_ID },
    ],
    title: local.value.todoId,
    href: `/p/${encodeURIComponent(slug)}/mindmap${current.id && !isPrimaryMindmap(current) ? `/${encodeURIComponent(current.id)}` : ""}#${encodeURIComponent(cardId)}`,
  });
  bust(slug);
  const remote = scheduleRemoteSyncAfterResponse(
    (task) => after(task),
    () => commitAndPushProjectAction(slug, "OpenBar: convert mindmap card to paper TODO"),
  );
  return okResult({
    todoId: local.value.todoId,
    mindmap: local.value.mindmap,
    local: local.value.local,
    ...(local.value.sectionId ? { sectionId: local.value.sectionId } : {}),
    ...(local.value.sourceHash ? { sourceHash: local.value.sourceHash } : {}),
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
  recordActivity(slug, {
    operation: "delete_paper_todo",
    resources: [{ kind: "paper-todo", id: todoId }],
    title: todoId,
    href: `/p/${encodeURIComponent(slug)}/paper#${encodeURIComponent(todoId)}`,
    deleted: true,
  });
  bust(slug);
  return result;
}

export async function deleteWikiPageAction(slug: string, pageSlug: string, expectedHash: string) {
  void slug;
  void pageSlug;
  void expectedHash;
  return wikiMutationUnavailable();
}

export async function renameWikiPageAction(slug: string, fromSlug: string, toSlug: string, expectedHash: string): Promise<{ slug: string }> {
  void slug;
  void fromSlug;
  void toSlug;
  void expectedHash;
  return wikiMutationUnavailable();
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

export async function prepareProjectPullAction(slug: string) {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Review Git pull");
  return prepareOverleafPull(projectContentDir(slug));
}

export async function finishProjectPullAction(slug: string, token: string, choices: OverleafConflictChoice[], cancel = false) {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Apply Git pull");
  const result = await finishOverleafPull(projectContentDir(slug), token, choices, cancel);
  if (result.ok && !cancel) bust(slug);
  return result;
}

export async function prepareForceProjectSyncAction(slug: string, direction: ForceSyncDirection) {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Review forced synchronization");
  return prepareForceSync(projectContentDir(slug), direction);
}
export async function confirmForceProjectSyncAction(slug: string, token: string) {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Confirm forced synchronization");
  return confirmForceSync(projectContentDir(slug), token);
}
export async function finishForceProjectSyncAction(slug: string, token: string, confirmation: string, phrase: string, cancel = false) {
  await requireProjectAccess(slug);
  assertAdministrativeWriteAllowed("Force synchronization");
  const result = await finishForceSync(projectContentDir(slug), token, confirmation, phrase, cancel);
  if (result.ok && !cancel) bust(slug);
  return result;
}

export async function syncProjectReviewAction(slug: string, input: unknown) {
  await requireProjectAccess(slug);
  const result = await syncProjectCommand(projectContentDir(slug), input);
  if (result.ok && input && typeof input === "object" && "action" in input && input.action === "apply_pull") bust(slug);
  return result;
}
