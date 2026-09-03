/**
 * Mindmap page WebMCP tools. Schemas match the browser WebMCP mindmap contract.
 */

import { failResult, okResult, WEBMCP_ERROR_CODES, type OperationResult } from "./operation-result";
import { MINDMAP_WEBMCP_TOOL_NAMES, parseWebMcpArgs, unknownWebMcpArgument, type JsonSchemaObject, type MindmapWebMcpToolName } from "./webmcp-paper-contract";
import type { SharedWebMcpActions, CurrentLocation } from "./webmcp-shared-contract";
import { ARTIFACT_KINDS, isArtifactKind } from "./artifact-link";
import { safeUrl } from "@/lib/safe-url";
import type { ArtifactRef, MindmapNode, MindmapNodeShape } from "@/lib/types";
import { MAX_MINDMAP_LABELS, MAX_MINDMAP_LABEL_CHARS, normalizeMindmapLabels } from "@/lib/mindmap/node-metadata";
import { isPrimaryMindmap as isPrimaryMindmapRole } from "./todo-map";

export { isPrimaryMindmapRole as isPrimaryMindmap };

const PRESENTATION_SHAPES = ["branch", "leaf", "note", "callout"] as const;

export { MAX_MINDMAP_LABELS, MAX_MINDMAP_LABEL_CHARS } from "@/lib/mindmap/node-metadata";

export type LiveMindmapNode = Pick<
  MindmapNode,
  "id" | "parentId" | "title" | "text" | "todoId" | "collapsed" | "contentFormat" | "shape" | "color" | "tags" | "progress" | "refs" | "metadata" | "createdAt" | "updatedAt"
> & { completed?: boolean };

export type MindmapPresentationPatch = Pick<MindmapNode, "contentFormat" | "shape" | "color"> & {
  progress?: number | null;
};

export type MindmapNodeContentPatch = {
  title?: string;
  text?: string;
  labels?: string[];
  refs?: ArtifactRef[];
  metadata?: Record<string, unknown> | null;
  presentation?: MindmapPresentationPatch;
};

export type LiveMindmapSnapshot = {
  project: string;
  mapId: string;
  title?: string;
  role?: "draft" | "planning";
  isPrimary: boolean;
  revision: number;
  diskHash?: string;
  rootId: string;
  nodes: LiveMindmapNode[];
  selectedId?: string;
  activitySince?: string;
};

export type MindmapWebMcpHost = {
  getSnapshot: () => LiveMindmapSnapshot;
  focusNode: (id: string) => void;
  addNode: (parentId: string, text?: string, expectedRevision?: number, title?: string) => string | Promise<string>;
  moveNode: (id: string, parentId: string, beforeId?: string, afterId?: string, expectedRevision?: number) => void | Promise<void>;
  deleteNode: (id: string, expectedRevision?: number) => void | Promise<void>;
  setCollapsed: (id: string, collapsed: boolean, expectedRevision?: number) => void | Promise<void>;
  patchNode: (id: string, patch: MindmapNodeContentPatch, expectedRevision?: number) => void | Promise<void>;
  setActivityHighlight: (since?: string) => void;
  placeTodoCard?: (todoId: string, parentId: string, expectedRevision?: number) => string | Promise<string>;
  hasTodo?: (todoId: string) => boolean;
  convertCardToTodo?: (id: string, sectionTitle: string, expectedRevision?: number) => string | Promise<string>;
  completeTodo?: (todoId: string) => void | Promise<void>;
  reopenTodo?: (todoId: string) => void | Promise<void>;
  focusTodoInPaper?: (todoId: string) => void;
  renameMap?: (title: string, expectedRevision?: number) => void | Promise<void>;
  sharedActions?: SharedWebMcpActions;
  navigate?: (href: string) => void;
  current?: () => CurrentLocation | undefined;
};

function objectSchema(properties: Record<string, unknown> = {}, required: string[] = []): JsonSchemaObject {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

export const MINDMAP_WEBMCP_TOOL_SCHEMAS: Record<MindmapWebMcpToolName, JsonSchemaObject> = {
  get_mindmap: objectSchema(),
  focus_mindmap_node: objectSchema({ id: { type: "string" } }, ["id"]),
  add_mindmap_node: objectSchema(
    { parentId: { type: "string" }, title: { type: "string" }, text: { type: "string" }, expectedRevision: { type: "integer", minimum: 0 } },
    ["parentId", "expectedRevision"],
  ),
  move_mindmap_node: objectSchema(
    {
      id: { type: "string" },
      parentId: { type: "string" },
      beforeId: { type: "string" },
      afterId: { type: "string" },
      expectedRevision: { type: "integer", minimum: 0 },
    },
    ["id", "parentId", "expectedRevision"],
  ),
  delete_mindmap_node: objectSchema(
    { id: { type: "string" }, expectedRevision: { type: "integer", minimum: 0 } },
    ["id", "expectedRevision"],
  ),
  set_mindmap_collapsed: objectSchema(
    { id: { type: "string" }, collapsed: { type: "boolean" }, expectedRevision: { type: "integer", minimum: 0 } },
    ["id", "collapsed", "expectedRevision"],
  ),
  patch_mindmap_node: objectSchema(
    {
      id: { type: "string" },
      expectedRevision: { type: "integer", minimum: 0 },
      title: { type: "string" },
      text: { type: "string" },
      labels: { type: "array", items: { type: "string" }, maxItems: MAX_MINDMAP_LABELS },
      refs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ARTIFACT_KINDS },
            id: { type: "string" },
            label: { type: "string" },
            url: { type: "string" },
          },
          required: ["kind", "id"],
          additionalProperties: false,
        },
      },
      metadata: {
        type: ["object", "null"],
        description: "JSON object owned by this mindmap card. Pass an empty object or null to clear it.",
        additionalProperties: true,
      },
      presentation: {
        type: "object",
        properties: {
          contentFormat: { type: "string", enum: ["plain", "markdown", "tex"] },
          shape: { type: "string", enum: ["branch", "leaf", "note", "callout"] },
          color: { type: "string" },
          progress: { type: ["number", "null"], minimum: 0, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
    ["id", "expectedRevision"],
  ),
  highlight_mindmap_activity: objectSchema({
    since: { type: "string", description: "ISO calendar date (YYYY-MM-DD). Omit for the past seven days." },
    clear: { type: "boolean", description: "Clear the activity highlight from the open map." },
  }),
  place_todo_card: objectSchema(
    {
      todoId: { type: "string" },
      parentId: { type: "string" },
      expectedRevision: { type: "integer", minimum: 0 },
    },
    ["todoId", "parentId", "expectedRevision"],
  ),
  convert_card_to_todo: objectSchema(
    {
      id: { type: "string" },
      sectionTitle: { type: "string" },
      expectedRevision: { type: "integer", minimum: 0 },
    },
    ["id", "sectionTitle", "expectedRevision"],
  ),
  complete_todo: objectSchema({ todoId: { type: "string" } }, ["todoId"]),
  reopen_todo: objectSchema({ todoId: { type: "string" } }, ["todoId"]),
  focus_todo_in_paper: objectSchema({ todoId: { type: "string" } }, ["todoId"]),
  rename_mindmap: objectSchema(
    { title: { type: "string" }, expectedRevision: { type: "integer", minimum: 0 } },
    ["title", "expectedRevision"],
  ),
};

function assertRevision(expected: unknown, current: number): OperationResult<number> {
  if (typeof expected !== "number" || expected !== current) {
    return failResult(WEBMCP_ERROR_CODES.stale_live_state, `Live mindmap revision is ${current}, not ${String(expected)}.`, {
      retryable: true,
      currentRevision: current,
    });
  }
  return okResult(current, { revision: current });
}

function mutationFailure(host: MindmapWebMcpHost, error: unknown): OperationResult<never> {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  const message = error instanceof Error ? error.message : String(error);
  const current = host.getSnapshot();
  if (code === WEBMCP_ERROR_CODES.cancelled || /cancelled/i.test(message)) {
    return failResult(WEBMCP_ERROR_CODES.cancelled, message || "Operation cancelled.", {
      retryable: false,
      currentRevision: current.revision,
    });
  }
  if (code === WEBMCP_ERROR_CODES.stale_live_state) {
    return failResult(WEBMCP_ERROR_CODES.stale_live_state, message, {
      retryable: true,
      currentRevision: current.revision,
    });
  }
  if (code === WEBMCP_ERROR_CODES.stale_disk_state || /conflict|hash|changed on disk|reload before saving|stale/i.test(message)) {
    return failResult(WEBMCP_ERROR_CODES.stale_disk_state, message, {
      retryable: true,
      currentRevision: current.revision,
      currentHash: current.diskHash,
    });
  }
  return failResult("operation_failed", message || "Could not save the mindmap.", {
    retryable: true,
    currentRevision: current.revision,
  });
}

async function runPersistedMutation<T>(
  host: MindmapWebMcpHost,
  mutate: () => T | Promise<T>,
): Promise<OperationResult<T>> {
  try {
    const value = await mutate();
    const persisted = host.getSnapshot();
    return okResult(value, {
      revision: persisted.revision,
      ...(persisted.diskHash ? { diskHash: persisted.diskHash } : {}),
    });
  } catch (error) {
    return mutationFailure(host, error);
  }
}

export const clampMindmapLabels = normalizeMindmapLabels;

function parseLabelsArg(value: unknown): OperationResult<string[]> {
  if (!Array.isArray(value)) return failResult("invalid_arguments", "labels must be an array of strings.", false);
  if (value.length > MAX_MINDMAP_LABELS) {
    return failResult("invalid_arguments", `labels must contain at most ${MAX_MINDMAP_LABELS} entries.`, false);
  }
  if (value.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > MAX_MINDMAP_LABEL_CHARS)) {
    return failResult("invalid_arguments", `Each label must be 1–${MAX_MINDMAP_LABEL_CHARS} characters.`, false);
  }
  return okResult(normalizeMindmapLabels(value));
}

function parseRefsArg(value: unknown): OperationResult<ArtifactRef[]> {
  if (!Array.isArray(value)) return failResult("invalid_arguments", "refs must be an array.", false);
  const refs: ArtifactRef[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return failResult("invalid_arguments", "Each ref must be an object.", false);
    const rec = item as Record<string, unknown>;
    if (typeof rec.kind !== "string" || !isArtifactKind(rec.kind) || typeof rec.id !== "string" || !rec.id.trim()) {
      return failResult("invalid_arguments", "Each ref needs a valid kind and id.", false);
    }
    if (rec.label !== undefined && typeof rec.label !== "string") return failResult("invalid_arguments", "ref label must be a string.", false);
    const url = typeof rec.url === "string" ? rec.url : undefined;
    if (url !== undefined && (!/^https?:\/\//i.test(url.trim()) || !safeUrl(url))) {
      return failResult("invalid_arguments", "ref url must be an http(s) URL.", false);
    }
    const kind = rec.kind;
    if ((kind === "web" || kind === "external") && !safeUrl(url || rec.id)) {
      return failResult("invalid_arguments", "web and external refs require an http(s) URL.", false);
    }
    refs.push({
      kind,
      id: rec.id.trim(),
      ...(typeof rec.label === "string" && rec.label.trim() ? { label: rec.label.trim() } : {}),
      ...(url ? { url } : {}),
    });
  }
  return okResult(refs);
}

function parsePresentationArg(
  value: unknown,
  rootId: string,
  nodeId: string,
): OperationResult<MindmapNodeContentPatch["presentation"]> {
  if (!value || typeof value !== "object") return failResult("invalid_arguments", "presentation must be an object.", false);
  const rec = value as Record<string, unknown>;
  const extra = Object.keys(rec).find((key) => !["contentFormat", "shape", "color", "progress"].includes(key));
  if (extra) return failResult("invalid_arguments", `Unknown presentation property "${extra}".`, false);
  const patch: NonNullable<MindmapNodeContentPatch["presentation"]> = {};
  if (rec.contentFormat !== undefined) {
    if (rec.contentFormat !== "plain" && rec.contentFormat !== "markdown" && rec.contentFormat !== "tex") {
      return failResult("invalid_arguments", "contentFormat must be plain, markdown, or tex.", false);
    }
    patch.contentFormat = rec.contentFormat;
  }
  if (rec.shape !== undefined) {
    if (nodeId === rootId) return failResult("invalid_arguments", "The root topic keeps the root style.", false);
    if (!PRESENTATION_SHAPES.includes(rec.shape as (typeof PRESENTATION_SHAPES)[number])) {
      return failResult("invalid_arguments", "shape is invalid.", false);
    }
    patch.shape = rec.shape as MindmapNodeShape;
  }
  if (rec.color !== undefined) {
    if (typeof rec.color !== "string" || rec.color.length > 80) return failResult("invalid_arguments", "color must be a short CSS color value.", false);
    patch.color = rec.color || undefined;
  }
  if (rec.progress !== undefined) {
    if (rec.progress === null) {
      patch.progress = null;
    } else if (typeof rec.progress !== "number" || !Number.isFinite(rec.progress) || rec.progress < 0 || rec.progress > 100) {
      return failResult("invalid_arguments", "progress must be a number from 0 to 100, or null to hide.", false);
    } else {
      patch.progress = Math.round(rec.progress * 10) / 10;
    }
  }
  if (Object.keys(patch).length === 0) return failResult("invalid_arguments", "presentation is empty.", false);
  return okResult(patch);
}

function parseMetadataArg(value: unknown): OperationResult<Record<string, unknown> | null> {
  if (value === null) return okResult(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failResult("invalid_arguments", "metadata must be a JSON object or null.", false);
  }
  try {
    if (JSON.stringify(value).length > 20_000) {
      return failResult("invalid_arguments", "metadata must be at most 20,000 JSON characters.", false);
    }
  } catch {
    return failResult("invalid_arguments", "metadata must contain JSON values.", false);
  }
  return okResult(value as Record<string, unknown>);
}

export async function executeMindmapWebMcpTool(
  host: MindmapWebMcpHost,
  name: string,
  rawArgs?: unknown,
): Promise<OperationResult<unknown>> {
  const parsedArgs = parseWebMcpArgs(rawArgs);
  if (!parsedArgs.ok) return failResult(WEBMCP_ERROR_CODES.invalid_arguments, parsedArgs.message, { retryable: false });
  const args = parsedArgs.value;
  const schema = MINDMAP_WEBMCP_TOOL_SCHEMAS[name as MindmapWebMcpToolName];
  const unknown = schema ? unknownWebMcpArgument(args, schema) : undefined;
  if (unknown) return failResult(WEBMCP_ERROR_CODES.invalid_arguments, `Unknown argument "${unknown}".`, { retryable: false });
  const snapshot = host.getSnapshot();
  const hasNode = (id: unknown): id is string => typeof id === "string" && snapshot.nodes.some((node) => node.id === id);
  switch (name) {
    case "get_mindmap": {
      return okResult({
        ...snapshot,
        role: snapshot.role,
        isPrimary: typeof snapshot.isPrimary === "boolean"
          ? snapshot.isPrimary
          : isPrimaryMindmapRole({ id: snapshot.mapId, role: snapshot.role }),
      }, { revision: snapshot.revision, diskHash: snapshot.diskHash });
    }
    case "focus_mindmap_node": {
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      host.focusNode(String(args.id ?? ""));
      return okResult({ id: args.id }, { revision: snapshot.revision });
    }
    case "add_mindmap_node": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.parentId)) return failResult("invalid_arguments", `Unknown parent "${String(args.parentId ?? "")}".`, false);
      if (args.title !== undefined && typeof args.title !== "string") return failResult("invalid_arguments", "title must be a string.", false);
      if (args.text !== undefined && typeof args.text !== "string") return failResult("invalid_arguments", "text must be a string.", false);
      const result = await runPersistedMutation(host, () => host.addNode(
        String(args.parentId ?? ""),
        typeof args.text === "string" ? args.text : undefined,
        snapshot.revision,
        typeof args.title === "string" ? args.title : undefined,
      ));
      return result.ok ? okResult({ id: result.value }, { revision: result.revision, diskHash: result.diskHash }) : result;
    }
    case "move_mindmap_node": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      if (!hasNode(args.parentId)) return failResult("invalid_arguments", `Unknown parent "${String(args.parentId ?? "")}".`, false);
      if (args.beforeId !== undefined && args.afterId !== undefined) {
        return failResult("invalid_arguments", "Choose either beforeId or afterId.", false);
      }
      const parentId = String(args.parentId ?? "");
      const movingId = String(args.id ?? "");
      const childIds = new Set(snapshot.nodes.filter((node) => node.parentId === parentId).map((node) => node.id));
      if (args.beforeId !== undefined && (!hasNode(args.beforeId) || !childIds.has(String(args.beforeId)))) {
        return failResult("invalid_arguments", `beforeId must name a child of "${parentId}".`, false);
      }
      if (args.afterId !== undefined && (!hasNode(args.afterId) || !childIds.has(String(args.afterId)))) {
        return failResult("invalid_arguments", `afterId must name a child of "${parentId}".`, false);
      }
      if (args.beforeId === movingId || args.afterId === movingId) {
        return failResult("invalid_arguments", "A node cannot be placed relative to itself.", false);
      }
      let ancestor: LiveMindmapNode | undefined = snapshot.nodes.find((node) => node.id === parentId);
      while (ancestor) {
        if (ancestor.id === movingId) return failResult("invalid_arguments", "A node cannot move into its own subtree.", false);
        ancestor = ancestor.parentId ? snapshot.nodes.find((node) => node.id === ancestor!.parentId) : undefined;
      }
      const result = await runPersistedMutation(host, () => host.moveNode(
        String(args.id ?? ""),
        String(args.parentId ?? ""),
        typeof args.beforeId === "string" ? args.beforeId : undefined,
        typeof args.afterId === "string" ? args.afterId : undefined,
        snapshot.revision,
      ));
      return result.ok ? okResult({ id: args.id }, { revision: result.revision, diskHash: result.diskHash }) : result;
    }
    case "delete_mindmap_node": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      if (args.id === snapshot.rootId) return failResult("invalid_arguments", "The root topic cannot be deleted.", false);
      const result = await runPersistedMutation(host, () => host.deleteNode(String(args.id ?? ""), snapshot.revision));
      return result.ok ? okResult({ id: args.id }, { revision: result.revision, diskHash: result.diskHash }) : result;
    }
    case "set_mindmap_collapsed": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      if (typeof args.collapsed !== "boolean") return failResult("invalid_arguments", "collapsed must be a boolean.", false);
      const result = await runPersistedMutation(host, () => host.setCollapsed(String(args.id ?? ""), args.collapsed as boolean, snapshot.revision));
      return result.ok ? okResult({ id: args.id }, { revision: result.revision, diskHash: result.diskHash }) : result;
    }
    case "patch_mindmap_node": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      const node = snapshot.nodes.find((item) => item.id === args.id)!;
      const patch: MindmapNodeContentPatch = {};
      if (args.title !== undefined) {
        if (typeof args.title !== "string") return failResult("invalid_arguments", "title must be a string.", false);
        if (node.todoId) return failResult("invalid_arguments", "TODO card title is derived from TeX via update_todo.", false);
        patch.title = args.title;
      }
      if (args.text !== undefined) {
        if (typeof args.text !== "string") return failResult("invalid_arguments", "text must be a string.", false);
        if (node.todoId) return failResult("invalid_arguments", "TODO card text is edited in TeX via update_todo.", false);
        patch.text = args.text;
      }
      if (args.labels !== undefined) {
        const labels = parseLabelsArg(args.labels);
        if (!labels.ok) return labels;
        patch.labels = labels.value;
      }
      if (args.refs !== undefined) {
        const refs = parseRefsArg(args.refs);
        if (!refs.ok) return refs;
        patch.refs = refs.value;
      }
      if (args.metadata !== undefined) {
        const metadata = parseMetadataArg(args.metadata);
        if (!metadata.ok) return metadata;
        patch.metadata = metadata.value;
      }
      if (args.presentation !== undefined) {
        const presentation = parsePresentationArg(args.presentation, snapshot.rootId, String(args.id));
        if (!presentation.ok) return presentation;
        patch.presentation = presentation.value;
      }
      if (patch.title === undefined && patch.text === undefined && !patch.labels && !patch.refs && patch.metadata === undefined && !patch.presentation) {
        return failResult("invalid_arguments", "Provide title, text, labels, refs, metadata, or presentation.", false);
      }
      const result = await runPersistedMutation(host, () => host.patchNode(String(args.id ?? ""), patch, snapshot.revision));
      return result.ok ? okResult({ id: args.id, patch }, { revision: result.revision, diskHash: result.diskHash }) : result;
    }
    case "highlight_mindmap_activity": {
      if (args.clear === true) {
        host.setActivityHighlight(undefined);
        return okResult({ since: undefined, message: "Activity highlight cleared." }, { revision: snapshot.revision });
      }
      const since = args.since === undefined ? daysAgoDate(7) : validCalendarDate(args.since);
      if (!since) return failResult("invalid_arguments", "since must be an ISO calendar date such as 2026-09-01.", false);
      host.setActivityHighlight(since);
      const activeNodeIds = snapshot.nodes
        .filter((node) => isActiveSince(node, since))
        .map((node) => node.id);
      return okResult({ since, activeNodeIds, count: activeNodeIds.length }, { revision: snapshot.revision });
    }
    case "place_todo_card": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (typeof args.todoId !== "string" || !args.todoId.trim()) return failResult("invalid_arguments", "todoId is required.", false);
      if (!hasNode(args.parentId)) return failResult("invalid_arguments", `Unknown parent "${String(args.parentId ?? "")}".`, false);
      const todoId = String(args.todoId);
      if (host.hasTodo && !host.hasTodo(todoId)) {
        return failResult("unknown_todo", `Unknown TODO "${todoId}". Read project state and use a current TeX TODO id.`, false);
      }
      const existing = snapshot.nodes.find((node) => node.todoId === todoId);
      if (existing) {
        return okResult({ id: existing.id, todoId, shared: true }, { revision: snapshot.revision, diskHash: snapshot.diskHash });
      }
      if (!host.placeTodoCard) return failResult("capability_unavailable", "This map cannot place TODOs.", false);
      const result = await runPersistedMutation(host, () => host.placeTodoCard!(todoId, String(args.parentId), snapshot.revision));
      return result.ok ? okResult({ id: result.value, todoId }, { revision: result.revision, diskHash: result.diskHash }) : result;
    }
    case "convert_card_to_todo": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      if (typeof args.sectionTitle !== "string" || !args.sectionTitle.trim()) return failResult("invalid_arguments", "sectionTitle is required.", false);
      if (!host.convertCardToTodo) return failResult("capability_unavailable", "This map cannot convert cards to TODOs.", false);
      const result = await runPersistedMutation(host, () => host.convertCardToTodo!(String(args.id), String(args.sectionTitle), snapshot.revision));
      return result.ok ? okResult({ id: args.id, todoId: result.value }, { revision: result.revision, diskHash: result.diskHash }) : result;
    }
    case "complete_todo": {
      if (typeof args.todoId !== "string" || !args.todoId.trim()) return failResult("invalid_arguments", "todoId is required.", false);
      if (!host.completeTodo) return failResult("capability_unavailable", "This map cannot complete TODOs.", false);
      await host.completeTodo(String(args.todoId));
      return okResult({ todoId: args.todoId, completed: true }, { revision: host.getSnapshot().revision });
    }
    case "reopen_todo": {
      if (typeof args.todoId !== "string" || !args.todoId.trim()) return failResult("invalid_arguments", "todoId is required.", false);
      if (!host.reopenTodo) return failResult("capability_unavailable", "This map cannot reopen TODOs.", false);
      await host.reopenTodo(String(args.todoId));
      return okResult({ todoId: args.todoId, completed: false }, { revision: host.getSnapshot().revision });
    }
    case "focus_todo_in_paper": {
      if (typeof args.todoId !== "string" || !args.todoId.trim()) return failResult("invalid_arguments", "todoId is required.", false);
      host.focusTodoInPaper?.(String(args.todoId));
      return okResult({ todoId: args.todoId }, { revision: snapshot.revision });
    }
    case "rename_mindmap": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (typeof args.title !== "string" || !args.title.trim()) {
        return failResult("invalid_arguments", "title must be a non-empty string.", false);
      }
      if (!host.renameMap) return failResult("capability_unavailable", "This map cannot be renamed.", false);
      const title = args.title.trim();
      const result = await runPersistedMutation(host, () => host.renameMap!(title, snapshot.revision));
      return result.ok ? okResult({ title }, { revision: result.revision, diskHash: result.diskHash }) : result;
    }
    default:
      return failResult(WEBMCP_ERROR_CODES.invalid_arguments, `Unknown mindmap tool "${name}".`, false);
  }
}

export function buildMindmapWebMcpTools(host: MindmapWebMcpHost) {
  return MINDMAP_WEBMCP_TOOL_NAMES.map((name) => ({
    name,
    title: name.replaceAll("_", " "),
    description: mindmapToolDescription(name),
    inputSchema: MINDMAP_WEBMCP_TOOL_SCHEMAS[name],
    annotations: { readOnlyHint: name === "get_mindmap" || name === "focus_mindmap_node", untrustedContentHint: true },
    execute: (args?: unknown) => executeMindmapWebMcpTool(host, name, args),
  }));
}

function mindmapToolDescription(name: MindmapWebMcpToolName): string {
  if (name === "get_mindmap") {
    return "Read the live mindmap: card titles and bodies, hierarchy, TODO bindings, labels, refs, role, isPrimary, and revision. Ordinary card content belongs to the map. TODO title and body come from TeX.";
  }
  if (name === "focus_mindmap_node") {
    return "Select a saved mindmap card on the open map. Use navigate_project first if the mindmap page is not open.";
  }
  if (name === "add_mindmap_node") {
    return "Add an ordinary child card under a parent with an optional title and body. To create a TODO, convert a card after choosing a paper location.";
  }
  if (name === "move_mindmap_node") {
    return "Move a saved mindmap card to a new parent or sibling position on this map only. Does not change TeX or other maps.";
  }
  if (name === "delete_mindmap_node") {
    return "Delete a saved mindmap card and its subtree. For a TODO with children, convert it to an ordinary card first if you want to keep the subtree.";
  }
  if (name === "highlight_mindmap_activity") {
    return "Visually highlight cards whose meaningful content changed since a date. Omit since for the past seven days. Pan, zoom, and collapse do not count.";
  }
  if (name === "patch_mindmap_node") {
    return "Patch authored card fields: title and text (ordinary cards only), labels, refs, metadata, and presentation (shape, color, contentFormat, progress). TODO title and text come from TeX.";
  }
  if (name === "set_mindmap_collapsed") {
    return "Collapse or expand a branch in the live map. Collapse is not Recent activity.";
  }
  if (name === "place_todo_card") {
    return "Add a card for an existing TeX TODO to the currently open map. Each map may contain one card for a TODO. The same TODO may appear on Primary and multiple secondary maps. All cards share TeX-owned text and completion. This is a shared card, not a move from another map. If the TODO is already on this map, the existing card is returned unchanged.";
  }
  if (name === "convert_card_to_todo") {
    return "Insert a pending TeX \\obtodo in a paper section using this card's title and main text, then bind the card to that id. Hierarchy is preserved. Completion is left unset.";
  }
  if (name === "complete_todo") {
    return "Set the TeX completed timestamp. Completing does not require new manuscript prose.";
  }
  if (name === "reopen_todo") {
    return "Clear the TeX completed timestamp.";
  }
  if (name === "focus_todo_in_paper") {
    return "Open the paper at this TODO's TeX location.";
  }
  if (name === "rename_mindmap") {
    return "Rename the open mindmap. The primary paper map can still have a title.";
  }
  return `Mindmap operation ${name}. Work with text, hierarchy, and paper TODO bindings. The open page supplies the project.`;
}

function daysAgoDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function validCalendarDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ? value : undefined;
}

function isActiveSince(node: LiveMindmapNode, since: string): boolean {
  const updatedAt = node.updatedAt || node.createdAt;
  return Boolean(updatedAt && Date.parse(updatedAt) >= Date.parse(`${since}T00:00:00Z`));
}

export function createMindmapWebMcpHarness(init: {
  project?: string;
  rootId?: string;
  mapId?: string;
  role?: "draft" | "planning";
  isPrimary?: boolean;
  nodes: LiveMindmapNode[];
}): MindmapWebMcpHost & { snapshot: LiveMindmapSnapshot } {
  const mapId = init.mapId || "draft";
  const role = init.role || (mapId === "draft" ? "draft" : "planning");
  const snapshot: LiveMindmapSnapshot = {
    project: init.project || "demo",
    mapId,
    title: "Demo map",
    role,
    isPrimary: init.isPrimary ?? isPrimaryMindmapRole({ id: mapId, role }),
    revision: 1,
    rootId: init.rootId || "root",
    nodes: init.nodes,
  };
  const bump = () => {
    snapshot.revision += 1;
  };
  const harness: MindmapWebMcpHost & { snapshot: LiveMindmapSnapshot } = {
    snapshot,
    getSnapshot: () => snapshot,
    focusNode: (id) => {
      snapshot.selectedId = id;
    },
    addNode: (parentId, text, _expectedRevision, title) => {
      const id = `n${snapshot.nodes.length + 1}`;
      const value = text || "";
      const explicitTitle = title !== undefined;
      snapshot.nodes.push({
        id,
        parentId,
        title: explicitTitle ? title : (value.split("\n")[0] || "New topic"),
        text: explicitTitle ? value : value.split("\n").slice(1).join("\n"),
      });
      bump();
      return id;
    },
    moveNode: (id, parentId) => {
      const node = snapshot.nodes.find((item) => item.id === id);
      if (node) node.parentId = parentId;
      bump();
    },
    deleteNode: (id) => {
      snapshot.nodes = snapshot.nodes.filter((node) => node.id !== id && node.parentId !== id);
      bump();
    },
    setCollapsed: () => {},
    patchNode: (id, patch) => {
      const node = snapshot.nodes.find((item) => item.id === id);
      if (!node) return;
      if (patch.title !== undefined) node.title = patch.title;
      if (patch.text !== undefined) node.text = patch.text;
      if (patch.labels) node.tags = patch.labels;
      if (patch.refs) node.refs = patch.refs;
      if (patch.metadata !== undefined) node.metadata = patch.metadata || undefined;
      if (patch.presentation) {
        if (patch.presentation.contentFormat !== undefined) node.contentFormat = patch.presentation.contentFormat;
        if (patch.presentation.shape !== undefined) node.shape = patch.presentation.shape;
        if (patch.presentation.color !== undefined) node.color = patch.presentation.color;
        if (patch.presentation.progress === null) node.progress = undefined;
        else if (patch.presentation.progress !== undefined) node.progress = patch.presentation.progress;
      }
      bump();
    },
    setActivityHighlight: (since) => {
      snapshot.activitySince = since;
    },
    placeTodoCard: (todoId, parentId) => {
      const existing = snapshot.nodes.find((node) => node.todoId === todoId);
      if (existing) return existing.id;
      const id = `todo-${todoId}`;
      snapshot.nodes.push({ id, parentId, text: "", todoId, completed: false });
      bump();
      return id;
    },
    completeTodo: (todoId) => {
      for (const node of snapshot.nodes) {
        if (node.todoId === todoId) node.completed = true;
      }
    },
    reopenTodo: (todoId) => {
      for (const node of snapshot.nodes) {
        if (node.todoId === todoId) node.completed = false;
      }
    },
  };
  return harness;
}
