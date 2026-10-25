import "server-only";
import { artifactRefSchema } from "@/lib/schemas";
import { inspectRepository } from "@/lib/tex-project/source-graph";
import { getConversionPlan, previewManuscriptConversion } from "@/lib/tex-project/pandoc";
import { applyConversionWrite } from "@/lib/tex-project/source-persist";
import { previewPaperTodoPlacement, relocatePaperTodo } from "./paper-todo-persist";
import { lintBrokenTex } from "@/lib/tex-project/tex-lint";
import { patchSectionTableCell } from "@/lib/tex-project/table-fragments";
import { findMacroMatches, parseAnchorAttrs } from "@/lib/marker-codec";
import { analyzePaper } from "./paper-analysis";
import { artifactHref } from "./artifact-link";
import { resolveFigureAsset, uploadFigureAsset } from "@/lib/tex-project/project";
import { readDocument } from "@/lib/tex-project/project";
import { readAnySkill, writeAgentsMd, writeProjectSkill, deleteProjectSkill, workspaceRoot, writeWorkspaceSkill, deleteWorkspaceSkill } from "./project-skills";
import { persistVirtualRange } from "@/lib/tex-project/source-persist";
import { attachMindmapImage, detachMindmapImage, captionMindmapImage } from "@/lib/mindmap/image-refs";
import { captionWithinLimit, MAX_VISIBLE_MINDMAP_WORDS, visibleMindmapWordCount } from "@/lib/mindmap/card-content";

import { buildInstructionsWebMcpTools } from "./webmcp-instructions-contract";
import { MINDMAP_WEBMCP_TOOL_SCHEMAS, mindmapToolDescription, parsePresentationArg } from "./webmcp-mindmap-contract";
import { SHARED_WEBMCP_SCHEMAS } from "./mcp-tool-schemas";
import { sharedToolDescription } from "./webmcp-shared-contract";

import { syncProjectCommand } from "./sync-project-command";
import { randomUUID } from "node:crypto";

import {
  getBibliography,
  getBibliographyRaw,
  getEditableTexPaper,
  getMindmap,
  getProject,
  listMindmaps,
  listWiki,
  listProjects,
  projectContentDir,
  saveMindmap,
  saveProject,
} from "@/lib/store";
import type { Mindmap, MindmapNode, Project } from "@/lib/types";
import { projectStateForAgent, getProjectState, searchProject } from "./project-state";
import { readActivity, appendActivity, type ActivityChange } from "./activity-log";
import { failResult, okResult, type OperationResult, type RemoteSyncOutcome } from "./operation-result";
import { clearRequestReplayJournal, persistRequestReplay, readRequestReplay, recoverRequestReplay, requestFingerprint, RequestReplayStoreError, writeRequestReplayIntent } from "./request-replay";
import { applyMindmapAction, newNodeId } from "@/features/mindmap/mindmap-state";
import { mindmapDiskHash, normalizeMindmap } from "@/lib/mindmap/mindmap";
import { normalizeMindmapLabels } from "@/lib/mindmap/node-metadata";
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

type InFlightReplay = {
  operation: string;
  fingerprint: string;
  promise: Promise<OperationResult<unknown>>;
};

/**
 * Promise sharing closes the in-process read/write/replay race. The durable
 * request ID remains project-scoped, so an in-flight ID also reserves its
 * operation and fingerprint for collision checks across tool names.
 */
const inFlightReplays = new Map<string, InFlightReplay>();

const projectIdSchema = { type: "string", minLength: 1, description: "Project slug from list_projects or the /p/<slug>/ URL." };
const mapIdSchema = { type: "string", minLength: 1, description: "Saved map id from get_project_state or list_mindmaps. draft identifies the Primary map." };
const revisionSchema = { type: "integer", minimum: 0, description: "Current map revision returned by get_mindmap or a map preview." };
const diskHashSchema = { type: "string", pattern: "^[a-f0-9]{64}$", description: "Disk hash returned by the last read." };

/** Browser view preferences have no durable headless MCP mutation. */
export const UNSUPPORTED_HEADLESS_VIEW_PREFERENCE_TOOLS = ["set_mindmap_collapsed"] as const;

export function isUnsupportedHeadlessViewPreferenceTool(name: string): boolean {
  return (UNSUPPORTED_HEADLESS_VIEW_PREFERENCE_TOOLS as readonly string[]).includes(name);
}

export function unsupportedHeadlessViewPreferenceResult(name: string): OperationResult<never> {
  return failResult(
    "capability_unavailable",
    `Headless MCP has no "${name}" operation. Mindmap collapse is a browser-local view preference scoped to its project and map. Open the mindmap in a browser and use its WebMCP tool.`,
    { retryable: false },
  );
}

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
    message: "Saved locally. Run sync_git to attempt the validated Git remote.",
    retryable: true,
  };
}

function requestIdFor(args: JsonObject, context: McpCommandContext): string {
  const provided = typeof args.requestId === "string" ? args.requestId.trim() : "";
  return provided || context.requestId?.trim() || randomUUID();
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
  write: (requestId: string, fingerprint: string) => Promise<OperationResult<T>> | OperationResult<T>,
): Promise<OperationResult<T>> {
  const requestId = requestIdFor(args, context);
  const fingerprint = requestFingerprint({ operation, args: Object.fromEntries(Object.entries(args).filter(([key]) => key !== "requestId")) });
  const projectDir = projectContentDir(project);
  const key = `${project}\0${requestId}`;
  const inFlight = inFlightReplays.get(key);
  if (inFlight) {
    if (inFlight.operation !== operation || inFlight.fingerprint !== fingerprint) {
      return failResult("conflict", `requestId "${requestId}" is already in use for a different operation or argument fingerprint.`, { retryable: false });
    }
    return inFlight.promise as Promise<OperationResult<T>>;
  }

  // Defer the body by one microtask before publishing the promise. This lets
  // a concurrent Promise.all caller observe the reservation before any
  // synchronous mutation code can read or save the map.
  const promise = Promise.resolve().then(async () => {
    const recovery = recoverRequestReplay(projectDir, requestId, operation, fingerprint);
    if (recovery.status === "conflict") {
      return failResult("conflict", recovery.message || `requestId "${requestId}" was already used for a different operation or argument fingerprint.`, { retryable: false });
    }
    if (recovery.status === "pending") {
      return failResult(
        "request_replay_recovery_pending",
        recovery.phase === "intent"
          ? `requestId "${requestId}" has an unresolved mutation intent. Inspect the project state and clear or complete the pending recovery before retrying it.`
          : `The saved mutation for requestId "${requestId}" needs replay receipt recovery. Retry the same request after the replay store is available.`,
        { retryable: true, diagnostics: recovery.message ? [{ severity: "error", code: "request_replay_recovery_pending", message: recovery.message }] : undefined },
      );
    }
    if (recovery.status === "recovered" && recovery.entry) return recovery.entry.result as OperationResult<T>;

    let existing: ReturnType<typeof readRequestReplay>;
    try {
      existing = readRequestReplay(projectDir, requestId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return failResult("request_replay_recovery_pending", `The replay store for requestId "${requestId}" is unavailable or corrupted. Repair it before retrying the mutation.`, {
        retryable: true,
        diagnostics: [{ severity: "error", code: "request_replay_recovery_pending", message }],
      });
    }
    if (existing) {
      if (existing.operation !== operation || existing.fingerprint !== fingerprint) {
        return failResult("conflict", `requestId "${requestId}" was already used for a different operation or argument fingerprint.`, { retryable: false });
      }
      return existing.result as OperationResult<T>;
    }

    try {
      const recorded = writeRequestReplayIntent(projectDir, { requestId, operation, fingerprint });
      if (recorded) return recorded.result as OperationResult<T>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const collision = /different operation|fingerprint|already reserved/i.test(message);
      const pending = error instanceof RequestReplayStoreError || /unresolved .*replay journal|pending replay/i.test(message);
      return failResult(
        collision ? "conflict" : pending ? "request_replay_recovery_pending" : "request_replay_reservation_failed",
        `Could not reserve requestId "${requestId}" before the mutation. ${message}`,
        { retryable: !collision, diagnostics: [{ severity: "error", code: pending ? "request_replay_recovery_pending" : "request_replay_reservation_failed", message }] },
      );
    }

    let result: OperationResult<T>;
    try {
      result = await write(requestId, fingerprint);
    } catch (error) {
      if (replaySafeWriterError(error)) {
        try {
          clearRequestReplayJournal(projectDir, requestId);
        } catch (clearError) {
          const message = clearError instanceof Error ? clearError.message : String(clearError);
          return failResult("request_replay_recovery_pending", `The ${operation} request was rejected before persistence, but its recovery intent could not be cleared. Retry after the replay store is available.`, {
            retryable: true,
            diagnostics: [{ severity: "error", code: "request_replay_recovery_pending", message }],
          }) as OperationResult<T>;
        }
        return caught(error) as OperationResult<T>;
      }
      // The intent stays durable because a thrown writer may have persisted
      // some state before the exception crossed this boundary.
      const message = error instanceof Error ? error.message : String(error);
      return failResult("request_replay_recovery_pending", `The ${operation} request may have been saved, but its outcome is uncertain. Inspect the project state before retrying requestId "${requestId}".`, {
        retryable: true,
        diagnostics: [{ severity: "error", code: "request_replay_recovery_pending", message }],
      }) as OperationResult<T>;
    }
    if (!result.ok && replaySafeFailure(result)) {
      try {
        clearRequestReplayJournal(projectDir, requestId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failResult("request_replay_recovery_pending", `The ${operation} request was rejected before persistence, but its recovery intent could not be cleared. Retry after the replay store is available.`, {
          retryable: true,
          diagnostics: [{ severity: "error", code: "request_replay_recovery_pending", message }],
        }) as OperationResult<T>;
      }
      return result;
    }
    if (!result.ok) {
      // The writer ran and returned an uncertain failure. Its intent remains
      // durable until an operator or a later recovery pass establishes the
      // exact outcome.
      return failResult("request_replay_recovery_pending", `The ${operation} writer returned ${result.code} after its durable reservation. Inspect the project state before retrying requestId "${requestId}".`, {
        retryable: true,
        remote: result.remote,
        currentRevision: result.currentRevision,
        currentHash: result.currentHash,
        conflict: result.conflict,
        diagnostics: [
          ...(result.diagnostics || []),
          { severity: "error", code: "request_replay_recovery_pending", message: result.message },
        ],
      }) as OperationResult<T>;
    }
    // Persist and share the JSON-shaped receipt that MCP clients receive.
    // Store reads omit undefined object fields, so normalizing here keeps a
    // concurrent caller's shared result identical to a later durable replay.
    const durableResult = JSON.parse(JSON.stringify(result)) as OperationResult<T>;
    const replay = persistRequestReplay(projectDir, {
      requestId,
      operation,
      fingerprint,
      result: durableResult as unknown as Record<string, unknown>,
    });
    if (replay.status === "unavailable") {
      return failResult("request_replay_recording_failed", `The ${operation} mutation was saved, but its retry receipt could not be recorded. Retry after the replay store is available.`, {
        retryable: true,
        diagnostics: replay.message ? [{ severity: "error", code: "request_replay_recording_failed", message: replay.message }] : undefined,
      });
    }
    if (replay.status === "pending") {
      // The operation result is still authoritative. The journal contains the
      // exact receipt and the next same-request retry promotes it atomically.
      console.warn("OpenBar MCP replay receipt pending recovery", replay.message || "replay file unavailable");
    }
    return durableResult;
  });
  inFlightReplays.set(key, { operation, fingerprint, promise });
  try {
    return await promise;
  } finally {
    if (inFlightReplays.get(key)?.promise === promise) inFlightReplays.delete(key);
  }
}

async function writeMap(
  project: string,
  map: Mindmap,
  next: Mindmap,
  requestId: string,
  operation: string,
  resources: Array<{ kind: string; id: string; mapId?: string }>,
  changes: ActivityChange[] = [],
  deleted = false,
): Promise<OperationResult<unknown>> {
  const status = await getOverleafGitStatus(projectContentDir(project));
  if (status.isOverleafRemote && (status.behind || 0) > 0) return failResult("remote_conflict", "Editing is paused. Review and synchronize Git updates to resume.", true);
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
    const beforeNodes = new Map(map.nodes.map((node) => [node.id, JSON.stringify(node)]));
    const savedIds = new Set(saved.nodes.map((node) => node.id));
    const { nodes, ...mapState } = saved;
    const value = receipt({ requestId, operation, resources, revision: saved.revision ?? 0, diskHash: saved.diskHash, value: {
      ...mapState,
      updatedNodes: nodes.filter((node) => beforeNodes.get(node.id) !== JSON.stringify(node)),
      removedNodeIds: map.nodes.filter((node) => !savedIds.has(node.id)).map((node) => node.id),
    } });
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

// These failures are produced by checks that run before a project mutation.
// Other writer failures retain the durable intent because a partial save or a
// failed read-back can leave the final outcome uncertain.
const REPLAY_SAFE_FAILURE_CODES = new Set([
  "cancelled",
  "capability_unavailable",
  "conflict",
  "conversion_loss",
  "detached_head",
  "invalid_arguments",
  "invalid_path",
  "invalid_tex",
  "map_identity_conflict",
  "multi_file_span",
  "no_changes",
  "not_git_repo",
  "permission_denied",
  "pre_staged_work",
  "remote_conflict",
  "request_conflict",
  "sensitive_path",
  "stale_disk_state",
  "stale_live_state",
  "stale_selection",
  "unknown_card",
  "unknown_map",
  "unknown_section",
  "unknown_todo",
]);

function replaySafeFailure(result: OperationResult<unknown>): boolean {
  return !result.ok && REPLAY_SAFE_FAILURE_CODES.has(result.code);
}

function replaySafeWriterError(error: unknown): boolean {
  if (error instanceof RequestReplayStoreError) return false;
  if (error instanceof McpCommandError) return REPLAY_SAFE_FAILURE_CODES.has(error.code);
  // saveProject reports its compare-and-swap rejection as a TexEnvelopeError.
  // The message identifies checks that complete before bytes are replaced.
  const message = error instanceof Error ? error.message : String(error);
  return /changed on disk|reload before|stale disk state|unknown (?:project|mindmap|card|section|TODO)|must be (?:a|an|one of)|outside its allowed range/i.test(message);
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

async function executeGetSourceBundle(args: unknown): Promise<OperationResult<unknown>> {
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
    const requestArgs = { ...record, project, mapId };
    return idempotentWrite(project, "patch_mindmap_node", requestArgs, context, (requestId) => {
      const expectedRevision = integerArg(record, "expectedRevision");
      const nodeId = stringArg(record, "id");
      const map = mapRequired(project, mapId);
      assertRevision(map, expectedRevision);
      assertDiskHash(map, typeof record.expectedDiskHash === "string" ? record.expectedDiskHash : undefined);
      const current = map.nodes.find((node) => node.id === nodeId);
      if (!current) throw new McpCommandError("invalid_arguments", `Unknown mindmap card "${nodeId}".`, false);
      const patch: Record<string, unknown> = {};
      for (const key of ["title", "text", "caption", "caution", "metadata", "refs"] as const) if (record[key] !== undefined) patch[key] = record[key];
      if (record.refs !== undefined) {
        const refs = artifactRefSchema.array().safeParse(record.refs);
        if (!refs.success || refs.data.filter(ref => ref.kind === "figure").length > 1) return failResult("invalid_arguments", "Use valid references with one image per card and imageWidth from 25 to 100. Add child cards for additional images.", false);
        patch.refs = refs.data;
      }
      if (record.labels !== undefined) patch.tags = normalizeMindmapLabels(requireArray(record.labels, "labels") as string[]);
      if (record.caption !== undefined) {
        if (typeof record.caption !== "string") throw new McpCommandError("invalid_arguments", "caption must be a string.", false);
        if (!captionWithinLimit(record.caption)) throw new McpCommandError("invalid_arguments", "Card notes must be 500 words or fewer.", false);
      }
      if (record.caution !== undefined && typeof record.caution !== "string") throw new McpCommandError("invalid_arguments", "caution must be a string.", false);
      if (record.presentation !== undefined) {
        const parsed = parsePresentationArg(record.presentation, map.rootId, nodeId!);
        if (!parsed.ok) return parsed;
        const presentation = parsed.value!;
        Object.assign(patch, presentation);
        if (Object.hasOwn(presentation, "progress")) patch.progress = presentation.progress === null ? undefined : presentation.progress;
      }
      if (record.priority !== undefined) {
        if (record.priority !== null && !["P0", "P1", "P2", "P3"].includes(String(record.priority))) throw new McpCommandError("invalid_arguments", "priority must be P0–P3 or null.", false);
        patch.priority = record.priority || undefined;
      }
      if (current.todoId && (patch.title !== undefined || patch.text !== undefined)) throw new McpCommandError("invalid_arguments", "TODO title and text are TeX-owned. Use update_todo.", false);
      if (!Object.keys(patch).length) throw new McpCommandError("invalid_arguments", "Provide at least one card field.", false);
      const next = applyMindmapAction(map, { type: "patch-node", id: nodeId!, patch: patch as never }).mindmap;
      return writeMap(project, map, next, requestId, "patch_mindmap_node", [{ kind: "mindmap-node", id: nodeId!, mapId }], changesForNode(current, next.nodes.find((node) => node.id === nodeId)!));
    });
  } catch (error) { return caught(error); }
}

async function executeAddMindmapNode(args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const mapId = mapArg(record);
    const requestArgs = { ...record, project, mapId };
    const result = await idempotentWrite(project, "add_mindmap_node", requestArgs, context, async (requestId) => {
      const expectedRevision = integerArg(record, "expectedRevision");
      const parentId = stringArg(record, "parentId");
      const map = mapRequired(project, mapId);
      assertRevision(map, expectedRevision);
      assertDiskHash(map, typeof record.expectedDiskHash === "string" ? record.expectedDiskHash : undefined);
      if (!map.nodes.some((node) => node.id === parentId)) throw new McpCommandError("invalid_arguments", `Unknown parent card "${parentId}".`, false);
      if (record.caution !== undefined && typeof record.caution !== "string") throw new McpCommandError("invalid_arguments", "caution must be a string.", false);
      const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : newNodeId();
      const next = applyMindmapAction(map, { type: "add-node", agentDraft: true, id, parentId: parentId!, title: typeof record.title === "string" ? record.title : undefined, text: typeof record.text === "string" ? record.text : "", caution: typeof record.caution === "string" ? record.caution : undefined }).mindmap;
      const result = await writeMap(project, map, next, requestId, "add_mindmap_node", [{ kind: "mindmap-node", id, mapId }], [{ field: "added", after: id }]);
      if (result.ok && visibleMindmapWordCount(typeof record.title === "string" ? record.title : "", typeof record.text === "string" ? record.text : "") > MAX_VISIBLE_MINDMAP_WORDS) {
        const value = result.value;
        if (value && typeof value === "object") (value as Record<string, unknown>).creationWarning = "Visible content exceeds 100 words. Keep the visible card focused on its subject. Put exclusions, defensive qualifications, and precautionary notes in the caution scratchpad, and supporting explanations in Extended notes.";
      }
      return result;
    });
    return result;
  } catch (error) { return caught(error); }
}

async function executeMoveMindmapNode(args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const mapId = mapArg(record);
    return idempotentWrite(project, "move_mindmap_node", record, context, (requestId) => {
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
      return writeMap(project, map, next, requestId, "move_mindmap_node", [{ kind: "mindmap-node", id: id!, mapId }], changesForNode(current, next.nodes.find((node) => node.id === id)!));
    });
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
    return idempotentWrite(project, "apply_mindmap_batch", record, context, (requestId) => {
      const map = mapRequired(project, mapId);
      assertRevision(map, integerArg(record, "expectedRevision"));
      assertDiskHash(map, typeof record.expectedDiskHash === "string" ? record.expectedDiskHash : undefined);
      const previewToken = stringArg(record, "previewToken");
      const batch = parseBatchInput(record);
      if (!batchTokenMatches(map, batch, previewToken!)) throw new McpCommandError("stale_selection", "The batch preview is stale. Recompute the preview against the current map revision.", true, map.revision ?? 0, map.diskHash);
      const result = applyMindmapBatch(map, batch);
      const resources = result.preview.affectedNodeIds.map((id) => ({ kind: "mindmap-node", id, mapId }));
      const changes = result.preview.removedNodeIds.length ? [{ field: "removedNodeIds", after: result.preview.removedNodeIds }] : [];
      return writeMap(project, map, result.mindmap, requestId, "apply_mindmap_batch", resources, changes, Boolean(batch.deleteMode));
    });
  } catch (error) { return caught(error); }
}

async function executeDeleteMindmap(args: unknown, context: McpCommandContext, mode: "cards" | "branches"): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  return executeApplyMindmapBatch({ ...record, selectedIds: [record.id], deleteMode: mode }, context);
}

function persistPaperSectionPatch(
  project: string,
  sectionId: string,
  baseHash: string,
  tex: string,
  requestId: string,
  operation: string,
  heading?: { level?: number; appendix?: boolean },
): OperationResult<unknown> {
  try {
    const current = getEditableTexPaper(project)?.sections.find((section) => section.id === sectionId);
    if (!current) throw new McpCommandError("unknown_section", `Unknown paper section "${sectionId}".`, false);
    if (current.hash !== baseHash) throw new McpCommandError("stale_disk_state", "Paper section changed. Read it again before saving.", true, undefined, current.hash);
    assertAdministrativeWriteAllowed("MCP paper changes");
    const saved = patchPaperSection(projectContentDir(project), sectionId, baseHash, tex, heading);
    const value = receipt({ requestId, operation, resources: [{ kind: "paper-section", id: sectionId }], diskHash: saved.hash, value: { id: saved.id, title: saved.title, hash: saved.hash, tex: saved.tex } });
    recordWebMcpActivity(project, { actor: "webmcp", requestId }, { operation, resources: [{ kind: "paper-section", id: sectionId }], changes: [{ field: "tex", after: tex }], title: saved.title, href: `/p/${encodeURIComponent(project)}/paper#${encodeURIComponent(sectionId)}` });
    return okResult(value, { diskHash: saved.hash, remote: pendingRemote() });
  } catch (error) { return caught(error); }
}

async function executeReplacePaperSection(args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const sectionId = stringArg(record, "sectionId");
    const tex = typeof record.tex === "string" ? record.tex : undefined;
    if (tex === undefined) throw new McpCommandError("invalid_arguments", "tex must be a string.", false);
    const baseHash = stringArg(record, "baseHash");
    return idempotentWrite(project, "replace_paper_section", record, context, (requestId) => {
      return persistPaperSectionPatch(project, sectionId!, baseHash!, tex, requestId, "replace_paper_section", {
        level: typeof record.level === "number" ? record.level : undefined,
        appendix: typeof record.appendix === "boolean" ? record.appendix : undefined,
      });
    });
  } catch (error) { return caught(error); }
}

async function executeAddPaperTodoAtSection(args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const record = asObject(args);
  if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
  try {
    const project = projectArg(record);
    const sectionId = stringArg(record, "sectionId");
    const text = stringArg(record, "text");
    const title = stringArg(record, "title", false);
    const expectedBundleHash = stringArg(record, "expectedBundleHash");
    return idempotentWrite(project, "add_paper_todo_at_section", record, context, async (requestId) => {
      try {
        assertAdministrativeWriteAllowed("MCP paper TODO changes");
        const result = persistPaperTodoPlacement({ manuscriptDir: texPaths(projectContentDir(project)).manuscriptDir, sectionId: sectionId!, text: text!, title, id: stringArg(record, "todoId", false), expectedBundleHash });
        if (!result.ok) return result;
        const id = (result.value as { id?: string }).id;
        const value = receipt({ requestId, operation: "add_paper_todo_at_section", resources: [{ kind: "paper-todo", id: id || "unknown" }, { kind: "paper-section", id: sectionId! }], diskHash: result.diskHash, value: result.value });
        recordWebMcpActivity(project, { ...context, requestId }, { operation: "add_paper_todo_at_section", resources: [{ kind: "paper-todo", id: id || "unknown" }, { kind: "paper-section", id: sectionId! }], title: title || text, href: `/p/${encodeURIComponent(project)}/paper#${encodeURIComponent(id || sectionId!)}` });
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
    return idempotentWrite(project, "convert_card_to_todo", record, context, async (requestId, replayFingerprint) => {
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
          replayOwner: "caller",
          replayFingerprint,
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
    return idempotentWrite(project, "set_activity_window", record, context, (requestId) => {
      const map = mapRequired(project, mapId);
      assertRevision(map, integerArg(record, "expectedRevision"));
      const next = { ...map, activityWindowDays: days };
      return writeMap(project, map, next, requestId, "set_activity_window", [{ kind: "mindmap", id: mapId, mapId }], [{ field: "activityWindowDays", before: map.activityWindowDays, after: days }]);
    });
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


function instructionsTools(): McpToolDefinition[] {
  const actions = { writeAgentsMd: (project: string, body: string, hash?: string) => Promise.resolve(writeAgentsMd(projectContentDir(project), body, hash)),
    writeProjectSkill: (project: string, spec: Parameters<typeof writeProjectSkill>[1], hash?: string) => Promise.resolve(writeProjectSkill(projectContentDir(project), spec, hash)),
    deleteProjectSkill: (project: string, id: string, hash: string) => Promise.resolve(deleteProjectSkill(projectContentDir(project), id, "project", hash)),
    writeWorkspaceAgentsMd: (body: string, hash?: string) => Promise.resolve(writeAgentsMd(workspaceRoot(), body, hash)),
    writeWorkspaceSkill: (spec: Parameters<typeof writeWorkspaceSkill>[0], hash?: string) => Promise.resolve(writeWorkspaceSkill(spec, hash)),
    deleteWorkspaceSkill: (id: string, hash: string) => Promise.resolve(deleteWorkspaceSkill(id, hash)),
  };
  // The instructions builder only uses its actions, project and optional refresh.
  const build = (project: string) => buildInstructionsWebMcpTools({ project, actions });
  return build("").map(def => tool(def.name, def.title, def.description,
    objectSchema({ ...def.inputSchema.properties, project: projectIdSchema }, ["project", ...(def.inputSchema.required || [])]),
    async (raw, context) => {
      const args = asObject(raw)!;
      const project = projectArg(args);
      assertAdministrativeWriteAllowed("MCP instructions and skills");
      const { project: _project, ...input } = args;
      return idempotentWrite(project, def.name, args, context, async () => {
        const result = await build(project).find(item => item.name === def.name)!.execute(input) as OperationResult<unknown>;
        if (result.ok) recordWebMcpActivity(project, context, { operation: def.name, resources: [{ kind: "instructions", id: String(args.id || "AGENTS.md") }] });
        return result;
      });
    }));
}

const sourceSchema = { project: projectIdSchema, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: MAX_READ_CHARS } };
const imageSchema = { project: projectIdSchema, mapId: mapIdSchema, id: { type: "string", minLength: 1 }, assetId: { type: "string", minLength: 1 }, label: { type: "string", maxLength: 240 }, expectedRevision: revisionSchema, expectedDiskHash: diskHashSchema, requestId: { type: "string" } };

async function executeMapImage(name: string, raw: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const args = asObject(raw)!;
  const project = projectArg(args);
  return idempotentWrite(project, name, args, context, requestId => {
    const map = mapRequired(project, mapArg(args));
    assertRevision(map, integerArg(args, "expectedRevision"));
    assertDiskHash(map, stringArg(args, "expectedDiskHash", false));
    const node = map.nodes.find(node => node.id === args.id);
    if (!node) return failResult("invalid_arguments", "Unknown mindmap card.", false);
    const assetId = stringArg(args, "assetId")!;
    if (assetId.split("/").some(part => part === ".." || part === "." || !part) || /[\\?#]/.test(assetId)) return failResult("invalid_path", "Use a safe project-relative image path.", false);
    if (name === "attach_mindmap_image" && !resolveFigureAsset(projectContentDir(project), assetId)) return failResult("invalid_path", "The project image asset must exist before attachment.", false);
    if (name !== "attach_mindmap_image" && !node.refs?.some(ref => ref.kind === "figure" && ref.id === assetId)) return failResult("invalid_arguments", "Image must be attached to this card.", false);
    if (name === "attach_mindmap_image" && node.refs?.some(ref => ref.kind === "figure" && ref.id !== assetId)) return failResult("invalid_arguments", "This card already has an image. Create a child with add_mindmap_node, then attach there.", false);
    const refs = name === "attach_mindmap_image" ? attachMindmapImage(node.refs || [], { kind: "figure", id: assetId, ...(args.label ? { label: String(args.label) } : {}) })
      : name === "detach_mindmap_image" ? detachMindmapImage(node.refs || [], assetId)
      : captionMindmapImage(node.refs || [], assetId, String(args.label ?? ""));
    const next = { ...map, nodes: map.nodes.map(item => item.id === node.id ? { ...item, refs } : item) };
    return writeMap(project, map, next, requestId, name, [{ kind: "mindmap_node", id: node.id, mapId: map.id }], activityChanges(node, { ...node, refs }, ["refs"]));
  });
}

export const MCP_TOOL_REGISTRY: McpToolDefinition[] = [
  tool("upload_figure", "Upload a figure asset", "Store a base64 encoded project figure up to 2 MB. Returns an asset path for attach_mindmap_image.", objectSchema({ project: projectIdSchema, filename: { type: "string", minLength: 1, maxLength: 240 }, base64: { type: "string", minLength: 1, maxLength: 2800000 }, requestId: { type: "string" } }, ["project", "filename", "base64"]), async (raw, context) => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    assertAdministrativeWriteAllowed("MCP figure upload");
    const encoded = String(args.base64);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return failResult("invalid_arguments", "base64 must contain a canonical encoded file.", false);
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length > 2 * 1024 * 1024) return failResult("invalid_arguments", "Agent figure uploads are limited to 2 MB.", false);
    return idempotentWrite(project, "upload_figure", args, context, () => okResult(uploadFigureAsset(projectContentDir(project), String(args.filename), bytes)));
  }),
  tool("search_projects", "Search workspace projects", "Find a project by slug, title or tagline.", objectSchema({ query: { type: "string", minLength: 1 } }, ["query"]), async raw => {
    const query = String(asObject(raw)!.query).toLowerCase();
    return okResult(listProjects().filter(project => `${project.slug} ${project.title} ${project.tagline}`.toLowerCase().includes(query)).map(project => ({ slug: project.slug, title: project.title, href: `/p/${encodeURIComponent(project.slug)}/paper` })));
  }, { readOnlyHint: true }),
  tool("inspect_repository", "Inspect repository", "Read the saved TeX include graph, source files and diagnostics.", objectSchema({ project: projectIdSchema }, ["project"]), async raw => okResult(inspectRepository(texPaths(projectContentDir(projectArg(asObject(raw)!))).manuscriptDir)), { readOnlyHint: true }),
  tool("lint_paper", "Lint saved manuscript", "Read TeX syntax diagnostics and unresolved TODO counts.", objectSchema({ project: projectIdSchema }, ["project"]), async raw => {
    const bundle = buildSourceBundle(texPaths(projectContentDir(projectArg(asObject(raw)!))).manuscriptDir);
    return okResult({ diagnostics: lintBrokenTex(bundle.source), todoCount: analyzePaper(bundle.source).todos.length, bundleHash: bundle.bundleHash });
  }, { readOnlyHint: true }),
  tool("preview_paper_todo", "Preview paper TODO", "Preview exact TODO placement in a current section or the manuscript root.", objectSchema({ project: projectIdSchema, sectionId: { type: "string" }, text: { type: "string" }, title: { type: "string" }, id: { type: "string" } }, ["project", "text"]), async raw => {
    const args = asObject(raw)!;
    return okResult(previewPaperTodoPlacement({ manuscriptDir: texPaths(projectContentDir(projectArg(args))).manuscriptDir, sectionId: stringArg(args, "sectionId", false), text: String(args.text), title: stringArg(args, "title", false), id: stringArg(args, "id", false) }));
  }, { readOnlyHint: true }),
  tool("relocate_paper_todo", "Relocate paper TODO", "Move a TeX TODO to a current section with the current source-bundle hash.", objectSchema({ project: projectIdSchema, todoId: { type: "string", minLength: 1 }, sectionId: { type: "string", minLength: 1 }, expectedBundleHash: diskHashSchema, requestId: { type: "string" } }, ["project", "todoId", "sectionId", "expectedBundleHash"]), async (raw, context) => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    assertAdministrativeWriteAllowed("MCP TODO relocation");
    return idempotentWrite<unknown>(project, "relocate_paper_todo", args, context, () => relocatePaperTodo({ manuscriptDir: texPaths(projectContentDir(project)).manuscriptDir, todoId: String(args.todoId), sectionId: String(args.sectionId), expectedBundleHash: String(args.expectedBundleHash) }));
  }),
  tool("remove_paper_todo", "Remove paper TODO", "Remove one exact TeX TODO macro with source hash validation. Use dryRun to inspect its source patch.", objectSchema({ project: projectIdSchema, todoId: { type: "string", minLength: 1 }, expectedBundleHash: diskHashSchema, dryRun: { type: "boolean" }, requestId: { type: "string" } }, ["project", "todoId", "expectedBundleHash"]), async (raw, context) => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    assertAdministrativeWriteAllowed("MCP TODO removal");
    const run = () => {
      const manuscriptDir = texPaths(projectContentDir(project)).manuscriptDir;
      const bundle = buildSourceBundle(manuscriptDir);
      assertPaperHash(bundle.bundleHash, String(args.expectedBundleHash));
      const todo = findMacroMatches(bundle.source, ["obtodo"]).find(todo => parseAnchorAttrs(todo.attrs).id === args.todoId);
      if (!todo) return failResult("unknown_todo", "Unknown TODO.", false);
      return persistVirtualRange({ manuscriptDir, from: todo.index, to: todo.index + todo.length, text: "", expectedBundleHash: String(args.expectedBundleHash), dryRun: args.dryRun === true });
    };
    return args.dryRun === true ? run() : idempotentWrite<unknown>(project, "remove_paper_todo", args, context, run);
  }, { destructiveHint: true }),
  tool("patch_paper_table", "Patch one table cell", "Update one saved table cell while preserving axes and other cells. Uses the section hash returned by read_paper_section.", objectSchema({ project: projectIdSchema, sectionId: { type: "string" }, baseHash: diskHashSchema, tableIndex: { type: "integer", minimum: 0 }, row: { type: "integer", minimum: 0 }, column: { type: "integer", minimum: 0 }, tex: { type: "string", maxLength: 200000 }, dryRun: { type: "boolean" }, requestId: { type: "string" } }, ["project", "sectionId", "baseHash", "tableIndex", "row", "column", "tex"]), async (raw, context) => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    if (args.dryRun === true) {
      const section = getEditableTexPaper(project)?.sections.find(section => section.id === args.sectionId);
      if (!section) return failResult("unknown_section", "Unknown section.", false);
      assertPaperHash(section.hash, String(args.baseHash));
      const patch = patchSectionTableCell(section.tex, Number(args.tableIndex), Number(args.row), Number(args.column), String(args.tex));
      if (!patch.ok) return failResult(patch.reason === "complex" ? "capability_unavailable" : "invalid_arguments", `Table cell patch: ${patch.reason}.`, false);
      return okResult({ sectionId: args.sectionId, tex: patch.tex, baseHash: section.hash, dryRun: true });
    }
    return idempotentWrite(project, "patch_paper_table", args, context, async requestId => {
      const section = getEditableTexPaper(project)?.sections.find(section => section.id === args.sectionId);
      if (!section) return failResult("unknown_section", "Unknown section.", false);
      assertPaperHash(section.hash, String(args.baseHash));
      const patch = patchSectionTableCell(section.tex, Number(args.tableIndex), Number(args.row), Number(args.column), String(args.tex));
      if (!patch.ok) return failResult(patch.reason === "complex" ? "capability_unavailable" : "invalid_arguments", `Table cell patch: ${patch.reason}.`, false);
      return persistPaperSectionPatch(project, String(args.sectionId), String(args.baseHash), patch.tex, requestId, "patch_paper_table");
    });
  }),

  tool("preview_conversion", "Preview document conversion", "Create a bounded Pandoc conversion preview and source-bound plan. Review losses before applying.", objectSchema({ project: projectIdSchema, filePath: { type: "string" }, to: { type: "string" }, expandProject: { type: "boolean" } }, ["project", "filePath"]), async raw => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    const preview = await previewManuscriptConversion({ projectId: project, manuscriptDir: texPaths(projectContentDir(project)).manuscriptDir, filePath: String(args.filePath), source: "", to: stringArg(args, "to", false) || "html5", expandProject: args.expandProject === true });
    if (!preview.ok) return failResult("conversion_loss", preview.message, false);
    const plan = preview.plan;
    return okResult({ id: plan.id, filePath: plan.filePath, toFormat: plan.toFormat, ...plan.artifact });
  }, { readOnlyHint: true }),
  tool("apply_conversion", "Apply reviewed conversion", "Apply a saved conversion plan with source-hash checks and explicit loss acknowledgment. dryRun previews persistence.", objectSchema({ project: projectIdSchema, planId: { type: "string" }, expectedHash: diskHashSchema, acknowledgeLoss: { type: "boolean" }, dryRun: { type: "boolean" }, requestId: { type: "string" } }, ["project", "planId", "expectedHash"]), async (raw, context) => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    assertAdministrativeWriteAllowed("MCP document conversion");
    const manuscriptDir = texPaths(projectContentDir(project)).manuscriptDir;
    if (args.dryRun === true) {
      const plan = getConversionPlan(String(args.planId), manuscriptDir);
      if (!plan || plan.projectId !== project) return failResult("invalid_arguments", "Unknown conversion plan.", false);
      assertPaperHash(plan.artifact.sourceHash, String(args.expectedHash));
      return applyConversionWrite({ manuscriptDir, filePath: plan.filePath, output: plan.artifact.output, loss: plan.artifact.loss, acknowledgeLoss: args.acknowledgeLoss === true, expectedSourceFileHash: plan.artifact.sourceFileHash, expectedSourceBundleHash: plan.artifact.sourceBundleHash, expectedExpandedSourceHash: plan.artifact.sourceHash, expandProject: plan.artifact.expandMethod !== "none", dryRun: true });
    }
    return idempotentWrite<unknown>(project, "apply_conversion", args, context, () => {
      const plan = getConversionPlan(String(args.planId), manuscriptDir);
      if (!plan || plan.projectId !== project) return failResult("invalid_arguments", "Unknown conversion plan.", false);
      assertPaperHash(plan.artifact.sourceHash, String(args.expectedHash));
      return applyConversionWrite({ manuscriptDir, filePath: plan.filePath, output: plan.artifact.output, loss: plan.artifact.loss, acknowledgeLoss: args.acknowledgeLoss === true, expectedSourceFileHash: plan.artifact.sourceFileHash, expectedSourceBundleHash: plan.artifact.sourceBundleHash, expectedExpandedSourceHash: plan.artifact.sourceHash, expandProject: plan.artifact.expandMethod !== "none", dryRun: false });
    });
  }),
  ...["read_document", "render_preview"].map(name => tool(name, name.replaceAll("_", " "), "Read an existing wiki document as supporting memory.", objectSchema({ project: projectIdSchema, kind: { type: "string", enum: ["wiki"] }, id: { type: "string", minLength: 1 } }, ["project", "kind", "id"]), async raw => {
    const args = asObject(raw)!;
    const document = readDocument(projectContentDir(projectArg(args)), "wiki", String(args.id));
    return document ? okResult(name === "read_document" ? { ...document, bodyHash: document.hash, hash: document.stateHash } : { format: "markdown", body: document.markdown, hash: document.stateHash }) : failResult("invalid_path", "Unknown wiki document.", false);
  }, { readOnlyHint: true })),
  tool("place_todo_card", "Place paper TODO in map", "Place an existing TeX TODO under a map parent. Each TODO has at most one card per map.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, todoId: { type: "string" }, parentId: { type: "string" }, expectedRevision: revisionSchema, expectedDiskHash: diskHashSchema, requestId: { type: "string" } }, ["project", "mapId", "todoId", "parentId", "expectedRevision"]), async (raw, context) => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    return idempotentWrite(project, "place_todo_card", args, context, requestId => {
      const map = mapRequired(project, mapArg(args));
      assertRevision(map, integerArg(args, "expectedRevision"));
      assertDiskHash(map, stringArg(args, "expectedDiskHash", false));
      if (!getProjectState(project)?.paper?.todos.some(todo => todo.id === args.todoId)) return failResult("unknown_todo", "Unknown paper TODO.", false);
      const existing = map.nodes.find(node => node.todoId === args.todoId);
      if (existing) return okResult({ id: existing.id, todoId: args.todoId, revision: map.revision, diskHash: map.diskHash });
      const next = applyMindmapAction(map, { type: "add-node", agentDraft: true, parentId: String(args.parentId), todoId: String(args.todoId), id: newNodeId() });
      return writeMap(project, map, next.mindmap, requestId, "place_todo_card", [{ kind: "mindmap_node", id: next.selectedId!, mapId: map.id }]);
    });
  }),
  tool("get_agent_capabilities", "Discover agent access", "Read transports, authentication, and saved versus browser state. Discover tool schemas through tools/list or /api/tools.", objectSchema(), async () => okResult({
    transports: { mcp: "/api/mcp", rest: "/api/tools/{name}", openapi: "/openapi.json", stdio: "node scripts/mcp-stdio.mjs", browser: "window.openbarAgent" },
    authentication: { methods: ["bearer", "configured Cloudflare Access"], tokenEnvironment: "OPENBARRY_ACCESS_TOKEN", browserOriginsEnvironment: "OPENBARRY_AGENT_ORIGINS" },
    state: { http: "saved repository", browser: "live page and editor" },
    browserOnly: ["open_project", "navigate_project", "focus_mindmap_node", "focus_todo_in_paper", "set_paper_reader_mode", "navigate_paper_section", "highlight_mindmap_activity"],
    toolCount: MCP_TOOL_REGISTRY.length,
    discovery: { mcp: "tools/list", rest: "/api/tools" },
  }), { readOnlyHint: true }),
  tool("list_wiki_pages", "List wiki pages", "Discover readable supporting-memory pages.", objectSchema({ project: projectIdSchema }, ["project"]), async raw => {
    const project = projectArg(asObject(raw)!);
    return okResult(listWiki(project).map(page => ({ slug: page.slug, title: page.title, href: `/p/${encodeURIComponent(project)}/wiki/${encodeURIComponent(page.slug)}` })));
  }, { readOnlyHint: true }),
  tool("get_paper_state", "Read saved paper state", "Read saved paper outline, TODOs, comments and source identity. Browser state also includes unsaved edits.", objectSchema({ project: projectIdSchema }, ["project"]), async raw => {
    const project = projectArg(asObject(raw)!);
    return okResult({ project, paper: getProjectState(project)?.paper, saved: true });
  }, { readOnlyHint: true }),
  tool("read_source_range", "Read saved source range", "Read exact characters from a bounded saved source range, with the source bundle hash.", objectSchema({ project: projectIdSchema, from: { type: "integer", minimum: 0 }, to: { type: "integer", minimum: 0 } }, ["project", "from", "to"]), async raw => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    const bundle = buildSourceBundle(texPaths(projectContentDir(project)).manuscriptDir);
    const from = Number(args.from), to = Number(args.to);
    if (to < from || to > bundle.source.length || to - from > MAX_READ_CHARS) return failResult("invalid_arguments", "Use an ordered source range within the document and 200000 characters.", false);
    return okResult({ project, from, to, source: bundle.source.slice(from, to), bundleHash: bundle.bundleHash });
  }, { readOnlyHint: true }),
  ...["add_todo", "update_todo", "add_comment"].map(name => tool(name, name.replaceAll("_", " "), "Apply a source annotation operation to saved TeX with a required bundle hash. dryRun previews the operation.", objectSchema({ project: projectIdSchema, id: { type: "string" }, from: { type: "integer", minimum: 0 }, to: { type: "integer", minimum: 0 }, title: { type: "string" }, text: { type: "string", maxLength: 200000 }, textFormat: { type: "string", enum: ["plain", "tex"] }, kind: { type: "string" }, completed: { type: "boolean" }, expectedBundleHash: diskHashSchema, dryRun: { type: "boolean" }, requestId: { type: "string" } }, ["project", "expectedBundleHash", ...(name === "update_todo" ? ["id"] : ["from", "to", "text"])]), async (raw, context) => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    assertAdministrativeWriteAllowed("MCP paper annotations");
    const { project: _project, expectedBundleHash, dryRun, requestId: _requestId, ...fields } = args;
    const run = () => persistPaperTodoOperation({ manuscriptDir: texPaths(projectContentDir(project)).manuscriptDir, operation: { ...fields, type: name } as SourceOperation, expectedBundleHash: String(expectedBundleHash), dryRun: dryRun === true });
    if (dryRun === true) return run();
    return idempotentWrite<unknown>(project, name, args, context, () => {
      const result = run();
      if (result.ok) recordWebMcpActivity(project, context, { operation: name, resources: [{ kind: "paper", id: String(args.id || "source") }] });
      return result;
    });
  })),
  tool("set_mindmap_font_size", "Set map font size", "Set the map card body font size from 10 through 20 CSS pixels. Titles and tables scale proportionally.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, fontSize: { type: "integer", minimum: 10, maximum: 20 }, expectedRevision: revisionSchema, expectedDiskHash: diskHashSchema, requestId: { type: "string" } }, ["project", "mapId", "fontSize", "expectedRevision"]), async (raw, context) => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    return idempotentWrite(project, "set_mindmap_font_size", args, context, requestId => {
      const map = mapRequired(project, mapArg(args));
      assertRevision(map, integerArg(args, "expectedRevision"));
      assertDiskHash(map, stringArg(args, "expectedDiskHash", false));
      const fontSize = integerArg(args, "fontSize")!;
      return writeMap(project, map, { ...map, fontSize }, requestId, "set_mindmap_font_size", [{ kind: "mindmap", id: map.id! }], [{ field: "fontSize", before: map.fontSize, after: fontSize }]);
    });
  }),
  tool("rename_mindmap", "Rename map", "Change a saved map title with revision checks.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, title: { type: "string", minLength: 1, maxLength: 500 }, expectedRevision: revisionSchema, expectedDiskHash: diskHashSchema, requestId: { type: "string" } }, ["project", "mapId", "title", "expectedRevision"]), async (raw, context) => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    return idempotentWrite(project, "rename_mindmap", args, context, requestId => {
      const map = mapRequired(project, mapArg(args));
      assertRevision(map, integerArg(args, "expectedRevision"));
      assertDiskHash(map, stringArg(args, "expectedDiskHash", false));
      return writeMap(project, map, { ...map, title: String(args.title).trim() }, requestId, "rename_mindmap", [{ kind: "mindmap", id: map.id! }], [{ field: "title", before: map.title, after: args.title }]);
    });
  }),
  ...instructionsTools(),
  tool("read_project_skill", "Read project skill", sharedToolDescription("read_project_skill"), objectSchema({ project: projectIdSchema, ...SHARED_WEBMCP_SCHEMAS.read_project_skill.properties }, ["project", ...(SHARED_WEBMCP_SCHEMAS.read_project_skill.required || [])]), async raw => {
    const args = asObject(raw)!;
    const result = readAnySkill(projectContentDir(projectArg(args)), stringArg(args, "id")!);
    return result ? okResult({ ...result.skill, body: result.body }) : failResult("invalid_path", "Unknown skill.", false);
  }, { readOnlyHint: true }),
  tool("get_source_bundle", "Read saved source bundle", "Read bounded saved TeX source, segments and hashes. Browser calls read live editor state.", objectSchema(sourceSchema, ["project"]), executeGetSourceBundle, { readOnlyHint: true }),
  tool("get_paper_compile", "Read compile status", "Read latest attempted build and latest successful artifact state.", objectSchema({ project: projectIdSchema }, ["project"]), executeCompileStatus, { readOnlyHint: true }),
  tool("get_bibliography", "Read bibliography", "Read bibliography entries or raw BibTeX.", objectSchema({ project: projectIdSchema, raw: { type: "boolean" } }, ["project"]), executeBibliography, { readOnlyHint: true }),
  tool("get_paper_outline", "Read paper outline", "Read saved manuscript headings and current section identities.", objectSchema({ project: projectIdSchema }, ["project"]), async raw => okResult(getProjectState(projectArg(asObject(raw)!))?.paper?.outline || []), { readOnlyHint: true }),
  tool("replace_source_range", "Replace saved source range", "Replace one editable source-file range using the source bundle hash. Use dryRun to preview exact patches.", objectSchema({ project: projectIdSchema, from: { type: "integer", minimum: 0 }, to: { type: "integer", minimum: 0 }, text: { type: "string", maxLength: 1000000 }, expectedBundleHash: diskHashSchema, dryRun: { type: "boolean" }, requestId: { type: "string" } }, ["project", "from", "to", "text", "expectedBundleHash"]), async (raw, context) => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    assertAdministrativeWriteAllowed("MCP source edits");
    const run = () => persistVirtualRange({ manuscriptDir: texPaths(projectContentDir(project)).manuscriptDir, from: Number(args.from), to: Number(args.to), text: String(args.text), expectedBundleHash: String(args.expectedBundleHash), dryRun: args.dryRun === true });
    if (args.to! < args.from!) return failResult("invalid_arguments", "to must be at least from.", false);
    if (args.dryRun === true) return run();
    return idempotentWrite(project, "replace_source_range", args, context, () => {
      const result = run();
      if (result.ok) recordWebMcpActivity(project, context, { operation: "replace_source_range", resources: [{ kind: "paper", id: result.value.filePath }] });
      return result;
    });
  }),
  ...["attach_mindmap_image", "detach_mindmap_image", "caption_mindmap_image"].map(name => tool(name, name.replaceAll("_", " "), "Edit the card image with revision and disk hash checks. Each card holds one image. Create a child with add_mindmap_node for another image. Resize through patch_mindmap_node refs.imageWidth (25 to 100 percent).", objectSchema(imageSchema, ["project", "mapId", "id", "assetId", "expectedRevision", ...(name === "caption_mindmap_image" ? ["label"] : [])]), (raw, context) => executeMapImage(name, raw, context))),
  tool("read_mindmap_image", "Read map image", "Read an attached image reference and its project asset URL.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, id: { type: "string" }, assetId: { type: "string" } }, ["project", "mapId", "id", "assetId"]), async raw => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    const ref = mapRequired(project, mapArg(args)).nodes.find(node => node.id === args.id)?.refs?.find(ref => ref.kind === "figure" && ref.id === args.assetId);
    return ref ? okResult({ id: args.id, ref, url: artifactHref(project, ref) }) : failResult("invalid_path", "Unknown attached image.", false);
  }, { readOnlyHint: true }),
  tool("list_projects", "List projects", "List project slugs and titles available to this authenticated MCP connection.", objectSchema(), async () => executeListProjects(), { readOnlyHint: true }),
  tool("get_project_state", "Read project state", sharedToolDescription("get_project_state"), objectSchema({ project: projectIdSchema, ...SHARED_WEBMCP_SCHEMAS.get_project_state.properties }, ["project", ...(SHARED_WEBMCP_SCHEMAS.get_project_state.required || [])]), executeGetProjectState, { readOnlyHint: true }),
  tool("sync_project", "Review and resolve Git synchronization", sharedToolDescription("sync_project"), objectSchema({ project: projectIdSchema, ...SHARED_WEBMCP_SCHEMAS.sync_project.properties }, ["project", ...(SHARED_WEBMCP_SCHEMAS.sync_project.required || [])]), async (args) => {
    const record = asObject(args);
    if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
    try { const project = projectArg(record); const { project: _project, ...input } = record; return syncProjectCommand(projectContentDir(project), input); }
    catch (error) { return caught(error); }
  }, { destructiveHint: true, idempotentHint: false }),
  tool("search_project", "Search project", sharedToolDescription("search_project"), objectSchema({ project: projectIdSchema, ...SHARED_WEBMCP_SCHEMAS.search_project.properties }, ["project", ...(SHARED_WEBMCP_SCHEMAS.search_project.required || [])]), executeSearchProject, { readOnlyHint: true }),
  tool("get_mindmap", "Read mindmap", mindmapToolDescription("get_mindmap"), objectSchema({ project: projectIdSchema, mapId: mapIdSchema, ...MINDMAP_WEBMCP_TOOL_SCHEMAS.get_mindmap.properties, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: MAX_PAGE_SIZE } }, ["project", "mapId", ...(MINDMAP_WEBMCP_TOOL_SCHEMAS.get_mindmap.required || [])]), executeGetMindmap, { readOnlyHint: true }),
  tool("list_mindmaps", "List mindmaps", "List persisted map identities and revisions without loading card bodies.", objectSchema({ project: projectIdSchema }, ["project"]), executeListMindmaps, { readOnlyHint: true }),
  tool("read_paper_section", "Read paper section", "Read one TeX section with its exact section hash. Use the hash for an exact section patch.", objectSchema({ project: projectIdSchema, sectionId: { type: "string" }, maxChars: { type: "integer", minimum: 1, maximum: MAX_READ_CHARS } }, ["project", "sectionId"]), executeReadPaperSection, { readOnlyHint: true }),
  tool("read_wiki_page", "Read wiki page", "Read an existing wiki page. Wiki mutations are unavailable in this release.", objectSchema({ project: projectIdSchema, slug: { type: "string" } }, ["project", "slug"]), executeReadWikiPage, { readOnlyHint: true }),
  tool("get_capabilities", "Read capabilities", sharedToolDescription("get_capabilities"), SHARED_WEBMCP_SCHEMAS.get_capabilities, async () => executeCapabilities(), { readOnlyHint: true }),
  tool("update_project", "Update project metadata", sharedToolDescription("update_project"), objectSchema({ project: projectIdSchema, ...SHARED_WEBMCP_SCHEMAS.update_project.properties, requestId: { type: "string" } }, ["project", ...(SHARED_WEBMCP_SCHEMAS.update_project.required || [])]), executeUpdateProject, { destructiveHint: false }),
  tool("patch_mindmap_node", "Patch map card", mindmapToolDescription("patch_mindmap_node"), objectSchema({ project: projectIdSchema, mapId: mapIdSchema, ...MINDMAP_WEBMCP_TOOL_SCHEMAS.patch_mindmap_node.properties, expectedDiskHash: diskHashSchema, requestId: { type: "string" } }, ["project", "mapId", ...(MINDMAP_WEBMCP_TOOL_SCHEMAS.patch_mindmap_node.required || [])]), executePatchMindmapNode),
  tool("add_mindmap_node", "Add map card", mindmapToolDescription("add_mindmap_node"), objectSchema({ project: projectIdSchema, mapId: mapIdSchema, ...MINDMAP_WEBMCP_TOOL_SCHEMAS.add_mindmap_node.properties, id: { type: "string", description: "Optional unique card id. Omit to generate one." }, expectedDiskHash: diskHashSchema, requestId: { type: "string" } }, ["project", "mapId", ...(MINDMAP_WEBMCP_TOOL_SCHEMAS.add_mindmap_node.required || [])]), executeAddMindmapNode),
  tool("move_mindmap_node", "Move map card", mindmapToolDescription("move_mindmap_node"), objectSchema({ project: projectIdSchema, mapId: mapIdSchema, ...MINDMAP_WEBMCP_TOOL_SCHEMAS.move_mindmap_node.properties, expectedDiskHash: diskHashSchema, requestId: { type: "string" } }, ["project", "mapId", ...(MINDMAP_WEBMCP_TOOL_SCHEMAS.move_mindmap_node.required || [])]), executeMoveMindmapNode),
  tool("preview_mindmap_batch", "Preview map batch", "Preview exact affected cards, descendants, TODO-card count, branch roots, and a revision-bound token. This never writes.", objectSchema(BATCH_SCHEMA, ["project", "mapId", "selectedIds", "expectedRevision"]), executePreviewMindmapBatch, { readOnlyHint: true }),
  tool("apply_mindmap_batch", "Apply map batch", "Apply one validated atomic batch for card fields, selected-branch movement, or deletion. Deletion requires a current preview token.", objectSchema(BATCH_SCHEMA, ["project", "mapId", "selectedIds", "expectedRevision", "previewToken"]), executeApplyMindmapBatch, { destructiveHint: true }),
  tool("delete_mindmap_node", "Delete selected cards", "Delete selected cards and promote surviving children to the nearest surviving ancestor. Use a preview token.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, id: { type: "string" }, expectedRevision: revisionSchema, expectedDiskHash: diskHashSchema, previewToken: { type: "string" }, requestId: { type: "string" } }, ["project", "mapId", "id", "expectedRevision", "previewToken"]), (args, context) => executeDeleteMindmap(args, context, "cards"), { destructiveHint: true }),
  tool("delete_mindmap_branch", "Delete selected branches", "Delete selected cards and all descendants, including collapsed descendants. Use a preview token.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, id: { type: "string" }, expectedRevision: revisionSchema, expectedDiskHash: diskHashSchema, previewToken: { type: "string" }, requestId: { type: "string" } }, ["project", "mapId", "id", "expectedRevision", "previewToken"]), (args, context) => executeDeleteMindmap(args, context, "branches"), { destructiveHint: true }),
  tool("add_paper_todo_at_section", "Add paper TODO", "Insert a TeX-owned TODO at a current section using the current source-bundle hash. Reuse todoId and requestId for retries.", objectSchema({ project: projectIdSchema, sectionId: { type: "string" }, title: { type: "string" }, text: { type: "string" }, todoId: { type: "string" }, expectedBundleHash: diskHashSchema, requestId: { type: "string" } }, ["project", "sectionId", "text", "expectedBundleHash"]), executeAddPaperTodoAtSection),
  tool("convert_card_to_todo", "Convert card to paper TODO", "Convert an ordinary map card into a TeX-owned TODO and bind the card atomically. Pass sectionId for an explicit current paper section, or omit it for a neutral insertion in the manuscript root. Use expectedRevision plus optional map and paper hashes for conflict checks, and requestId for retries.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, id: { type: "string" }, sectionId: { type: "string", description: "Optional current section id from get_project_state. Omit for neutral insertion in the manuscript root." }, expectedRevision: revisionSchema, expectedDiskHash: diskHashSchema, expectedBundleHash: diskHashSchema, requestId: { type: "string" } }, ["project", "mapId", "id", "expectedRevision"]), executeConvertCardToTodo),
  tool("replace_paper_section", "Replace paper section", "Replace one section body using its exact section hash. Preserve other sections, TODOs, comments, markers, tables, and figures.", objectSchema({ project: projectIdSchema, sectionId: { type: "string" }, baseHash: diskHashSchema, tex: { type: "string", maxLength: 1_000_000 }, level: { type: "integer", minimum: 1, maximum: 6 }, appendix: { type: "boolean" }, requestId: { type: "string" } }, ["project", "sectionId", "baseHash", "tex"]), executeReplacePaperSection),
  tool("complete_todo", "Complete paper TODO", "Set a TeX TODO completion timestamp while retaining its text and map cards.", objectSchema({ project: projectIdSchema, todoId: { type: "string" }, expectedBundleHash: diskHashSchema, requestId: { type: "string" } }, ["project", "todoId", "expectedBundleHash"]), (args, context) => executeTodoState(args, context, true)),
  tool("reopen_todo", "Reopen paper TODO", "Clear a TeX TODO completion timestamp while retaining its text and map cards.", objectSchema({ project: projectIdSchema, todoId: { type: "string" }, expectedBundleHash: diskHashSchema, requestId: { type: "string" } }, ["project", "todoId", "expectedBundleHash"]), (args, context) => executeTodoState(args, context, false)),
  tool("get_activity", "Read activity", "Read durable authored operation history after applying the selected day filter and before pagination.", objectSchema({ project: projectIdSchema, days: { type: "integer", minimum: 1, maximum: 365 }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 200 } }, ["project"]), executeActivity, { readOnlyHint: true }),
  tool("set_activity_window", "Set activity window", "Persist the selected map's rolling activity window from 1 to 365 days.", objectSchema({ project: projectIdSchema, mapId: mapIdSchema, days: { type: "integer", minimum: 1, maximum: 365 }, expectedRevision: revisionSchema, requestId: { type: "string" } }, ["project", "mapId", "days", "expectedRevision"]), executeSetActivityWindow),
  tool("compile_paper", "Compile paper", "Start a five-minute-bounded compiler job from an immutable source snapshot. The last successful artifact remains addressable if this job fails.", objectSchema({ project: projectIdSchema }, ["project"]), executeCompile),
  tool("get_git_status", "Read Git status", "Read local branch, remote, ahead/behind, changed paths, and latest commit.", objectSchema({ project: projectIdSchema }, ["project"]), executeGitStatus, { readOnlyHint: true }),
  tool("commit_git", "Create local Git commit", "Commit accepted manuscript and OpenBar paths locally without waiting for network access. The receipt includes exact committed file hashes.", objectSchema({ project: projectIdSchema, message: { type: "string", maxLength: 240 }, requestId: { type: "string" } }, ["project"]), executeGitCommit),
  tool("sync_git", "Synchronize Git remote", "Fetch before comparing ahead/behind, then push explicitly to the validated Git remote and current branch. Existing local commits remain available after failure.", objectSchema({ project: projectIdSchema, commitHash: { type: "string" } }, ["project"]), executeGitSync),
];

const REGISTRY_BY_NAME = new Map(MCP_TOOL_REGISTRY.map((entry) => [entry.name, entry]));

export function getMcpTool(name: string): McpToolDefinition | undefined {
  return REGISTRY_BY_NAME.get(name);
}

export function listMcpTools(): McpToolDefinition[] {
  return [...MCP_TOOL_REGISTRY];
}

export async function executeMcpTool(name: string, args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  if (isUnsupportedHeadlessViewPreferenceTool(name)) return unsupportedHeadlessViewPreferenceResult(name);
  const entry = getMcpTool(name);
  if (!entry) return failResult("invalid_arguments", `Unknown MCP tool "${name}".`, { retryable: false });
  if (context.signal?.aborted) return failResult("cancelled", "The MCP request was cancelled before execution.", { retryable: false });
  try {
    const record = asObject(args);
    if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
    for (const key of Object.keys(record)) if (!Object.hasOwn(entry.inputSchema.properties, key)) return failResult("invalid_arguments", `Unknown argument "${key}".`, false);
    for (const key of entry.inputSchema.required || []) if (record[key] === undefined) return failResult("invalid_arguments", `Missing argument "${key}".`, false);
    for (const [key, value] of Object.entries(record)) {
      const schema = entry.inputSchema.properties[key] as { type?: string | string[]; enum?: unknown[]; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; pattern?: string };
      const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
      const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      if (types.length && !types.includes(actual) && !(types.includes("integer") && typeof value === "number" && Number.isInteger(value))) return failResult("invalid_arguments", `${key} has an invalid type.`, false);
      if (schema.enum && !schema.enum.includes(value)) return failResult("invalid_arguments", `${key} must be one of ${schema.enum.join(", ")}.`, false);
      if (typeof value === "number" && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) return failResult("invalid_arguments", `${key} is outside its allowed range.`, false);
      if (typeof value === "string" && ((schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength) || (schema.pattern && !new RegExp(schema.pattern).test(value)))) return failResult("invalid_arguments", `${key} has an invalid length or format.`, false);
    }
    const result = await entry.execute(args, context);
    if (result.ok && record.dryRun !== true && ["relocate_paper_todo", "remove_paper_todo", "apply_conversion"].includes(name)) {
      recordWebMcpActivity(projectArg(record), context, { operation: name, resources: [{ kind: "paper", id: String(record.todoId || record.sectionId || record.filePath || "source") }] });
    }
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
