/**
 * Mindmap page WebMCP tools. Schemas match the browser WebMCP mindmap contract.
 */

import { failResult, okResult, WEBMCP_ERROR_CODES, type OperationResult, type RemoteSyncOutcome } from "./operation-result";
import { MINDMAP_WEBMCP_TOOL_NAMES, parseWebMcpArgs, unknownWebMcpArgument, type JsonSchemaObject, type MindmapWebMcpToolName } from "./webmcp-paper-contract";
import type { SharedWebMcpActions, CurrentLocation } from "./webmcp-shared-contract";
import { ARTIFACT_KINDS, coercePaperSectionRefContext, isArtifactKind } from "./artifact-link";
import { safeUrl } from "@/lib/safe-url";
import { artifactHref } from "./artifact-link";
import { attachMindmapImage, captionMindmapImage, detachMindmapImage } from "@/lib/mindmap/image-refs";
import { captionWithinLimit } from "@/lib/mindmap/card-content";
import type { ArtifactRef, Mindmap, MindmapNode, MindmapNodeShape } from "@/lib/types";
import { MAX_MINDMAP_LABELS, MAX_MINDMAP_LABEL_CHARS, normalizeMindmapLabels } from "@/lib/mindmap/node-metadata";
import { isPrimaryMindmap as isPrimaryMindmapRole } from "./todo-map";

export { isPrimaryMindmapRole as isPrimaryMindmap };

const PRESENTATION_SHAPES = ["branch", "leaf", "callout"] as const;

export { MAX_MINDMAP_LABELS, MAX_MINDMAP_LABEL_CHARS } from "@/lib/mindmap/node-metadata";

export type LiveMindmapNode = Pick<
  MindmapNode,
  "agentDraft" | "id" | "parentId" | "title" | "text" | "caption" | "todoId" | "contentFormat" | "tableLayout" | "shape" | "color" | "tags" | "progress" | "priority" | "refs" | "metadata" | "createdAt" | "updatedAt"
> & { completed?: boolean; /** Browser view preference, excluded from durable map state. */ collapsed?: boolean };

export type MindmapPresentationPatch = Pick<MindmapNode, "contentFormat" | "tableLayout" | "shape" | "color"> & {
  progress?: MindmapNode["progress"] | null;
};

export type MindmapNodeContentPatch = {
  title?: string;
  text?: string;
  caption?: string;
  labels?: string[];
  refs?: ArtifactRef[];
  metadata?: Record<string, unknown> | null;
  priority?: MindmapNode["priority"];
  presentation?: MindmapPresentationPatch;
};

export type MindmapTodoConversionLocal = {
  paper: "saved" | "failed";
  map: "saved" | "failed" | "not_attempted";
  message?: string;
};

export type MindmapTodoConversionRemote = {
  status: "pushed" | "pending" | "failed" | "unconfigured";
  message: string;
  code?: string;
  commitHash?: string;
  retryable: boolean;
  credentialNeeded?: boolean;
};

export type MindmapTodoConversion = {
  todoId: string;
  mindmap: Mindmap;
  local: MindmapTodoConversionLocal;
  sectionId?: string;
  /** Source bundle hash after the local paper transaction. */
  sourceHash?: string;
  remote: MindmapTodoConversionRemote;
};

export type MindmapTodoConversionFailure = {
  ok: false;
  code: string;
  message: string;
  retryable: boolean;
  todoId?: string;
  local: MindmapTodoConversionLocal;
  remote: MindmapTodoConversionRemote;
};

export type MindmapTodoConversionResult = OperationResult<MindmapTodoConversion> | MindmapTodoConversionFailure;

export type LiveMindmapSnapshot = {
  project: string;
  mapId: string;
  title?: string;
  fontSize?: number;
  role?: "draft" | "planning";
  isPrimary: boolean;
  revision: number;
  diskHash?: string;
  rootId: string;
  nodes: LiveMindmapNode[];
  /** Browser-only map view state. It is scoped by the mounted project and map. */
  viewLocal: { collapsedIds: string[] };
  selectedId?: string;
  activitySince?: string;
  /** Browser-local persistence state for the live map draft. */
  localSaveState?: "dirty" | "saving" | "saved" | "conflict";
  /** Project Git synchronization state for the latest queued checkpoint. */
  remoteSaveState?: "checking" | "pending" | "syncing" | "synced" | "changed" | "unavailable" | "failed";
  /** Last local-save-to-Git outcome, including an actionable failure. */
  remoteSync?: RemoteSyncOutcome;
  editingBlocked?: boolean;
};

export type MindmapWebMcpHost = {
  getSnapshot: () => LiveMindmapSnapshot;
  focusNode: (id: string) => void;
  addNode: (parentId: string, text?: string, expectedRevision?: number, title?: string) => string | Promise<string>;
  moveNode: (id: string, parentId: string, beforeId?: string, afterId?: string, expectedRevision?: number) => void | Promise<void>;
  deleteNode: (id: string, expectedRevision?: number) => void | Promise<void>;
  deleteBranch?: (id: string, expectedRevision?: number) => void | Promise<void>;
  setCollapsed: (id: string, collapsed: boolean, expectedRevision?: number) => void | Promise<void>;
  patchNode: (id: string, patch: MindmapNodeContentPatch, expectedRevision?: number) => void | Promise<void>;
  setActivityHighlight: (since?: string) => void;
  placeTodoCard?: (todoId: string, parentId: string, expectedRevision?: number) => string | Promise<string>;
  hasTodo?: (todoId: string) => boolean;
  convertCardToTodo?: (id: string, sectionId?: string, expectedRevision?: number, requestId?: string) => MindmapTodoConversionResult | Promise<MindmapTodoConversionResult>;
  completeTodo?: (todoId: string) => void | Promise<void>;
  reopenTodo?: (todoId: string) => void | Promise<void>;
  focusTodoInPaper?: (todoId: string) => void;
  setFontSize?: (fontSize: number, expectedRevision?: number) => void | Promise<void>;
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
  delete_mindmap_branch: objectSchema(
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
      caption: { type: "string", description: "Model-facing Extended note, available from the card bottom, up to 500 words." },
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
            imageWidth: { type: "integer", minimum: 25, maximum: 100, description: "Image width as a percentage of card content width." },
            mapId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$", description: "Map identity for mindmap-node references." },
            sectionContext: {
              type: "object",
              properties: {
                file: { type: "string" },
                title: { type: "string" },
                level: { type: "integer", minimum: 1, maximum: 6 },
                headingPath: { type: "array", items: { type: "string" } },
                bodyHash: { type: "string" },
                label: { type: "string" },
                sourceHash: { type: "string" },
                sourceRange: {
                  type: "object",
                  properties: { from: { type: "integer", minimum: 0 }, to: { type: "integer", minimum: 0 } },
                  required: ["from", "to"],
                  additionalProperties: false,
                },
                order: { type: "integer", minimum: 0 },
              },
              additionalProperties: false,
            },
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
          tableLayout: { type: "string", enum: ["wide", "scroll"] },
          shape: { type: "string", enum: ["branch", "leaf", "callout"] },
          color: { type: "string" },
          progress: { type: ["integer", "null"], minimum: 0, maximum: 6 },
        },
        additionalProperties: false,
      },
      priority: { type: ["string", "null"], enum: ["P0", "P1", "P2", "P3", null] },
    },
    ["id", "expectedRevision"],
  ),
  attach_mindmap_image: objectSchema(
    {
      id: { type: "string" },
      assetId: { type: "string", minLength: 1, description: "Existing project figure asset path, normally from an upload result." },
      label: { type: "string" },
      expectedRevision: { type: "integer", minimum: 0 },
    },
    ["id", "assetId", "expectedRevision"],
  ),
  detach_mindmap_image: objectSchema(
    { id: { type: "string" }, assetId: { type: "string" }, expectedRevision: { type: "integer", minimum: 0 } },
    ["id", "assetId", "expectedRevision"],
  ),
  caption_mindmap_image: objectSchema(
    { id: { type: "string" }, assetId: { type: "string" }, label: { type: "string" }, expectedRevision: { type: "integer", minimum: 0 } },
    ["id", "assetId", "label", "expectedRevision"],
  ),
  read_mindmap_image: objectSchema({ id: { type: "string" }, assetId: { type: "string" } }, ["id", "assetId"]),
  highlight_mindmap_activity: objectSchema({
    since: { type: "string", description: "ISO calendar date (YYYY-MM-DD). Omit for the past seven days." },
    clear: { type: "boolean", description: "Clear the activity highlight from the open map." },
  }),
  place_todo_card: objectSchema(
    {
      todoId: { type: "string", description: "The todoId returned by the paper page add_todo tool." },
      parentId: { type: "string", description: "The existing card that should own this TODO card." },
      expectedRevision: { type: "integer", minimum: 0 },
    },
    ["todoId", "parentId", "expectedRevision"],
  ),
  convert_card_to_todo: objectSchema(
    {
      id: { type: "string" },
      sectionId: { type: "string", description: "Optional current section id from the paper outline. Omit to place the TODO at a neutral location in the manuscript root." },
      expectedRevision: { type: "integer", minimum: 0 },
      requestId: { type: "string", description: "Stable retry key. Reusing it returns the original local result." },
    },
    ["id", "expectedRevision"],
  ),
  complete_todo: objectSchema({ todoId: { type: "string" } }, ["todoId"]),
  reopen_todo: objectSchema({ todoId: { type: "string" } }, ["todoId"]),
  focus_todo_in_paper: objectSchema({ todoId: { type: "string" } }, ["todoId"]),
  set_mindmap_font_size: objectSchema({ fontSize: { type: "integer", minimum: 10, maximum: 20 }, expectedRevision: { type: "integer", minimum: 0 } }, ["fontSize", "expectedRevision"]),
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
      ...(persisted.remoteSync ? { remote: persisted.remoteSync } : {}),
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
    if (rec.imageWidth !== undefined && (typeof rec.imageWidth !== "number" || !Number.isInteger(rec.imageWidth) || rec.imageWidth < 25 || rec.imageWidth > 100)) return failResult("invalid_arguments", "imageWidth must be an integer from 25 to 100.", false);
    if (rec.mapId !== undefined && (typeof rec.mapId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rec.mapId.trim()))) return failResult("invalid_arguments", "ref mapId must be a safe persisted map id.", false);
    const sectionContext = rec.sectionContext === undefined ? undefined : coercePaperSectionRefContext(rec.sectionContext);
    if (rec.sectionContext !== undefined && !sectionContext) return failResult("invalid_arguments", "ref sectionContext must contain a paper section identity.", false);
    refs.push({
      kind,
      id: rec.id.trim(),
      ...(typeof rec.imageWidth === "number" ? { imageWidth: rec.imageWidth } : {}),
      ...(typeof rec.label === "string" && rec.label.trim() ? { label: rec.label.trim() } : {}),
      ...(url ? { url } : {}),
      ...(typeof rec.mapId === "string" && rec.mapId.trim() ? { mapId: rec.mapId.trim() } : {}),
      ...(sectionContext ? { sectionContext } : {}),
    });
  }
  if (refs.filter(ref => ref.kind === "figure").length > 1) return failResult("invalid_arguments", "Each card holds one image. Add child cards for additional images.", false);
  return okResult(refs);
}

function parsePresentationArg(
  value: unknown,
  rootId: string,
  nodeId: string,
): OperationResult<MindmapNodeContentPatch["presentation"]> {
  if (!value || typeof value !== "object") return failResult("invalid_arguments", "presentation must be an object.", false);
  const rec = value as Record<string, unknown>;
  const extra = Object.keys(rec).find((key) => !["contentFormat", "tableLayout", "shape", "color", "progress"].includes(key));
  if (extra) return failResult("invalid_arguments", `Unknown presentation property "${extra}".`, false);
  const patch: NonNullable<MindmapNodeContentPatch["presentation"]> = {};
  if (rec.contentFormat !== undefined) {
    if (rec.contentFormat !== "plain" && rec.contentFormat !== "markdown" && rec.contentFormat !== "tex") {
      return failResult("invalid_arguments", "contentFormat must be plain, markdown, or tex.", false);
    }
    patch.contentFormat = rec.contentFormat;
  }
  if (rec.tableLayout !== undefined) {
    if (rec.tableLayout !== "wide" && rec.tableLayout !== "scroll") {
      return failResult("invalid_arguments", "tableLayout must be wide or scroll.", false);
    }
    patch.tableLayout = rec.tableLayout;
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
    } else if (typeof rec.progress !== "number" || !Number.isInteger(rec.progress) || rec.progress < 0 || rec.progress > 6) {
      return failResult("invalid_arguments", "progress must be an integer from 0 to 6, or null to hide.", false);
    } else {
      patch.progress = rec.progress as MindmapNode["progress"];
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
  if (snapshot.editingBlocked && !["get_mindmap", "focus_mindmap_node", "read_mindmap_image", "focus_todo_in_paper", "set_mindmap_collapsed", "highlight_mindmap_activity"].includes(name)) return failResult("remote_conflict", "Editing is paused. Review and synchronize Git updates to resume.", true);
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
      return result.ok ? okResult({ id: result.value }, { revision: result.revision, diskHash: result.diskHash, ...(result.remote ? { remote: result.remote } : {}) }) : result;
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
      return result.ok ? okResult({ id: args.id }, { revision: result.revision, diskHash: result.diskHash, ...(result.remote ? { remote: result.remote } : {}) }) : result;
    }
    case "delete_mindmap_node": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      if (args.id === snapshot.rootId) return failResult("invalid_arguments", "The root topic cannot be deleted.", false);
      const result = await runPersistedMutation(host, () => host.deleteNode(String(args.id ?? ""), snapshot.revision));
      return result.ok ? okResult({ id: args.id }, { revision: result.revision, diskHash: result.diskHash, ...(result.remote ? { remote: result.remote } : {}) }) : result;
    }
    case "delete_mindmap_branch": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      if (args.id === snapshot.rootId) return failResult("invalid_arguments", "The root topic cannot be deleted.", false);
      if (!host.deleteBranch) return failResult("capability_unavailable", "This map cannot remove branches.", false);
      const result = await runPersistedMutation(host, () => host.deleteBranch!(String(args.id ?? ""), snapshot.revision));
      return result.ok ? okResult({ id: args.id, branch: true }, { revision: result.revision, diskHash: result.diskHash, ...(result.remote ? { remote: result.remote } : {}) }) : result;
    }
    case "set_mindmap_collapsed": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      if (typeof args.collapsed !== "boolean") return failResult("invalid_arguments", "collapsed must be a boolean.", false);
      try {
        await host.setCollapsed(String(args.id ?? ""), args.collapsed as boolean, snapshot.revision);
        const current = host.getSnapshot();
        return okResult({ id: args.id, collapsed: args.collapsed, viewLocal: current.viewLocal }, { revision: current.revision });
      } catch (error) {
        return mutationFailure(host, error);
      }
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
      if (args.caption !== undefined) {
        if (typeof args.caption !== "string") return failResult("invalid_arguments", "caption must be a string.", false);
        if (!captionWithinLimit(args.caption)) return failResult("invalid_arguments", "Card notes must be 500 words or fewer.", false);
        patch.caption = args.caption;
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
      if (args.priority !== undefined) {
        if (args.priority !== null && !["P0", "P1", "P2", "P3"].includes(String(args.priority))) {
          return failResult("invalid_arguments", "priority must be P0, P1, P2, P3, or null.", false);
        }
        patch.priority = args.priority === null ? undefined : args.priority as MindmapNode["priority"];
      }
      if (args.presentation !== undefined) {
        const presentation = parsePresentationArg(args.presentation, snapshot.rootId, String(args.id));
        if (!presentation.ok) return presentation;
        patch.presentation = presentation.value;
      }
      if (patch.title === undefined && patch.text === undefined && patch.caption === undefined && !patch.labels && !patch.refs && patch.metadata === undefined && !Object.prototype.hasOwnProperty.call(patch, "priority") && !patch.presentation) {
        return failResult("invalid_arguments", "Provide title, text, caption, labels, refs, metadata, priority, or presentation.", false);
      }
      const result = await runPersistedMutation(host, () => host.patchNode(String(args.id ?? ""), patch, snapshot.revision));
      return result.ok ? okResult({ id: args.id, patch }, { revision: result.revision, diskHash: result.diskHash, ...(result.remote ? { remote: result.remote } : {}) }) : result;
    }
    case "attach_mindmap_image": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      if (typeof args.assetId !== "string" || !args.assetId.trim() || args.assetId.includes("..")) return failResult("invalid_arguments", "assetId must be a safe existing figure reference.", false);
      if (args.label !== undefined && (typeof args.label !== "string" || args.label.length > 240)) return failResult("invalid_arguments", "label must be at most 240 characters.", false);
      const node = snapshot.nodes.find((item) => item.id === args.id)!;
      const ref: ArtifactRef = { kind: "figure", id: args.assetId.trim(), ...(typeof args.label === "string" && args.label.trim() ? { label: args.label.trim() } : {}) };
      if (node.refs?.some(item => item.kind === "figure" && item.id !== ref.id)) return failResult("invalid_arguments", "This card already has an image. Use add_mindmap_node to create a child, then attach the image there.", false);
      const refs = attachMindmapImage(node.refs || [], ref);
      const result = await runPersistedMutation(host, () => host.patchNode(String(args.id), { refs }, snapshot.revision));
      return result.ok ? okResult({ id: args.id, assetId: ref.id, refs }, { revision: result.revision, diskHash: result.diskHash, ...(result.remote ? { remote: result.remote } : {}) }) : result;
    }
    case "detach_mindmap_image": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      if (typeof args.assetId !== "string" || !args.assetId.trim()) return failResult("invalid_arguments", "assetId is required.", false);
      const node = snapshot.nodes.find((item) => item.id === args.id)!;
      if (!node.refs?.some((ref) => ref.kind === "figure" && ref.id === args.assetId)) return failResult("invalid_arguments", `Image "${args.assetId}" is not attached to this card.`, false);
      const refs = detachMindmapImage(node.refs || [], args.assetId);
      const result = await runPersistedMutation(host, () => host.patchNode(String(args.id), { refs }, snapshot.revision));
      return result.ok ? okResult({ id: args.id, assetId: args.assetId, refs }, { revision: result.revision, diskHash: result.diskHash, ...(result.remote ? { remote: result.remote } : {}) }) : result;
    }
    case "caption_mindmap_image": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      if (typeof args.assetId !== "string" || !args.assetId.trim() || typeof args.label !== "string" || args.label.length > 240) return failResult("invalid_arguments", "assetId and a label of at most 240 characters are required.", false);
      const node = snapshot.nodes.find((item) => item.id === args.id)!;
      if (!node.refs?.some((ref) => ref.kind === "figure" && ref.id === args.assetId)) return failResult("invalid_arguments", `Image "${args.assetId}" is not attached to this card.`, false);
      const refs = captionMindmapImage(node.refs || [], args.assetId, args.label);
      const result = await runPersistedMutation(host, () => host.patchNode(String(args.id), { refs }, snapshot.revision));
      return result.ok ? okResult({ id: args.id, assetId: args.assetId, refs }, { revision: result.revision, diskHash: result.diskHash, ...(result.remote ? { remote: result.remote } : {}) }) : result;
    }
    case "read_mindmap_image": {
      if (!hasNode(args.id) || typeof args.assetId !== "string" || !args.assetId.trim()) return failResult("invalid_arguments", "A valid card id and assetId are required.", false);
      const node = snapshot.nodes.find((item) => item.id === args.id)!;
      const ref = node.refs?.find((item) => item.kind === "figure" && item.id === args.assetId);
      if (!ref) return failResult("invalid_arguments", `Image "${args.assetId}" is not attached to this card.`, false);
      return okResult({ id: args.id, ref, url: artifactHref(snapshot.project, ref), mediaType: "image", bounded: true }, { revision: snapshot.revision });
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
      return result.ok ? okResult({ id: result.value, todoId }, { revision: result.revision, diskHash: result.diskHash, ...(result.remote ? { remote: result.remote } : {}) }) : result;
    }
    case "convert_card_to_todo": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      if (args.sectionId !== undefined && (typeof args.sectionId !== "string" || !args.sectionId.trim())) {
        return failResult("invalid_arguments", "sectionId must be a non-empty string when provided.", false);
      }
      if (!host.convertCardToTodo) return failResult("capability_unavailable", "This map cannot convert cards to TODOs.", false);
      let result: MindmapTodoConversionResult;
      try {
        const sectionId = typeof args.sectionId === "string" ? args.sectionId.trim() : undefined;
        result = await host.convertCardToTodo!(String(args.id), sectionId, snapshot.revision, typeof args.requestId === "string" ? args.requestId : undefined);
      } catch (error) {
        return mutationFailure(host, error);
      }
      if (!result.ok) return result;
      return okResult(
        {
          id: args.id,
          todoId: result.value.todoId,
          local: result.value.local,
          ...(result.value.sectionId ? { sectionId: result.value.sectionId } : {}),
          remote: result.value.remote,
        },
        {
          revision: result.value.mindmap.revision ?? result.revision ?? snapshot.revision,
          diskHash: result.value.mindmap.diskHash ?? result.diskHash,
        },
      );
    }
    case "complete_todo": {
      if (typeof args.todoId !== "string" || !args.todoId.trim()) return failResult("invalid_arguments", "todoId is required.", false);
      if (!host.completeTodo) return failResult("capability_unavailable", "This map cannot complete TODOs.", false);
      await host.completeTodo(String(args.todoId));
      const completedSnapshot = host.getSnapshot();
      return okResult({ todoId: args.todoId, completed: true }, {
        revision: completedSnapshot.revision,
        ...(completedSnapshot.remoteSync ? { remote: completedSnapshot.remoteSync } : {}),
      });
    }
    case "reopen_todo": {
      if (typeof args.todoId !== "string" || !args.todoId.trim()) return failResult("invalid_arguments", "todoId is required.", false);
      if (!host.reopenTodo) return failResult("capability_unavailable", "This map cannot reopen TODOs.", false);
      await host.reopenTodo(String(args.todoId));
      const reopenedSnapshot = host.getSnapshot();
      return okResult({ todoId: args.todoId, completed: false }, {
        revision: reopenedSnapshot.revision,
        ...(reopenedSnapshot.remoteSync ? { remote: reopenedSnapshot.remoteSync } : {}),
      });
    }
    case "focus_todo_in_paper": {
      if (typeof args.todoId !== "string" || !args.todoId.trim()) return failResult("invalid_arguments", "todoId is required.", false);
      host.focusTodoInPaper?.(String(args.todoId));
      return okResult({ todoId: args.todoId }, { revision: snapshot.revision });
    }
    case "set_mindmap_font_size": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      const fontSize = args.fontSize;
      if (typeof fontSize !== "number" || !Number.isInteger(fontSize) || fontSize < 10 || fontSize > 20) return failResult("invalid_arguments", "fontSize must be an integer from 10 through 20.", false);
      if (!host.setFontSize) return failResult("capability_unavailable", "Font size editing is unavailable.", false);
      const result = await runPersistedMutation(host, () => host.setFontSize!(fontSize, snapshot.revision));
      return result.ok ? okResult({ fontSize }, { revision: result.revision, diskHash: result.diskHash }) : result;
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
      return result.ok ? okResult({ title }, { revision: result.revision, diskHash: result.diskHash, ...(result.remote ? { remote: result.remote } : {}) }) : result;
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
    annotations: { readOnlyHint: name === "get_mindmap" || name === "focus_mindmap_node" || name === "read_mindmap_image", untrustedContentHint: true },
    execute: (args?: unknown) => executeMindmapWebMcpTool(host, name, args),
  }));
}

function mindmapToolDescription(name: MindmapWebMcpToolName): string {
  if (name === "get_mindmap") {
    return "Read the live mindmap: card titles, bodies, and Extended notes, hierarchy, TODO bindings, labels, refs, role, isPrimary, and revision. Ordinary card content belongs to the map. TODO title and body come from TeX; Extended notes belong to the map.";
  }
  if (name === "focus_mindmap_node") {
    return "Select a saved mindmap card on the open map. Use navigate_project first if the mindmap page is not open.";
  }
  if (name === "add_mindmap_node") {
    return "Add an agent draft under a parent with an optional title and body. The human accepts it with Save card or removes it with Delete. Edits preserve draft status. To create a TODO, convert a card after choosing a paper location.";
  }
  if (name === "move_mindmap_node") {
    return "Move a saved mindmap card to a new parent or sibling position on this map only. Does not change TeX or other maps.";
  }
  if (name === "delete_mindmap_node") {
    return "Remove one saved mindmap card while keeping its children in the same sibling position. Use delete_mindmap_branch only when the whole descendant branch should be removed.";
  }
  if (name === "delete_mindmap_branch") {
    return "Remove one saved mindmap card and all descendants. The root cannot be removed; use delete_mindmap_node when children should survive.";
  }
  if (name === "highlight_mindmap_activity") {
    return "Visually highlight cards whose meaningful content changed since a date. Omit since for the past seven days. Pan, zoom, and collapse do not count.";
  }
  if (name === "patch_mindmap_node") {
    return "Patch authored card fields: title and text (ordinary cards only), Extended note (up to 500 words), labels, refs, metadata, priority, and presentation (shape, color, contentFormat, tableLayout, progress). TODO title and text come from TeX.";
  }
  if (name === "attach_mindmap_image") return "Attach one existing project image asset to an empty card. For an occupied card, use add_mindmap_node to create a child and attach there. Use read_mindmap_image to inspect it; this changes only this map's reference list.";
  if (name === "detach_mindmap_image") return "Detach one image reference from this card without deleting the shared project asset.";
  if (name === "caption_mindmap_image") return "Change one attached image's caption/alt label without changing the asset or other references.";
  if (name === "read_mindmap_image") return "Read one attached image reference and its bounded project asset URL. The original asset remains available; no OCR or research claim is inferred.";
  if (name === "set_mindmap_collapsed") {
    return "Collapse or expand a branch in the browser view. This preference is stored locally per project and map, and it does not change the repository or Git state.";
  }
  if (name === "place_todo_card") {
    return "Add a card for an existing TeX TODO to the currently open map. Use this after the paper page add_todo tool returns todoId, choose the intended parentId, and place the card in the Primary or selected secondary map. Each map may contain one card for a TODO. The same TODO may appear on Primary and multiple secondary maps. All cards share TeX-owned text and completion. This is a shared card, not a move from another map. If the TODO is already on this map, the existing card is returned unchanged.";
  }
  if (name === "convert_card_to_todo") {
    return "Convert this ordinary card into a paper TODO using its title and main text, then bind the card to that TeX-owned id. Pass sectionId to target a current paper section, or omit it for a neutral insertion in the manuscript root. Hierarchy is preserved and completion is left unset. The result separates durable local saves from Git sync: status is pushed, pending, failed, or unconfigured. Reuse requestId to retry safely.";
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
  if (name === "set_mindmap_font_size") return "Set the open map card body font size from 10 through 20 CSS pixels. Titles and tables scale proportionally. Saved per map.";
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
