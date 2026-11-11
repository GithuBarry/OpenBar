import { attachMindmapImage,captionMindmapImage,detachMindmapImage } from "@/lib/mindmap/image-refs";
import { artifactRefSchema } from "@/lib/schemas";
import { resolveFigureAsset } from "@/lib/tex-project/project";
import "server-only";
import { acknowledgeAgentInbox,readAgentInbox } from "./agent-inbox";
import { INBOX_TOOL_DESCRIPTIONS,type AgentInbox } from "./agent-inbox-contract";
import { MCP_INPUTS,NATIVE_MINDMAP_INPUTS } from "./command-inputs";
import { commandJsonSchema,parseCommandInput } from "./command-schema";
import { applyProjectEdits,readProjectFiles } from "./project-files";
import { readAnySkill } from "./project-skills";
import { acquireProjectWriteSession,releaseProjectWriteSession,withProjectWriteSessionContext } from "./project-write-session";

import { mindmapToolDescription,parseCautionArg,parsePresentationArg } from "./webmcp-mindmap-contract";
import { sharedToolDescription } from "./webmcp-shared-contract";

import { randomUUID } from "node:crypto";
import { syncProjectCommand } from "./sync-project-command";

import { applyMindmapAction,newNodeId } from "@/features/mindmap/mindmap-state";
import { mindmapDiskHash,normalizeMindmap } from "@/lib/mindmap/mindmap";
import { normalizeMindmapLabels } from "@/lib/mindmap/node-metadata";
import { assertAdministrativeWriteAllowed } from "@/lib/server/demo-mode";
import {
getMindmap,
getProject,
projectContentDir,
saveMindmap,
saveProject
} from "@/lib/store";
import { getPaperCompileStatus,requestPaperCompile } from "@/lib/tex-project/compile";
import { getOverleafGitStatus,getOverleafSyncDetails } from "@/lib/tex-project/overleaf-git";
import { DRAFT_MINDMAP_ID } from "@/lib/tex-project/project";
import type { Mindmap,MindmapNode,Project } from "@/lib/types";
import { getWorkspaceLayout,moveWorkspaceProject,WorkspaceLayoutError } from "@/lib/workspace";
import { appendActivity,readActivity,type ActivityChange } from "./activity-log";
import {
applyMindmapBatch,
batchTokenMatches,
previewMindmapBatch,
type MindmapBatchChanges,
type MindmapBatchInput,
} from "./mindmap-batch";
import { failResult,okResult,type OperationResult,type RemoteSyncOutcome } from "./operation-result";
import { getProjectState,projectStateForAgent } from "./project-state";
import { clearRequestReplayJournal,persistRequestReplay,readRequestReplay,recoverRequestReplay,requestFingerprint,RequestReplayStoreError,writeRequestReplayIntent } from "./request-replay";

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

function pendingRemote(): RemoteSyncOutcome {
  return {
    status: "pending",
    message: "Saved locally. Projects with a Git remote can run sync_git to publish changes.",
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
    const saved = saveMindmap(project, normalized, expected);
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
  "project_busy",
  "project_in_use",
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
  "write_session_changed",
  "write_session_expired",
  "write_session_invalid",
  "write_session_lost",
  "write_session_required",
  "write_session_unavailable",
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
  if (error instanceof WorkspaceLayoutError) return failResult(error.code, error.message, { retryable: error.code === "stale_disk_state", ...(error.currentHash ? { currentHash: error.currentHash } : {}) });
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
    if (record.progress !== null && record.progress !== "ditched" && (typeof record.progress !== "number" || !Number.isInteger(record.progress) || record.progress < 0 || record.progress > 6)) throw new McpCommandError("invalid_arguments", "progress must be 0–6, \"ditched\", or null.", false);
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
  return okResult(getWorkspaceLayout().projects.map((project) => ({ slug: project.slug, id: project.id, title: project.title, tagline: project.tagline, updatedAt: project.updatedAt, ...(project.archivedAt ? { archivedAt: project.archivedAt } : {}) })));
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
      for (const key of ["title", "text", "caption", "metadata", "refs"] as const) if (record[key] !== undefined) patch[key] = record[key];
      if (record.refs !== undefined) {
        const refs = artifactRefSchema.array().safeParse(record.refs);
        if (!refs.success || refs.data.filter(ref => ref.kind === "figure").length > 1) return failResult("invalid_arguments", "Use valid references with one image per card and imageWidth from 25 to 100. Add child cards for additional images.", false);
        patch.refs = refs.data;
      }
      if (record.labels !== undefined) patch.tags = normalizeMindmapLabels(requireArray(record.labels, "labels") as string[]);
      if (record.caption !== undefined) {
        if (typeof record.caption !== "string") throw new McpCommandError("invalid_arguments", "caption must be a string.", false);
      }
      if (record.caution !== undefined) {
        const parsed = parseCautionArg(record.caution);
        if (!parsed.ok) return parsed;
        patch.caution = parsed.value;
      }
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
      const caution = record.caution === undefined ? undefined : parseCautionArg(record.caution);
      if (caution && !caution.ok) return caution;
      if (record.caption !== undefined && typeof record.caption !== "string") return failResult("invalid_arguments", "caption must be a string.", false);
      const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : newNodeId();
      const next = applyMindmapAction(map, { type: "add-node", agentDraft: true, id, parentId: parentId!, title: typeof record.title === "string" ? record.title : undefined, text: typeof record.text === "string" ? record.text : "", caption: typeof record.caption === "string" ? record.caption : undefined, caution: caution?.ok ? caution.value : undefined }).mindmap;
      const result = await writeMap(project, map, next, requestId, "add_mindmap_node", [{ kind: "mindmap-node", id, mapId }], [{ field: "added", after: id }]);
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

function tool(
  name: string,
  title: string,
  description: string,
  execute: McpToolDefinition["execute"],
  options: Partial<McpToolDefinition["annotations"]> = {},
): McpToolDefinition {
  return { name, title, description, inputSchema: commandJsonSchema(MCP_INPUTS[name as keyof typeof MCP_INPUTS]), annotations: { readOnlyHint: false, idempotentHint: true, ...options }, execute };
}

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
    if (name === "attach_mindmap_image" && node.refs?.some(ref => ref.kind === "figure" && ref.id !== assetId)) return failResult("invalid_arguments", "This card already has an image. Use apply_mindmap_edits with operation add to create a child, then attach there.", false);
    const refs = name === "attach_mindmap_image" ? attachMindmapImage(node.refs || [], { kind: "figure", id: assetId, ...(args.label ? { label: String(args.label) } : {}) })
      : name === "detach_mindmap_image" ? detachMindmapImage(node.refs || [], assetId)
      : captionMindmapImage(node.refs || [], assetId, String(args.label ?? ""));
    const next = { ...map, nodes: map.nodes.map(item => item.id === node.id ? { ...item, refs } : item) };
    return writeMap(project, map, next, requestId, name, [{ kind: "mindmap_node", id: node.id, mapId: map.id }], activityChanges(node, { ...node, refs }, ["refs"]));
  });
}

const executePlaceTodoCard: McpToolDefinition["execute"] = async (raw, context) => {
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
  };

const executeRenameMindmap: McpToolDefinition["execute"] = async (raw, context) => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    return idempotentWrite(project, "rename_mindmap", args, context, requestId => {
      const map = mapRequired(project, mapArg(args));
      assertRevision(map, integerArg(args, "expectedRevision"));
      assertDiskHash(map, stringArg(args, "expectedDiskHash", false));
      return writeMap(project, map, { ...map, title: String(args.title).trim() }, requestId, "rename_mindmap", [{ kind: "mindmap", id: map.id! }], [{ field: "title", before: map.title, after: args.title }]);
    });
  };

const executeSetMindmapFontSize: McpToolDefinition["execute"] = async (raw, context) => {
    const args = asObject(raw)!;
    const project = projectArg(args);
    return idempotentWrite(project, "set_mindmap_font_size", args, context, requestId => {
      const map = mapRequired(project, mapArg(args));
      assertRevision(map, integerArg(args, "expectedRevision"));
      assertDiskHash(map, stringArg(args, "expectedDiskHash", false));
      const fontSize = integerArg(args, "fontSize")!;
      return writeMap(project, map, { ...map, fontSize }, requestId, "set_mindmap_font_size", [{ kind: "mindmap", id: map.id! }], [{ field: "fontSize", before: map.fontSize, after: fontSize }]);
    });
  };

async function executeReadProjectFiles(raw: unknown): Promise<OperationResult<unknown>> {
  const args = MCP_INPUTS.read_project_files.parse(raw);
  const project = projectArg(args);
  const { project: _project, ...input } = args;
  return readProjectFiles(projectContentDir(project), input);
}

async function executeProjectFileEdits(raw: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const args = MCP_INPUTS.apply_project_edits.parse(raw);
  const project = projectArg(args);
  const projectDir = projectContentDir(project);
  const { project: _project, requestId: _requestId, ...input } = args;
  if (input.dryRun) return applyProjectEdits(projectDir, input);
  assertAdministrativeWriteAllowed("MCP project file edits");
  return idempotentWrite(project, "apply_project_edits", args, context, async requestId => {
    const claim = await acquireProjectWriteSession(projectDir, { sessionId: randomUUID(), label: "Agent file edit" });
    if (!claim.ok) return failResult(claim.code, claim.message, { retryable: true });
    if (!claim.credential) return failResult("write_session_unavailable", "File edits need a writing session. Try again.", { retryable: true });
    try {
      if (context.signal?.aborted) return failResult("cancelled", "File edit cancelled.", { retryable: false });
      const result = withProjectWriteSessionContext(projectDir, claim.credential, () => applyProjectEdits(projectDir, input));
      if (result.ok) recordWebMcpActivity(project, { ...context, requestId }, {
        operation: "apply_project_edits",
        resources: result.value.files.map(file => ({ kind: "project-file", id: file.path })),
        changes: [{ field: "files", after: result.value.files }],
      });
      return result;
    } finally {
      await releaseProjectWriteSession(projectDir, claim.credential).catch(error => {
        console.warn("OpenBar could not release the file edit session", error instanceof Error ? error.message : String(error));
      });
    }
  });
}

async function executeManagedMindmapEdit(raw: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  const args = MCP_INPUTS.apply_mindmap_edits.parse(raw);
  const operations = {
    add: "add_mindmap_node", patch: "patch_mindmap_node", move: "move_mindmap_node",
    "preview-batch": "preview_mindmap_batch", "apply-batch": "apply_mindmap_batch",
    "place-todo": "place_todo_card", rename: "rename_mindmap", "font-size": "set_mindmap_font_size",
    "attach-image": "attach_mindmap_image", "detach-image": "detach_mindmap_image", "caption-image": "caption_mindmap_image",
    "activity-window": "set_activity_window",
  } as const;
  if (!Object.hasOwn(operations, args.edit.operation)) return failResult("invalid_arguments", `Use a managed map operation: ${Object.keys(operations).join(", ")}.`, false);
  const name = operations[args.edit.operation as keyof typeof operations];
  const schema = NATIVE_MINDMAP_INPUTS[name];
  const input: Record<string, unknown> = { ...args.edit.args };
  for (const key of ["project", "mapId", "expectedRevision", "expectedDiskHash", "requestId"] as const) {
    if (key in schema.shape) input[key] = args[key];
  }
  const parsed = parseCommandInput(schema, input);
  if (!parsed.ok) return parsed;
  const handlers: Record<keyof typeof NATIVE_MINDMAP_INPUTS, McpToolDefinition["execute"]> = {
    add_mindmap_node: executeAddMindmapNode, patch_mindmap_node: executePatchMindmapNode, move_mindmap_node: executeMoveMindmapNode,
    preview_mindmap_batch: executePreviewMindmapBatch, apply_mindmap_batch: executeApplyMindmapBatch,
    place_todo_card: executePlaceTodoCard, rename_mindmap: executeRenameMindmap, set_mindmap_font_size: executeSetMindmapFontSize,
    attach_mindmap_image: (input, context) => executeMapImage("attach_mindmap_image", input, context),
    detach_mindmap_image: (input, context) => executeMapImage("detach_mindmap_image", input, context),
    caption_mindmap_image: (input, context) => executeMapImage("caption_mindmap_image", input, context),
    set_activity_window: executeSetActivityWindow,
  };
  return handlers[name](parsed.value, context);
}

export const MCP_TOOL_REGISTRY: McpToolDefinition[] = [
  tool("list_projects", "List projects", "List project slugs and titles available to this authenticated MCP connection.", async () => executeListProjects(), { readOnlyHint: true }),
  tool("get_workspace_layout", "Read project layout", "Read active and archived projects in saved order and the hash required by move_project.", async () => okResult(getWorkspaceLayout()), { readOnlyHint: true }),
  tool("move_project", "Move a project", "Reorder, archive or restore a project with the current layout hash. Omit neighbors to append to the destination group.", async raw => {
    assertAdministrativeWriteAllowed("MCP workspace project moves");
    return okResult(await moveWorkspaceProject(MCP_INPUTS.move_project.parse(raw)));
  }, { idempotentHint: false }),
  tool("get_project_state", "Read project state", sharedToolDescription("get_project_state"), executeGetProjectState, { readOnlyHint: true }),
  tool("check_inbox", "Check OpenBar updates", INBOX_TOOL_DESCRIPTIONS.check_inbox, async raw => okResult(readAgentInbox(MCP_INPUTS.check_inbox.parse(raw))), { readOnlyHint: true }),
  tool("acknowledge_inbox", "Handle OpenBar notifications", INBOX_TOOL_DESCRIPTIONS.acknowledge_inbox, async raw => okResult(await acknowledgeAgentInbox(MCP_INPUTS.acknowledge_inbox.parse(raw)))),
  tool("read_project_skill", "Read project skill", sharedToolDescription("read_project_skill"), async raw => {
    const args = asObject(raw)!;
    const result = readAnySkill(projectContentDir(projectArg(args)), stringArg(args, "id")!, args.source as Parameters<typeof readAnySkill>[2]);
    return result ? okResult({ ...result.skill, body: result.body }) : failResult("invalid_path", "Unknown skill.", false);
  }, { readOnlyHint: true }),
  tool("get_mindmap", "Read mindmap", mindmapToolDescription("get_mindmap"), executeGetMindmap, { readOnlyHint: true }),
  tool("update_project", "Update project metadata", sharedToolDescription("update_project"), executeUpdateProject, { destructiveHint: false }),
  tool("sync_project", "Review and resolve Git synchronization", sharedToolDescription("sync_project"), async (args) => {
    const record = asObject(args);
    if (!record) return failResult("invalid_arguments", "Arguments must be an object.", false);
    try { const project = projectArg(record); const { project: _project, ...input } = record; return syncProjectCommand(projectContentDir(project), input); }
    catch (error) { return caught(error); }
  }, { destructiveHint: true, idempotentHint: false }),
  tool("compile_paper", "Compile paper", "Start a five-minute-bounded compiler job from an immutable source snapshot. The last successful artifact remains addressable if this job fails.", executeCompile),
  tool("get_paper_compile", "Read compile status", "Read latest attempted build and latest successful artifact state.", executeCompileStatus, { readOnlyHint: true }),
  tool("get_activity", "Read activity", "Read durable authored operation history after applying the selected day filter and before pagination.", executeActivity, { readOnlyHint: true }),
  tool("read_project_files", "Read project files", "List directories or read authored project files with exact byte SHA256 and bounded UTF-8/base64 content. Paths are relative to the project root. OpenBar managed state and Git metadata are protected.", executeReadProjectFiles, { readOnlyHint: true }),
  tool("apply_project_edits", "Apply project file edits", "Atomically create, replace, or delete authored project files using exact prior hashes. Batch a destination create and source delete to move a file. dryRun previews the complete batch. OpenBar managed state and Git metadata are protected.", executeProjectFileEdits, { destructiveHint: true }),
  tool("apply_mindmap_edits", "Edit managed mindmap state", "Apply one revision-checked map operation. edit.operation: add, patch, move, preview-batch, apply-batch, place-todo, rename, font-size, attach-image, detach-image, caption-image, activity-window. args: add {parentId,title?,text?,caption?,caution?,id?}, patch {id,title?,text?,caption?,caution?,labels?,refs?,metadata?,presentation?,priority?}, move {id,parentId,beforeId?,afterId?}, batch {selectedIds,changes?,deleteMode?,move?,previewToken?}, place-todo {todoId,parentId}, rename {title}, font-size {fontSize}, images {id,assetId,label?}, activity-window {days}. Preview batches first and pass their token to apply-batch. deleteMode cards promotes children, branches removes descendants. New cards remain Agent draft. TODO text/completion belongs to TeX files.", executeManagedMindmapEdit, { destructiveHint: true }),
];

const REGISTRY_BY_NAME = new Map(MCP_TOOL_REGISTRY.map((entry) => [entry.name, entry]));

export function getMcpTool(name: string): McpToolDefinition | undefined {
  return REGISTRY_BY_NAME.get(name);
}

export function listMcpTools(): McpToolDefinition[] {
  return [...MCP_TOOL_REGISTRY];
}

async function executeCommand(name: string, args: unknown, context: McpCommandContext): Promise<OperationResult<unknown>> {
  if (isUnsupportedHeadlessViewPreferenceTool(name)) return unsupportedHeadlessViewPreferenceResult(name);
  const entry = getMcpTool(name);
  if (!entry) return failResult("invalid_arguments", `Unknown MCP tool "${name}".`, { retryable: false });
  if (context.signal?.aborted) return failResult("cancelled", "The MCP request was cancelled before execution.", { retryable: false });
  try {
    const parsed = parseCommandInput(MCP_INPUTS[name as keyof typeof MCP_INPUTS], args);
    if (!parsed.ok) return parsed;
    const record = parsed.value;
    const result = await entry.execute(record, context);

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

/** All tool transports retain their result while surfacing pending human requests. */
export async function executeMcpTool(name: string, args: unknown, context: McpCommandContext): Promise<OperationResult<unknown> & { notifications?: AgentInbox | { error: string } }> {
  const result = await executeCommand(name, args, context);
  if (name === "check_inbox" || name === "acknowledge_inbox") return result;
  try {
    const record = asObject(args);
    const inbox = readAgentInbox({ project: typeof record?.project === "string" ? record.project : undefined, limit: 3 });
    return inbox.count ? { notifications: inbox, ...result } : result;
  } catch {
    return { notifications: { error: "OpenBar inbox could not be checked. Call check_inbox to retry." }, ...result };
  }
}
