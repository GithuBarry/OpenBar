import "server-only";

import { syncProjectCommand } from "./sync-project-command";
import { syncProjectProperties } from "./sync-project-contract";
import { randomUUID } from "node:crypto";

import {
  getBibliography,
  getBibliographyRaw,
  getEditableTexPaper,
  getMindmap,
  getProject,
  listMindmaps,
  listProjects,
  projectContentDir,
  saveMindmap,
  saveProject,
} from "@/lib/store";
import type { Mindmap, MindmapNode, Project } from "@/lib/types";
import { projectStateForAgent, getProjectState, searchProject } from "./project-state";
import { readActivity, appendActivity, type ActivityChange } from "./activity-log";
import { failResult, okResult, type OperationResult, type RemoteSyncOutcome } from "./operation-result";
import { readRequestReplay, recordRequestReplay, requestFingerprint } from "./request-replay";
import { applyMindmapAction, newNodeId } from "@/features/mindmap/mindmap-state";
import { mindmapDiskHash, normalizeMindmap } from "@/lib/mindmap/mindmap";
import { normalizeMindmapLabels } from "@/lib/mindmap/node-metadata";
import { normalizeMindmapProgress } from "@/lib/mindmap/progress";
import { DRAFT_MINDMAP_ID, patchPaperSection, texPaths } from "@/lib/tex-project/project";
import { buildSourceBundle } from "@/lib/tex-project/source-bundle";
import { persistPaperTodoOperation, persistPaperTodoPlacement } from "./paper-todo-persist";
import { convertMindmapCardToTodo } from "./mindmap-todo-conversion";
import type { SourceOperation } from "./operations";
import { requestPaperCompile, getPaperCompileStatus } from "@/lib/tex-project/compile";
import { getRuntimeCapabilities } from "./capabilities";
import {
  applyMindmapBatch,
  batchTokenMatches,
  previewMindmapBatch,
  type MindmapBatchChanges,
  type MindmapBatchInput,
} from "./mindmap-batch";
import { assertAdministrativeWriteAllowed } from "@/lib/server/demo-mode";
import { getOverleafSyncDetails, commitOverleafGit, getOverleafGitStatus, syncOverleafGit } from "@/lib/tex-project/overleaf-git";

export type McpCommandContext = {
  actor: string;
  requestId?: string;
  signal?: AbortSignal;
};

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  execute: (args: unknown, context: McpCommandContext) => Promise<OperationResult<unknown>>;
};

type JsonObject = Record<string, unknown>;

const MAX_READ_CHARS = 200_000;
const MAX_PAGE_SIZE = 200;

const projectIdSchema = { type: "string", minLength: 1, description: "Project slug from list_projects." };
const mapIdSchema = { type: "string", minLength: 1, description: "Persisted map id. Use draft for the Primary map." };
const revisionSchema = { type: "integer", minimum: 0, description: "Revision returned by the last read or preview." };
const diskHashSchema = { type: "string", pattern: "^[a-f0-9]{64}$", description: "Disk hash returned by the last read." };

function objectSchema(
  properties: Record<string, unknown> = {},
  required: string[] = [],
): McpToolDefinition["inputSchema"] {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function stringArg(args: JsonObject, key: string, required = true): string | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new McpCommandError("invalid_arguments", `${key} must be a non-empty string.`, false);
  return value.trim();
}

function integerArg(args: JsonObject, key: string, required = true): number | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new McpCommandError("invalid_arguments", `${key} must be an integer.`, false);
  return value;
}

function booleanArg(args: JsonObject, key: string, required = false): boolean | undefined {
  const value = args[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "boolean") throw new McpCommandError("invalid_arguments", `${key} must be a boolean.`, false);
  return value;
}

function projectArg(args: JsonObject): string {
  const project = stringArg(args, "project");
  if (!project || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project)) throw new McpCommandError("invalid_arguments", "project must be a safe project slug.", false);
  if (!getProject(project)) throw new McpCommandError("invalid_path", `Unknown project "${project}".`, false);
  return project;
}

function mapArg(args: JsonObject): string {
  const mapId = stringArg(args, "mapId", false) || DRAFT_MINDMAP_ID;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(mapId)) throw new McpCommandError("invalid_arguments", "mapId must be a safe persisted map id.", false);
  return mapId;
}

function mapRequired(project: string, mapId: string): Mindmap {
  const map = getMindmap(project, mapId);
  if (!map) throw new McpCommandError("invalid_path", `Unknown mindmap "${mapId}" in project "${project}".`, false);
  return map;
}

function assertRevision(map: Mindmap, expected: number | undefined): void {
  if (expected === undefined) throw new McpCommandError("invalid_arguments", "expectedRevision is required for a map write.", false);
  const current = map.revision ?? 0;
  if (expected !== current) throw new McpCommandError("stale_disk_state", `Mindmap revision is ${current}, not ${expected}. Read the map again before applying the operation.`, true, current, map.diskHash);
}

function assertDiskHash(map: Mindmap, expected: string | undefined): void {
  if (expected !== undefined && expected !== map.diskHash) {
    throw new McpCommandError("stale_disk_state", "Mindmap disk hash changed. Read the map again before applying the operation.", true, map.revision ?? 0, map.diskHash);
  }
}

function assertPaperHash(current: string, expected: string | undefined): void {
  if (expected !== undefined && expected !== current) {
    throw new McpCommandError("stale_disk_state", "Paper source changed. Read it again before applying the operation.", true, undefined, current);
  }
}

function pendingRemote(): RemoteSyncOutcome {
  return {
    status: "pending",
    message: "Saved locally. Run sync_git to attempt the validated Overleaf remote.",
    retryable: true,
  };
}

function requestIdFor(args: JsonObject, context: McpCommandContext): string {
  const provided = typeof args.requestId === "string" ? args.requestId.trim() : "";
  return provided || context.requestId || randomUUID();
}

function receipt(input: {
  requestId: string;
  operation: string;
  resources: Array<{ kind: string; id: string; mapId?: string }>;
  revision?: number;
  diskHash?: string;
  value?: unknown;
}) {
  return {
    requestId: input.requestId,
    operation: input.operation,
    resources: input.resources,
    local: {
      status: "persisted" as const,
      ...(input.revision === undefined ? {} : { revision: input.revision }),
      ...(input.diskHash ? { diskHash: input.diskHash } : {}),
    },
    remote: pendingRemote(),
    ...(input.value === undefined ? {} : { value: input.value }),
  };
}

function activityChanges(before: unknown, after: unknown, fields: string[]): ActivityChange[] {
  const left = before && typeof before === "object" ? before as JsonObject : {};
  const right = after && typeof after === "object" ? after as JsonObject : {};
  return fields
    .filter((field) => JSON.stringify(left[field]) !== JSON.stringify(right[field]))
    .map((field) => ({ field, before: left[field], after: right[field] }));
}

function recordWebMcpActivity(
  project: string,
  context: McpCommandContext,
  input: {
    operation: string;
    resources: Array<{ kind: string; id: string; mapId?: string }>;
    changes?: ActivityChange[];
    title?: string;
    href?: string;
    deleted?: boolean;
  },
): void {
  try {
    appendActivity(projectContentDir(project), {
      projectId: project,
      actor: "webmcp",
      requestId: context.requestId,
      ...input,
    });
  } catch (error) {
    console.warn("OpenBar MCP activity record failed", error instanceof Error ? error.message : String(error));
  }
}

async function idempotentWrite<T>(
  project: string,
  operation: string,
  args: JsonObject,
  context: McpCommandContext,
  write: (requestId: string) => Promise<OperationResult<T>> | OperationResult<T>,
): Promise<OperationResult<T>> {
  const requestId = requestIdFor(args, context);
  const fingerprint = requestFingerprint({ operation, args: Object.fromEntries(Object.entries(args).filter(([key]) => key !== "requestId")) });
  const existing = readRequestReplay(projectContentDir(project), requestId);
  if (existing) {
    if (existing.operation !== operation || existing.fingerprint !== fingerprint) {
      return failResult("conflict", `requestId "${requestId}" was already used for a different operation.`, { retryable: false });
    }
    return existing.result as OperationResult<T>;
  }
  const result = await write(requestId);
  if (result.ok) {
    recordRequestReplay(projectContentDir(project), {
      requestId,
      operation,
      fingerprint,
      result: result as unknown as Record<string, unknown>,
    });
  }
  return result;
}

function writeMap(
  project: string,
  map: Mindmap,
  next: Mindmap,
  requestId: string,
  operation: string,
  resources: Array<{ kind: string; id: string; mapId?: string }>,
  changes: ActivityChange[] = [],
  deleted = false,
): OperationResult<unknown> {
  const normalized = normalizeMindmap({
    ...next,
    projectId: project,
    id: map.id,
    role: map.role,
    revision: (map.revision ?? 0) + 1,
  });
  const expected = map.diskHash || mindmapDiskHash(map);
  try {
    assertAdministrativeWriteAllowed("MCP mindmap changes");
    saveMindmap(project, normalized, expected);
    const saved = getMindmap(project, map.id || DRAFT_MINDMAP_ID);
    if (!saved) return failResult("operation_failed", "Mindmap could not be read after saving.", { retryable: true });
    recordWebMcpActivity(project, { actor: "webmcp", requestId }, {
      operation,
      resources,
      changes,
      title: saved.title || saved.id || "Mindmap",
      href: `/p/${encodeURIComponent(project)}/mindmap${saved.id && saved.id !== DRAFT_MINDMAP_ID ? `/${encodeURIComponent(saved.id)}` : ""}`,
      ...(deleted ? { deleted: true } : {}),
    });
    const value = receipt({ requestId, operation, resources, revision: saved.revision ?? 0, diskHash: saved.diskHash, value: saved });
    return okResult(value, { revision: saved.revision, diskHash: saved.diskHash, remote: pendingRemote() });
  } catch (error) {
    return mutationFailure(error, map);
  }
}

function mutationFailure(error: unknown, current?: Mindmap): OperationResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  if (/root|cycle|destination|unknown|invalid|select/i.test(message)) return failResult("invalid_arguments", message, { retryable: false, currentRevision: current?.revision });
  if (/conflict|changed on disk|reload|hash|revision|stale/i.test(message)) return failResult("stale_disk_state", message, {
    retryable: true,
    currentRevision: current?.revision,
    currentHash: current?.diskHash,
  });
  if (/disabled|permission|unauthorized/i.test(message)) return failResult("permission_denied", message, { retryable: false });
  return failResult("operation_failed", message, { retryable: true, currentRevision: current?.revision });
}

class McpCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly currentRevision?: number,
    readonly currentHash?: string,
  ) {
    super(message);
  }
}

function caught(error: unknown): OperationResult<never> {
  if (error instanceof McpCommandError) {
    return failResult(error.code, error.message, {
      retryable: error.retryable,
      ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
      ...(error.currentHash ? { currentHash: error.currentHash } : {}),
    });
  }
  return failResult("operation_failed", error instanceof Error ? error.message : String(error), { retryable: true });
}

function requireArray(value: unknown, key: string): unknown[] {
  if (!Array.isArray(value)) throw new McpCommandError("invalid_arguments", `${key} must be an array.`, false);
  return value;
}

function parseSelectedIds(args: JsonObject): string[] {
  const values = requireArray(args.selectedIds, "selectedIds");
  if (!values.length || values.length > 2_000 || values.some((value) => typeof value !== "string" || !value.trim())) {
    throw new McpCommandError("invalid_arguments", "selectedIds must contain 1–2,000 card ids.", false);
  }
  return values as string[];
}

function parseChanges(value: unknown): MindmapBatchChanges | undefined {
  if (value === undefined) return undefined;
  const record = asObject(value);
  if (!record) throw new McpCommandError("invalid_arguments", "changes must be an object.", false);
  const changes: MindmapBatchChanges = {};
  if (record.priority !== undefined) {
    if (record.priority !== null && !["P0", "P1", "P2", "P3"].includes(String(record.priority))) throw new McpCommandError("invalid_arguments", "priority must be P0–P3 or null.", false);
    changes.priority = record.priority as MindmapBatchChanges["priority"];
  }
  if (record.progress !== undefined) {
    if (record.progress !== null && (typeof record.progress !== "number" || !Number.isInteger(record.progress) || record.progress < 0 || record.progress > 6)) throw new McpCommandError("invalid_arguments", "progress must be 0–6 or null.", false);
    changes.progress = record.progress as MindmapBatchChanges["progress"];
  }
  if (record.color !== undefined) {
    if (record.color !== null && (typeof record.color !== "string" || record.color.length > 80)) throw new McpCommandError("invalid_arguments", "color must be a short string or null.", false);
    changes.color = record.color as string | null;
  }
  for (const key of ["labelsAdd", "labelsRemove"] as const) {
    if (record[key] !== undefined) {
      const labels = requireArray(record[key], key);
      if (labels.length > 50 || labels.some((item) => typeof item !== "string" || !item.trim())) throw new McpCommandError("invalid_arguments", `${key} must contain non-empty strings.`, false);
      changes[key] = labels as string[];
    }
  }
  if (!Object.keys(changes).length) throw new McpCommandError("invalid_arguments", "changes must contain at least one field.", false);
  return changes;
}

function parseBatchInput(args: JsonObject): MindmapBatchInput {
  const selectedIds = parseSelectedIds(args);
  const deleteMode = args.deleteMode;
  if (deleteMode !== undefined && deleteMode !== "cards" && deleteMode !== "branches") throw new McpCommandError("invalid_arguments", "deleteMode must be cards or branches.", false);
  const moveRecord = args.move === undefined ? undefined : asObject(args.move);
  let move: MindmapBatchInput["move"];
  if (moveRecord) {
    const parentId = stringArg(moveRecord, "parentId");
    move = {
      parentId: parentId!,
      ...(moveRecord.beforeId === undefined ? {} : { beforeId: stringArg(moveRecord, "beforeId", false) }),
      ...(moveRecord.afterId === undefined ? {} : { afterId: stringArg(moveRecord, "afterId", false) }),
    };
    if (move.beforeId && move.afterId) throw new McpCommandError("invalid_arguments", "move accepts beforeId or afterId, not both.", false);
  } else if (args.move !== undefined) {
    throw new McpCommandError("invalid_arguments", "move must be an object.", false);
  }
  const changes = parseChanges(args.changes);
  return { selectedIds, ...(changes ? { changes } : {}), ...(deleteMode ? { deleteMode } : {}), ...(move ? { move } : {}) };
}

function changesForNode(before: MindmapNode, after: MindmapNode): ActivityChange[] {
  return activityChanges(before, after, ["title", "text", "parentId", "order", "color", "tags", "progress", "priority", "tableLayout", "refs", "metadata"]);
}

async function executeGetProjectState(args: unknown): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const detail = record.detail === undefined ? "summary" : record.detail;
    if (detail !== "summary" && detail !== "full") throw new McpCommandError("invalid_arguments", "detail must be summary or full.", false);
    const todoLimit = record.todoLimit === undefined ? undefined : integerArg(record, "todoLimit");
    if (todoLimit !== undefined && (todoLimit < 0 || todoLimit > 200)) throw new McpCommandError("invalid_arguments", "todoLimit must be from 0 to 200.", false);
    const state = getProjectState(project);
    return state ? okResult({ ...(projectStateForAgent(state, { detail, todoLimit }) as Record<string, unknown>), sync: await getOverleafSyncDetails(projectContentDir(project)) }) : failResult("invalid_path", `Unknown project "${project}".`, false);
  } catch (error) { return caught(error); }
}

async function executeListProjects(): Promise<OperationResult<unknown>> {
  return okResult(listProjects().map((project) => ({ slug: project.slug, id: project.id, title: project.title, tagline: project.tagline, updatedAt: project.updatedAt })));
}

async function executeSearchProject(args: unknown): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const query = stringArg(record, "query");
    return okResult({ project, query, results: searchProject(project, query!) });
  } catch (error) { return caught(error); }
}

async function executeGetMindmap(args: unknown): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const mapId = mapArg(record);
    const map = mapRequired(project, mapId);
    const offset = Math.max(0, integerArg(record, "offset", false) || 0);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, integerArg(record, "limit", false) || MAX_PAGE_SIZE));
    const nodes = map.nodes.slice(offset, offset + limit);
    return okResult({
      project,
      mapId: map.id || DRAFT_MINDMAP_ID,
      role: map.role,
      primary: map.role === "draft" || map.id === DRAFT_MINDMAP_ID,
      rootId: map.rootId,
      title: map.title,
      revision: map.revision ?? 0,
      diskHash: map.diskHash,
      offset,
      limit,
      totalNodes: map.nodes.length,
      hasMore: offset + nodes.length < map.nodes.length,
      nodes,
    }, { revision: map.revision, diskHash: map.diskHash });
  } catch (error) { return caught(error); }
}

async function executeListMindmaps(args: unknown): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    return okResult(listMindmaps(project).map((map) => ({ id: map.id || DRAFT_MINDMAP_ID, title: map.title, role: map.role, primary: map.role === "draft", revision: map.revision ?? 0, diskHash: map.diskHash, nodeCount: map.nodes.length })));
  } catch (error) { return caught(error); }
}

async function executeReadPaperSection(args: unknown): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const sectionId = stringArg(record, "sectionId");
    const paper = getEditableTexPaper(project);
    const section = paper?.sections.find((item) => item.id === sectionId);
    if (!section) throw new McpCommandError("unknown_section", `Unknown paper section "${sectionId}".`, false);
    const maxChars = Math.min(MAX_READ_CHARS, Math.max(1, integerArg(record, "maxChars", false) || MAX_READ_CHARS));
    return okResult({ project, section: { id: section.id, title: section.title, level: section.level, hash: section.hash, tex: section.tex.slice(0, maxChars), truncated: section.tex.length > maxChars } });
  } catch (error) { return caught(error); }
}

async function executeReadPaperSource(args: unknown): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const bundle = buildSourceBundle(texPaths(projectContentDir(project)).manuscriptDir);
    const offset = Math.max(0, integerArg(record, "offset", false) || 0);
    const limit = Math.min(MAX_READ_CHARS, Math.max(1, integerArg(record, "limit", false) || MAX_READ_CHARS));
    return okResult({ project, rootFile: bundle.rootFile, revision: bundle.revision, bundleHash: bundle.bundleHash, offset, limit, source: bundle.source.slice(offset, offset + limit), truncated: offset + limit < bundle.source.length, segments: bundle.segments.map((segment) => ({ filePath: segment.filePath, editable: segment.editable, fileHash: segment.fileHash })) });
  } catch (error) { return caught(error); }
}

async function executeReadWikiPage(args: unknown): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const slug = stringArg(record, "slug");
    const { getWikiPage } = await import("@/lib/store");
    const page = getWikiPage(project, slug!);
    if (!page) throw new McpCommandError("invalid_path", `Unknown wiki page "${slug}".`, false);
    return okResult(page);
  } catch (error) { return caught(error); }
}

async function executeUpdateProject(args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const projectSlug = projectArg(record);
    const expectedHash = stringArg(record, "expectedHash");
    const current = getProject(projectSlug);
    if (!current) throw new McpCommandError("invalid_path", `Unknown project "${projectSlug}".`, false);
    const next = { ...current } as Project;
    const fields = ["title", "venue", "tagline", "overview", "researchKind", "color", "icon", "label", "mainFile", "texliveVersion"] as const;
    for (const field of fields) if (record[field] !== undefined) {
      if (typeof record[field] !== "string") throw new McpCommandError("invalid_arguments", `${field} must be a string.`, false);
      (next as unknown as Record<string, unknown>)[field] = record[field];
    }
    if (record.engine !== undefined) {
      if (!["pdflatex", "xelatex", "lualatex"].includes(String(record.engine))) throw new McpCommandError("invalid_arguments", "engine must be pdflatex, xelatex, or lualatex.", false);
      next.engine = record.engine as Project["engine"];
    }
    if (record.links !== undefined) next.links = record.links as Project["links"];
    if (record.collaborators !== undefined) next.collaborators = requireArray(record.collaborators, "collaborators") as string[];
    if (record.archivedAt !== undefined) next.archivedAt = record.archivedAt === null ? undefined : String(record.archivedAt);
    return idempotentWrite(projectSlug, "update_project", record, context, (requestId) => {
      assertAdministrativeWriteAllowed("MCP project changes");
      saveProject({ ...next, updatedAt: new Date().toISOString() }, expectedHash);
      const saved = getProject(projectSlug);
      if (!saved) return failResult("operation_failed", "Project could not be read after saving.", { retryable: true });
      recordWebMcpActivity(projectSlug, { ...context, requestId }, { operation: "update_project", resources: [{ kind: "project", id: projectSlug }], changes: activityChanges(current, saved, fields as unknown as string[]), title: saved.title, href: `/p/${encodeURIComponent(projectSlug)}/paper` });
      return okResult(receipt({ requestId, operation: "update_project", resources: [{ kind: "project", id: projectSlug }], diskHash: saved.diskHash, value: saved }), { diskHash: saved.diskHash, remote: pendingRemote() });
    });
  } catch (error) { return caught(error); }
}

async function executePatchMindmapNode(args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const mapId = mapArg(record);
    const expectedRevision = integerArg(record, "expectedRevision");
    const nodeId = stringArg(record, "id");
    const map = mapRequired(project, mapId);
    assertRevision(map, expectedRevision);
    assertDiskHash(map, typeof record.expectedDiskHash === "string" ? record.expectedDiskHash : undefined);
    const current = map.nodes.find((node) => node.id === nodeId);
    if (!current) throw new McpCommandError("invalid_arguments", `Unknown mindmap card "${nodeId}".`, false);
    const patch: Record<string, unknown> = {};
    for (const key of ["title", "text", "shape", "metadata", "contentFormat", "tableLayout", "color", "refs"] as const) if (record[key] !== undefined) patch[key] = record[key];
    if (record.labels !== undefined) patch.tags = normalizeMindmapLabels(requireArray(record.labels, "labels") as string[]);
    if (record.progress !== undefined) patch.progress = record.progress === null ? undefined : normalizeMindmapProgress(record.progress);
    if (record.priority !== undefined) {
      if (record.priority !== null && !["P0", "P1", "P2", "P3"].includes(String(record.priority))) throw new McpCommandError("invalid_arguments", "priority must be P0–P3 or null.", false);
      patch.priority = record.priority || undefined;
    }
    if (current.todoId && (patch.title !== undefined || patch.text !== undefined)) throw new McpCommandError("invalid_arguments", "TODO title and text are TeX-owned. Use update_todo.", false);
    if (!Object.keys(patch).length) throw new McpCommandError("invalid_arguments", "Provide at least one card field.", false);
    const next = applyMindmapAction(map, { type: "patch-node", id: nodeId!, patch: patch as never }).mindmap;
    const requestArgs = { ...record, project, mapId };
    return idempotentWrite(project, "patch_mindmap_node", requestArgs, context, (requestId) => writeMap(project, map, next, requestId, "patch_mindmap_node", [{ kind: "mindmap-node", id: nodeId!, mapId }], changesForNode(current, next.nodes.find((node) => node.id === nodeId)!)));
  } catch (error) { return caught(error); }
}

async function executeAddMindmapNode(args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const mapId = mapArg(record);
    const expectedRevision = integerArg(record, "expectedRevision");
    const parentId = stringArg(record, "parentId");
    const map = mapRequired(project, mapId);
    assertRevision(map, expectedRevision);
    assertDiskHash(map, typeof record.expectedDiskHash === "string" ? record.expectedDiskHash : undefined);
    if (!map.nodes.some((node) => node.id === parentId)) throw new McpCommandError("invalid_arguments", `Unknown parent card "${parentId}".`, false);
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : newNodeId();
    const next = applyMindmapAction(map, { type: "add-node", id, parentId: parentId!, title: typeof record.title === "string" ? record.title : undefined, text: typeof record.text === "string" ? record.text : "" }).mindmap;
    return idempotentWrite(project, "add_mindmap_node", { ...record, project, mapId, id }, context, (requestId) => writeMap(project, map, next, requestId, "add_mindmap_node", [{ kind: "mindmap-node", id, mapId }], [{ field: "added", after: id }]));
  } catch (error) { return caught(error); }
}

async function executeMoveMindmapNode(args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const mapId = mapArg(record);
    const expectedRevision = integerArg(record, "expectedRevision");
    const id = stringArg(record, "id");
    const parentId = stringArg(record, "parentId");
    const map = mapRequired(project, mapId);
    assertRevision(map, expectedRevision);
    assertDiskHash(map, typeof record.expectedDiskHash === "string" ? record.expectedDiskHash : undefined);
    const current = map.nodes.find((node) => node.id === id);
    if (!current) throw new McpCommandError("invalid_arguments", `Unknown mindmap card "${id}".`, false);
    const next = applyMindmapAction(map, { type: "reparent", id: id!, parentId: parentId!, beforeId: typeof record.beforeId === "string" ? record.beforeId : undefined, afterId: typeof record.afterId === "string" ? record.afterId : undefined }).mindmap;
    if (next === map) throw new McpCommandError("invalid_arguments", "The requested move is invalid or would create a cycle.", false);
    return idempotentWrite(project, "move_mindmap_node", record, context, (requestId) => writeMap(project, map, next, requestId, "move_mindmap_node", [{ kind: "mindmap-node", id: id!, mapId }], changesForNode(current, next.nodes.find((node) => node.id === id)!)));
  } catch (error) { return caught(error); }
}

async function executePreviewMindmapBatch(args: unknown): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const mapId = mapArg(record);
    const map = mapRequired(project, mapId);
    assertRevision(map, integerArg(record, "expectedRevision"));
    assertDiskHash(map, typeof record.expectedDiskHash === "string" ? record.expectedDiskHash : undefined);
    return okResult({ project, mapId, ...previewMindmapBatch(map, parseBatchInput(record)) }, { revision: map.revision, diskHash: map.diskHash });
  } catch (error) { return caught(error); }
}

async function executeApplyMindmapBatch(args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const mapId = mapArg(record);
    const map = mapRequired(project, mapId);
    assertRevision(map, integerArg(record, "expectedRevision"));
    assertDiskHash(map, typeof record.expectedDiskHash === "string" ? record.expectedDiskHash : undefined);
    const previewToken = stringArg(record, "previewToken");
    const batch = parseBatchInput(record);
    if (!batchTokenMatches(map, batch, previewToken!)) throw new McpCommandError("stale_selection", "The batch preview is stale. Recompute the preview against the current map revision.", true, map.revision ?? 0, map.diskHash);
    const result = applyMindmapBatch(map, batch);
    const resources = result.preview.affectedNodeIds.map((id) => ({ kind: "mindmap-node", id, mapId }));
    const changes = result.preview.removedNodeIds.length ? [{ field: "removedNodeIds", after: result.preview.removedNodeIds }] : [];
    return idempotentWrite(project, "apply_mindmap_batch", record, context, (requestId) => writeMap(project, map, result.mindmap, requestId, "apply_mindmap_batch", resources, changes, Boolean(batch.deleteMode)));
  } catch (error) { return caught(error); }
}

async function executeDeleteMindmap(args: unknown, context: McpCommandContext, mode: "cards" | "branches"): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  return executeApplyMindmapBatch({ ...record, selectedIds: [record.id], deleteMode: mode }, context);
}

async function executePaperPatch(args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const sectionId = stringArg(record, "sectionId");
    const tex = typeof record.tex === "string" ? record.tex : undefined;
    if (tex === undefined) throw new McpCommandError("invalid_arguments", "tex must be a string.", false);
    const baseHash = stringArg(record, "baseHash");
    const current = getEditableTexPaper(project)?.sections.find((section) => section.id === sectionId);
    if (!current) throw new McpCommandError("unknown_section", `Unknown paper section "${sectionId}".`, false);
    if (current.hash !== baseHash) throw new McpCommandError("stale_disk_state", "Paper section changed. Read it again before saving.", true, undefined, current.hash);
    return idempotentWrite(project, "patch_paper_section", record, context, (requestId) => {
      try {
        assertAdministrativeWriteAllowed("MCP paper changes");
        const saved = patchPaperSection(projectContentDir(project), sectionId!, baseHash!, tex, { level: typeof record.level === "number" ? record.level : undefined, appendix: typeof record.appendix === "boolean" ? record.appendix : undefined });
        const value = receipt({ requestId, operation: "patch_paper_section", resources: [{ kind: "paper-section", id: sectionId! }], diskHash: saved.hash, value: { id: saved.id, title: saved.title, hash: saved.hash, tex: saved.tex } });
        recordWebMcpActivity(project, { ...context, requestId }, { operation: "patch_paper_section", resources: [{ kind: "paper-section", id: sectionId! }], changes: [{ field: "tex", after: tex }], title: saved.title, href: `/p/${encodeURIComponent(project)}/paper#${encodeURIComponent(sectionId!)}` });
        return okResult(value, { diskHash: saved.hash, remote: pendingRemote() });
      } catch (error) { return caught(error); }
    });
  } catch (error) { return caught(error); }
}

async function executeAddTodo(args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const sectionId = stringArg(record, "sectionId");
    const text = stringArg(record, "text");
    const title = stringArg(record, "title", false);
    const expectedBundleHash = stringArg(record, "expectedBundleHash");
    return idempotentWrite(project, "add_paper_todo", record, context, async (requestId) => {
      try {
        assertAdministrativeWriteAllowed("MCP paper TODO changes");
        const result = persistPaperTodoPlacement({ manuscriptDir: texPaths(projectContentDir(project)).manuscriptDir, sectionId: sectionId!, text: text!, title, id: stringArg(record, "todoId", false), expectedBundleHash });
        if (!result.ok) return result;
        const id = (result.value as { id?: string }).id;
        const value = receipt({ requestId, operation: "add_paper_todo", resources: [{ kind: "paper-todo", id: id || "unknown" }, { kind: "paper-section", id: sectionId! }], diskHash: result.diskHash, value: result.value });
        recordWebMcpActivity(project, { ...context, requestId }, { operation: "add_paper_todo", resources: [{ kind: "paper-todo", id: id || "unknown" }, { kind: "paper-section", id: sectionId! }], title: title || text, href: `/p/${encodeURIComponent(project)}/paper#${encodeURIComponent(id || sectionId!)}` });
        return okResult(value, { revision: result.revision, diskHash: result.diskHash, remote: pendingRemote() });
      } catch (error) { return caught(error); }
    });
  } catch (error) { return caught(error); }
}

async function executeConvertCardToTodo(args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const mapId = mapArg(record);
    const cardId = stringArg(record, "id");
    const expectedRevision = integerArg(record, "expectedRevision");
    const expectedMapDiskHash = stringArg(record, "expectedDiskHash", false);
    const expectedBundleHash = stringArg(record, "expectedBundleHash", false);
    const sectionId = stringArg(record, "sectionId", false);
    return idempotentWrite(project, "convert_card_to_todo", record, context, async (requestId) => {
      try {
        assertAdministrativeWriteAllowed("MCP card conversion");
        const map = mapRequired(project, mapId);
        assertRevision(map, expectedRevision);
        assertDiskHash(map, expectedMapDiskHash);
        const result = await convertMindmapCardToTodo({
          projectDir: projectContentDir(project),
          slug: project,
          mindmap: map,
          cardId: cardId!,
          ...(sectionId ? { sectionId } : {}),
          expectedMapDiskHash,
          expectedBundleHash,
          requestId,
        });
        if (!result.ok) return result;
        const resources = [
          { kind: "paper-todo", id: result.value.todoId },
          { kind: "mindmap-node", id: cardId!, mapId },
          ...(result.value.sectionId ? [{ kind: "paper-section", id: result.value.sectionId }] : []),
        ];
        const value = receipt({
          requestId,
          operation: "convert_card_to_todo",
          resources,
          revision: result.value.mindmap.revision,
          diskHash: result.value.mindmap.diskHash,
          value: {
            cardId,
            todoId: result.value.todoId,
            ...(result.value.sectionId ? { sectionId: result.value.sectionId } : {}),
            ...(result.value.file ? { file: result.value.file } : {}),
          },
        });
        recordWebMcpActivity(project, { ...context, requestId }, {
          operation: "convert_card_to_todo",
          resources,
          title: result.value.todoId,
          href: `/p/${encodeURIComponent(project)}/mindmap${mapId === DRAFT_MINDMAP_ID ? "" : `/${encodeURIComponent(mapId)}`}#${encodeURIComponent(cardId!)}`,
        });
        return okResult(value, {
          revision: result.value.mindmap.revision,
          diskHash: result.value.mindmap.diskHash,
          remote: pendingRemote(),
        });
      } catch (error) { return caught(error); }
    });
  } catch (error) { return caught(error); }
}

async function executeTodoState(args: unknown, context: McpCommandContext, completed: boolean): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const todoId = stringArg(record, "todoId");
    const expectedBundleHash = stringArg(record, "expectedBundleHash");
    return idempotentWrite(project, completed ? "complete_todo" : "reopen_todo", record, context, async (requestId) => {
      try {
        assertAdministrativeWriteAllowed("MCP TODO changes");
        const operation: SourceOperation = completed ? { type: "complete_todo", id: todoId! } : { type: "reopen_todo", id: todoId! };
        const result = persistPaperTodoOperation({ manuscriptDir: texPaths(projectContentDir(project)).manuscriptDir, operation, expectedBundleHash });
        if (!result.ok) return result;
        const value = receipt({ requestId, operation: completed ? "complete_todo" : "reopen_todo", resources: [{ kind: "paper-todo", id: todoId! }], diskHash: result.diskHash, value: { todoId, completed } });
        recordWebMcpActivity(project, { ...context, requestId }, { operation: completed ? "complete_todo" : "reopen_todo", resources: [{ kind: "paper-todo", id: todoId! }], title: todoId, href: `/p/${encodeURIComponent(project)}/paper#${encodeURIComponent(todoId!)}` });
        return okResult(value, { revision: result.revision, diskHash: result.diskHash, remote: pendingRemote() });
      } catch (error) { return caught(error); }
    });
  } catch (error) { return caught(error); }
}

async function executeActivity(args: unknown): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const days = Math.max(1, Math.min(365, integerArg(record, "days", false) || 7));
    const offset = Math.max(0, integerArg(record, "offset", false) || 0);
    const limit = Math.min(200, Math.max(1, integerArg(record, "limit", false) || 50));
    const since = Date.now() - days * 86_400_000;
    const events = readActivity(projectContentDir(project), 2_000).filter((event) => Date.parse(event.at) >= since);
    const page = events.slice(offset, offset + limit);
    return okResult({ project, days, offset, limit, total: events.length, hasMore: offset + page.length < events.length, events: page });
  } catch (error) { return caught(error); }
}

async function executeSetActivityWindow(args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const mapId = mapArg(record);
    const days = integerArg(record, "days");
    if (days === undefined || days < 1 || days > 365) throw new McpCommandError("invalid_arguments", "days must be from 1 to 365.", false);
    const map = mapRequired(project, mapId);
    assertRevision(map, integerArg(record, "expectedRevision"));
    const next = { ...map, activityWindowDays: days };
    return idempotentWrite(project, "set_activity_window", record, context, (requestId) => writeMap(project, map, next, requestId, "set_activity_window", [{ kind: "mindmap", id: mapId, mapId }], [{ field: "activityWindowDays", before: map.activityWindowDays, after: days }]));
  } catch (error) { return caught(error); }
}

async function executeCompile(args: unknown): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    assertAdministrativeWriteAllowed("MCP compilation");
    const status = requestPaperCompile(projectContentDir(project));
    return okResult(status, { revision: undefined });
  } catch (error) { return caught(error); }
}

async function executeCompileStatus(args: unknown): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    return okResult(getPaperCompileStatus(projectContentDir(project)));
  } catch (error) { return caught(error); }
}

async function executeGitStatus(args: unknown): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    return okResult(await getOverleafGitStatus(projectContentDir(project)));
  } catch (error) { return caught(error); }
}

async function executeGitCommit(args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const message = typeof record.message === "string" && record.message.trim() ? record.message.trim() : `OpenBar: save ${project}`;
    return idempotentWrite(project, "commit_git", record, context, async (requestId) => {
      assertAdministrativeWriteAllowed("MCP Git local commit");
      const local = await commitOverleafGit(projectContentDir(project), message);
      if (!local.ok) return failResult(local.code || "commit_failed", local.message, { retryable: local.status === "blocked" });
      const value = receipt({
        requestId,
        operation: "commit_git",
        resources: local.paths.map((item) => ({ kind: "git-path", id: item.path })),
        value: local,
      });
      recordWebMcpActivity(project, { ...context, requestId }, { operation: "commit_git", resources: [{ kind: "project", id: project }], title: local.commitHash || "Local commit", href: `/p/${encodeURIComponent(project)}/paper` });
      return okResult(value, { remote: pendingRemote() });
    });
  } catch (error) { return caught(error); }
}

async function executeGitSync(args: unknown): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const expectedCommitHash = typeof record.commitHash === "string" && record.commitHash.trim() ? record.commitHash.trim() : undefined;
    assertAdministrativeWriteAllowed("MCP Git remote synchronization");
    const remote = await syncOverleafGit(projectContentDir(project), expectedCommitHash);
    return remote.ok
      ? okResult({ local: { status: "unchanged" }, remote })
      : failResult(remote.code || "remote_sync_failed", remote.message, { retryable: remote.retryable, remote: {
          status: remote.status === "unconfigured" ? "unconfigured" : remote.status === "synchronized" ? "pushed" : "pending",
          message: remote.message,
          code: remote.code,
          commitHash: remote.commitHash,
          retryable: remote.retryable,
        } });
  } catch (error) { return caught(error); }
}

async function executeCapabilities(): Promise<OperationResult<unknown>> {
  return okResult(getRuntimeCapabilities());
}

async function executeBibliography(args: unknown): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const raw = booleanArg(record, "raw") === true;
    const value = raw ? getBibliographyRaw(project) : getBibliography(project);
    return okResult({ project, raw, value: typeof value === "string" ? value.slice(0, MAX_READ_CHARS) : value, truncated: typeof value === "string" && value.length > MAX_READ_CHARS });
  } catch (error) { return caught(error); }
}

const PROJECT_FIELDS = {
  title: { type: "string" }, venue: { type: "string" }, tagline: { type: "string" }, overview: { type: "string" }, researchKind: { type: "string" }, color: { type: "string" }, icon: { type: "string" }, label: { type: "string" }, engine: { type: "string", enum: ["pdflatex", "xelatex", "lualatex"] }, mainFile: { type: "string" }, texliveVersion: { type: "string" }, links: { type: "array" }, collaborators: { type: "array" }, archivedAt: { type: ["string", "null"] }, expectedHash: diskHashSchema, requestId: { type: "string" },
};

const MAP_NODE_PATCH_SCHEMA = {
  title: { type: "string" }, text: { type: "string" }, labels: { type: "array", items: { type: "string" } }, refs: { type: "array" }, metadata: { type: ["object", "null"] }, contentFormat: { type: "string", enum: ["plain", "markdown", "tex"] }, tableLayout: { type: "string", enum: ["wide", "scroll"] }, shape: { type: "string", enum: ["branch", "leaf", "note", "callout"] }, color: { type: "string" }, progress: { type: ["integer", "null"], minimum: 0, maximum: 6 }, priority: { type: ["string", "null"], enum: ["P0", "P1", "P2", "P3", null] }, expectedRevision: revisionSchema, expectedDiskHash: diskHashSchema, requestId: { type: "string" },
};

const BATCH_SCHEMA = {
  project: projectIdSchema, mapId: mapIdSchema, selectedIds: { type: "array", minItems: 1, maxItems: 2_000, items: { type: "string" } }, expectedRevision: revisionSchema, expectedDiskHash: diskHashSchema, previewToken: { type: "string" }, changes: { type: "object" }, deleteMode: { type: "string", enum: ["cards", "branches"] }, move: { type: "object" }, requestId: { type: "string" },
};

function tool(
  name: string,
  title: string,
  description: string,
  inputSchema: McpToolDefinition["inputSchema"],
  execute: McpToolDefinition["execute"],
  options: Partial<McpToolDefinition["annotations"]> = {},
): McpToolDefinition {
  return { name, title, description, inputSchema, annotations: { readOnlyHint: false, idempotentHint: true, ...options }, execute };
}

export const MCP_TOOL_REGISTRY: McpToolDefinition[] = [
  tool("list_projects", "List projects", "List project slugs and titles available to this authenticated MCP connection.", objectSchema(), async () => executeListProjects(), { readOnlyHint: true }),
  tool("get_project_state", "Read project state", "Read bounded project orientation, paper outline, TODO coverage, mindmaps, skills, and durable activity. Saved repository state is returned.", objectSchema({ project: projectIdSchema, detail: { type: "string", enum: ["summary", "full"] }, todoLimit: { type: "integer", minimum: 0, maximum: 200 } }, ["project"]), executeGetProjectState, { readOnlyHint: true }),
  tool("sync_project", "Review and resolve Overleaf synchronization", "Inspect branch, local/base/remote commit IDs, changed files, and recovery refs. review_pull returns base/local/remote contents for every conflicting file. Resolve whole files with local, remote, or edited merged text, then apply_pull with the returned token. Local changes arriving during review require a fresh review. The project checkout is preserved while reviewing.", objectSchema({ project: projectIdSchema, ...syncProjectProperties }, ["project", "action"]), async (args) => {
    const record = asObject(args);
    if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
    try { const project = projectArg(record); const { project: _project, ...input } = record; return syncProjectCommand(projectContentDir(project), input); }
    catch (error) { return caught(error); }
  }, { destructiveHint: true, idempotentHint: false }),
  tool("search_project", "Search project", "Search paper headings, source, TODOs, comments, map cards, labels, and refs. Results include stable ids and hrefs.", objectSchema({ project: projectIdSchema, query: { type: "string", minLength: 1 } }, ["project", "query"]), executeSearchProject, { readOnlyHint: true }),
  tool("get_mindmap", "Read mindmap", "Read a bounded page of one persisted map. mapId draft identifies the Primary map. Use revision and diskHash for writes.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: MAX_PAGE_SIZE } }, ["project", "mapId"]), executeGetMindmap, { readOnlyHint: true }),
  tool("list_mindmaps", "List mindmaps", "List persisted map identities and revisions without loading card bodies.", objectSchema({ project: projectIdSchema }, ["project"]), executeListMindmaps, { readOnlyHint: true }),
  tool("read_paper_section", "Read paper section", "Read one TeX section with its exact section hash. Use the hash for an exact section patch.", objectSchema({ project: projectIdSchema, sectionId: { type: "string" }, maxChars: { type: "integer", minimum: 1, maximum: MAX_READ_CHARS } }, ["project", "sectionId"]), executeReadPaperSection, { readOnlyHint: true }),
  tool("read_paper_source", "Read paper source", "Read a bounded source-bundle range with included file paths and hashes.", objectSchema({ project: projectIdSchema, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: MAX_READ_CHARS } }, ["project"]), executeReadPaperSource, { readOnlyHint: true }),
  tool("read_wiki_page", "Read wiki page", "Read an existing wiki page. Wiki mutations are unavailable in this release.", objectSchema({ project: projectIdSchema, slug: { type: "string" } }, ["project", "slug"]), executeReadWikiPage, { readOnlyHint: true }),
  tool("get_capabilities", "Read capabilities", "Read cached runtime capability information.", objectSchema(), async () => executeCapabilities(), { readOnlyHint: true }),
  tool("read_bibliography", "Read bibliography", "Read parsed bibliography entries or bounded raw BibTeX.", objectSchema({ project: projectIdSchema, raw: { type: "boolean" } }, ["project"]), executeBibliography, { readOnlyHint: true }),
  tool("update_project", "Update project metadata", "Update project metadata or compiler settings with the project hash. The local save and remote state are separate.", objectSchema({ project: projectIdSchema, ...PROJECT_FIELDS }, ["project", "expectedHash"]), executeUpdateProject, { destructiveHint: false }),
  tool("patch_mindmap_node", "Patch map card", "Patch one map-owned card with revision and optional disk-hash compare-and-swap. TODO title and text remain TeX-owned.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, id: { type: "string" }, ...MAP_NODE_PATCH_SCHEMA }, ["project", "mapId", "id", "expectedRevision"]), executePatchMindmapNode),
  tool("add_mindmap_node", "Add map card", "Add one ordinary card under an existing parent with a revision compare-and-swap.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, parentId: { type: "string" }, id: { type: "string" }, title: { type: "string" }, text: { type: "string" }, expectedRevision: revisionSchema, expectedDiskHash: diskHashSchema, requestId: { type: "string" } }, ["project", "mapId", "parentId", "expectedRevision"]), executeAddMindmapNode),
  tool("move_mindmap_node", "Move map card", "Move one card to a parent or sibling position. Cycles and root movement are rejected.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, id: { type: "string" }, parentId: { type: "string" }, beforeId: { type: "string" }, afterId: { type: "string" }, expectedRevision: revisionSchema, expectedDiskHash: diskHashSchema, requestId: { type: "string" } }, ["project", "mapId", "id", "parentId", "expectedRevision"]), executeMoveMindmapNode),
  tool("preview_mindmap_batch", "Preview map batch", "Preview exact affected cards, descendants, TODO-card count, branch roots, and a revision-bound token. This never writes.", objectSchema(BATCH_SCHEMA, ["project", "mapId", "selectedIds", "expectedRevision"]), executePreviewMindmapBatch, { readOnlyHint: true }),
  tool("apply_mindmap_batch", "Apply map batch", "Apply one validated atomic batch for card fields, selected-branch movement, or deletion. Deletion requires a current preview token.", objectSchema(BATCH_SCHEMA, ["project", "mapId", "selectedIds", "expectedRevision", "previewToken"]), executeApplyMindmapBatch, { destructiveHint: true }),
  tool("delete_mindmap_node", "Delete selected cards", "Delete selected cards and promote surviving children to the nearest surviving ancestor. Use a preview token.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, id: { type: "string" }, expectedRevision: revisionSchema, expectedDiskHash: diskHashSchema, previewToken: { type: "string" }, requestId: { type: "string" } }, ["project", "mapId", "id", "expectedRevision", "previewToken"]), (args, context) => executeDeleteMindmap(args, context, "cards"), { destructiveHint: true }),
  tool("delete_mindmap_branch", "Delete selected branches", "Delete selected cards and all descendants, including collapsed descendants. Use a preview token.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, id: { type: "string" }, expectedRevision: revisionSchema, expectedDiskHash: diskHashSchema, previewToken: { type: "string" }, requestId: { type: "string" } }, ["project", "mapId", "id", "expectedRevision", "previewToken"]), (args, context) => executeDeleteMindmap(args, context, "branches"), { destructiveHint: true }),
  tool("add_paper_todo", "Add paper TODO", "Insert a TeX-owned TODO at a stable section using the current source-bundle hash. Reuse todoId and requestId for retries.", objectSchema({ project: projectIdSchema, sectionId: { type: "string" }, title: { type: "string" }, text: { type: "string" }, todoId: { type: "string" }, expectedBundleHash: diskHashSchema, requestId: { type: "string" } }, ["project", "sectionId", "text", "expectedBundleHash"]), executeAddTodo),
  tool("convert_card_to_todo", "Convert card to paper TODO", "Convert an ordinary map card into a TeX-owned TODO and bind the card atomically. Pass sectionId for an explicit stable paper section, or omit it for a neutral insertion in the manuscript root. Use expectedRevision plus optional map and paper hashes for conflict checks, and requestId for retries.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, id: { type: "string" }, sectionId: { type: "string", description: "Optional stable section id from get_project_state. Omit for neutral insertion in the manuscript root." }, expectedRevision: revisionSchema, expectedDiskHash: diskHashSchema, expectedBundleHash: diskHashSchema, requestId: { type: "string" } }, ["project", "mapId", "id", "expectedRevision"]), executeConvertCardToTodo),
  tool("patch_paper_section", "Patch paper section", "Replace one section body using its exact section hash. Preserve other sections, TODOs, comments, markers, tables, and figures.", objectSchema({ project: projectIdSchema, sectionId: { type: "string" }, baseHash: diskHashSchema, tex: { type: "string", maxLength: 1_000_000 }, level: { type: "integer", minimum: 1, maximum: 6 }, appendix: { type: "boolean" }, requestId: { type: "string" } }, ["project", "sectionId", "baseHash", "tex"]), executePaperPatch),
  tool("complete_todo", "Complete paper TODO", "Set a TeX TODO completion timestamp while retaining its text and map cards.", objectSchema({ project: projectIdSchema, todoId: { type: "string" }, expectedBundleHash: diskHashSchema, requestId: { type: "string" } }, ["project", "todoId", "expectedBundleHash"]), (args, context) => executeTodoState(args, context, true)),
  tool("reopen_todo", "Reopen paper TODO", "Clear a TeX TODO completion timestamp while retaining its text and map cards.", objectSchema({ project: projectIdSchema, todoId: { type: "string" }, expectedBundleHash: diskHashSchema, requestId: { type: "string" } }, ["project", "todoId", "expectedBundleHash"]), (args, context) => executeTodoState(args, context, false)),
  tool("get_activity", "Read activity", "Read durable authored operation history after applying the selected day filter and before pagination.", objectSchema({ project: projectIdSchema, days: { type: "integer", minimum: 1, maximum: 365 }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 200 } }, ["project"]), executeActivity, { readOnlyHint: true }),
  tool("set_activity_window", "Set activity window", "Persist the selected map's rolling activity window from 1 to 365 days.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, days: { type: "integer", minimum: 1, maximum: 365 }, expectedRevision: revisionSchema, requestId: { type: "string" } }, ["project", "mapId", "days", "expectedRevision"]), executeSetActivityWindow),
  tool("compile_paper", "Compile paper", "Start a five-minute-bounded compiler job from an immutable source snapshot. The last successful artifact remains addressable if this job fails.", objectSchema({ project: projectIdSchema }, ["project"]), executeCompile),
  tool("get_compile_status", "Read compile status", "Read latest attempted build and latest successful artifact state.", objectSchema({ project: projectIdSchema }, ["project"]), executeCompileStatus, { readOnlyHint: true }),
  tool("get_git_status", "Read Git status", "Read local branch, remote, ahead/behind, changed paths, and latest commit.", objectSchema({ project: projectIdSchema }, ["project"]), executeGitStatus, { readOnlyHint: true }),
  tool("commit_git", "Create local Git commit", "Commit accepted manuscript and OpenBar paths locally without waiting for network access. The receipt includes exact committed file hashes.", objectSchema({ project: projectIdSchema, message: { type: "string", maxLength: 240 }, requestId: { type: "string" } }, ["project"]), executeGitCommit),
  tool("sync_git", "Synchronize Git remote", "Fetch before comparing ahead/behind, then push explicitly to the validated Overleaf remote and current branch. Existing local commits remain available after failure.", objectSchema({ project: projectIdSchema, commitHash: { type: "string" } }, ["project"]), executeGitSync),
];

const REGISTRY_BY_NAME = new Map(MCP_TOOL_REGISTRY.map((entry) => [entry.name, entry]));

export function getMcpTool(name: string): McpToolDefinition | undefined {
  return REGISTRY_BY_NAME.get(name);
}

export function listMcpTools(): McpToolDefinition[] {
  return [...MCP_TOOL_REGISTRY];
}

export async function executeMcpTool(name: string, args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const entry = getMcpTool(name);
  if (!entry) return failResult("invalid_arguments", `Unknown MCP tool "${name}".`, { retryable: false });
  if (context.signal?.aborted) return failResult("cancelled", "The MCP request was cancelled before execution.", { retryable: false });
  try {
    const result = await entry.execute(args, context);
    if (context.signal?.aborted && result.ok) return result;
    return result;
  } catch (error) {
    return caught(error);
  }
}

export const dormantWikiMutationResult = (): OperationResult<never> => failResult(
  "capability_unavailable",
  "Wiki mutations are unavailable in this release. Use bounded wiki reads and preserve the existing wiki files.",
  { retryable: false },
);
