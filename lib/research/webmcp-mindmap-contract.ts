/**
 * Mindmap page WebMCP tools. Schemas match the browser WebMCP mindmap contract.
 */

import { cautionValidationError,normalizeMindmapCaution,type MindmapCaution } from "@/lib/mindmap/caution";
import { attachMindmapImage,captionMindmapImage,detachMindmapImage } from "@/lib/mindmap/image-refs";
import { safeUrl } from "@/lib/safe-url";
import type { ArtifactRef,Mindmap,MindmapNode,MindmapNodeShape } from "@/lib/types";
import { coercePaperSectionRefContext,isArtifactKind } from "./artifact-link";
import { MINDMAP_EDIT_GUIDANCE } from "./agent-guidance";
import { MIN_CARD_WIDTH, MAX_CARD_WIDTH } from "@/lib/mindmap/card-width";
import { htmlCardValidationError, HtmlCardValidationError } from "@/lib/mindmap/html-card";
import { MINDMAP_EDIT_INPUT,MINDMAP_INPUTS } from "./command-inputs";
import { commandJsonSchema,commandJsonSchemas,parseCommandInput } from "./command-schema";
import { failResult,okResult,WEBMCP_ERROR_CODES,type OperationResult,type RemoteSyncOutcome } from "./operation-result";
import { isPrimaryMindmap as isPrimaryMindmapRole } from "./todo-map";
import { MINDMAP_WEBMCP_TOOL_NAMES,type MindmapWebMcpToolName } from "./webmcp-paper-contract";
import type { CurrentLocation,SharedWebMcpActions } from "./webmcp-shared-contract";

export { isPrimaryMindmapRole as isPrimaryMindmap };

const PRESENTATION_SHAPES = ["branch", "leaf", "callout"] as const;

export { MAX_MINDMAP_LABEL_CHARS, MAX_MINDMAP_LABELS, normalizeMindmapLabels as clampMindmapLabels } from "@/lib/mindmap/node-metadata";

export type LiveMindmapNode = Pick<
  MindmapNode,
  "agentDraft" | "id" | "parentId" | "title" | "text" | "caption" | "caution" | "todoId" | "contentFormat" | "tableLayout" | "cardWidth" | "shape" | "color" | "tags" | "progress" | "priority" | "refs" | "metadata" | "createdAt" | "updatedAt"
> & { completed?: boolean; /** Browser view preference, excluded from durable map state. */ collapsed?: boolean };

export type MindmapPresentationPatch = Pick<MindmapNode, "contentFormat" | "tableLayout" | "shape" | "color"> & {
  progress?: MindmapNode["progress"] | null;
  cardWidth?: number | null;
};

export type MindmapNodeContentPatch = {
  agentDraft?: true;
  title?: string;
  text?: string;
  caption?: string;
  caution?: MindmapCaution;
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

export type MindmapWriteAccess = { writable: boolean; code?: string; reason?: string; activeCardId?: string };

export function mindmapWriteAccess(state: {
  sessionWritable: boolean; backendUnavailable: boolean; viewOnly: boolean; recoveredDraft: boolean;
  applyingUpdates: boolean; remoteConflict: boolean; reviewingRemote: boolean; savedFileConflict: boolean;
}): MindmapWriteAccess {
  const blocked = [
    [state.backendUnavailable, "backend_unavailable", "OpenBar is reconnecting. The local draft stays in this tab."],
    [!state.sessionWritable, "write_session_required", "This tab is viewing. Contribute through the current writing tab or native MCP with the latest map revision and disk hash. Resume edit transfers browser writing access when the human requests it."],
    [state.recoveredDraft, "recovered_draft_review_required", "Review the recovered draft before editing this map."],
    [state.applyingUpdates, "updates_in_progress", "Saved updates are being applied. Wait for the latest map before editing."],
    [state.remoteConflict || state.reviewingRemote, "remote_conflict", "Review and synchronize Git updates before editing this map."],
    [state.savedFileConflict, "stale_disk_state", "The saved map changed. Load the latest saved map before editing."],
    [state.viewOnly, "view_only", "This map is set to View only. The human can enable editing here."],
  ].find(([active]) => active);
  return blocked ? { writable: false, code: String(blocked[1]), reason: String(blocked[2]) } : { writable: true };
}

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
  viewLocal: { collapsedIds: string[]; centerOnEdit: boolean };
  selectedId?: string;
  activitySince?: string;
  /** Browser-local persistence state for the live map draft. */
  localSaveState?: "dirty" | "saving" | "saved" | "conflict";
  /** Project Git synchronization state for the latest queued checkpoint. */
  remoteSaveState?: "checking" | "local" | "pending" | "syncing" | "synced" | "changed" | "blocked" | "unconfigured" | "unavailable" | "failed";
  /** Last local-save-to-Git outcome, including an actionable failure. */
  remoteSync?: RemoteSyncOutcome;
  /** Effective access for persisted edits in this browser tab. */
  writeAccess: MindmapWriteAccess;
};

export type MindmapWebMcpHost = {
  getSnapshot: () => LiveMindmapSnapshot;
  focusNode: (id: string) => void;
  setViewPreferences: (preferences: { centerOnEdit: boolean }) => void;
  addNode: (parentId: string, text?: string, expectedRevision?: number, title?: string, caution?: MindmapCaution, caption?: string, presentation?: MindmapPresentationPatch) => string | Promise<string>;
  moveNode: (id: string, parentId: string, beforeId?: string, afterId?: string, expectedRevision?: number) => void | Promise<void>;
  deleteNode: (id: string, expectedRevision?: number) => void | Promise<void>;
  deleteBranch?: (id: string, expectedRevision?: number) => void | Promise<void>;
  setCollapsed: (id: string, collapsed: boolean, expectedRevision?: number) => void | Promise<void>;
  patchNode: (id: string, patch: MindmapNodeContentPatch, expectedRevision?: number) => void | Promise<void>;
  setActivityHighlight: (since?: string) => void;
  placeTodoCard?: (todoId: string, parentId: string, expectedRevision?: number) => string | Promise<string>;
  linkTodo?: (id: string, todoId: string, expectedRevision: number) => Promise<void>;
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

export const MINDMAP_WEBMCP_TOOL_SCHEMAS = commandJsonSchemas(MINDMAP_INPUTS);

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
  if (error instanceof HtmlCardValidationError) return failResult("invalid_arguments", error.message, false);
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
  if (["remote_conflict", "write_session_required", "recovered_draft_review_required", "updates_in_progress", "view_only", "backend_unavailable", "active_card_edit"].includes(code)) {
    return failResult(code, message, {
      retryable: true,
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

export function parseCautionArg(value: unknown): OperationResult<MindmapCaution> {
  const error = cautionValidationError(value);
  if (error) return failResult("invalid_arguments", error, false);
  return okResult(normalizeMindmapCaution(value as MindmapCaution, { trim: false }) || {});
}

export function parsePresentationArg(
  value: unknown,
  rootId: string,
  nodeId: string,
): OperationResult<MindmapNodeContentPatch["presentation"]> {
  if (!value || typeof value !== "object") return failResult("invalid_arguments", "presentation must be an object.", false);
  const rec = value as Record<string, unknown>;
  const extra = Object.keys(rec).find((key) => !["contentFormat", "tableLayout", "cardWidth", "shape", "color", "progress"].includes(key));
  if (extra) return failResult("invalid_arguments", `Unknown presentation property "${extra}".`, false);
  const patch: NonNullable<MindmapNodeContentPatch["presentation"]> = {};
  if (rec.contentFormat !== undefined) {
    if (rec.contentFormat !== "plain" && rec.contentFormat !== "markdown" && rec.contentFormat !== "tex" && rec.contentFormat !== "html") {
      return failResult("invalid_arguments", "contentFormat must be plain, markdown, tex, or html.", false);
    }
    patch.contentFormat = rec.contentFormat;
  }
  if (rec.tableLayout !== undefined) {
    if (rec.tableLayout !== "wide" && rec.tableLayout !== "scroll") {
      return failResult("invalid_arguments", "tableLayout must be wide or scroll.", false);
    }
    patch.tableLayout = rec.tableLayout;
  }
  if (rec.cardWidth !== undefined) {
    if (rec.cardWidth !== null && (typeof rec.cardWidth !== "number" || !Number.isInteger(rec.cardWidth) || rec.cardWidth < MIN_CARD_WIDTH || rec.cardWidth > MAX_CARD_WIDTH)) {
      return failResult("invalid_arguments", `cardWidth must be an integer from ${MIN_CARD_WIDTH} to ${MAX_CARD_WIDTH}, or null for automatic width.`, false);
    }
    patch.cardWidth = rec.cardWidth as number | null;
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
    } else if (rec.progress !== "ditched" && (typeof rec.progress !== "number" || !Number.isInteger(rec.progress) || rec.progress < 0 || rec.progress > 6)) {
      return failResult("invalid_arguments", "progress must be an integer from 0 to 6, \"ditched\", or null to hide.", false);
    } else {
      patch.progress = rec.progress as MindmapNode["progress"];
    }
  }
  if (Object.keys(patch).length === 0) return failResult("invalid_arguments", "presentation is empty.", false);
  return okResult(patch);
}

export async function executeMindmapWebMcpTool(
  host: MindmapWebMcpHost,
  name: string,
  rawArgs?: unknown,
): Promise<OperationResult<unknown>> {
  const input = MINDMAP_INPUTS[name as MindmapWebMcpToolName];
  if (!input) return failResult("invalid_arguments", `Unknown mindmap tool "${name}".`, false);
  const parsedArgs = parseCommandInput(input, rawArgs, true);
  if (!parsedArgs.ok) return parsedArgs;
  const args = parsedArgs.value;
  const snapshot = host.getSnapshot();
  if (!snapshot.writeAccess.writable && !["get_mindmap", "focus_mindmap_node", "focus_todo_in_paper", "set_mindmap_collapsed", "highlight_mindmap_activity"].includes(name)) {
    return failResult(snapshot.writeAccess.code || "write_session_required", snapshot.writeAccess.reason || "Check editing access before changing this map.", true);
  }
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
      if (args.caption !== undefined && typeof args.caption !== "string") return failResult("invalid_arguments", "caption must be a string.", false);
      let caution: MindmapCaution | undefined;
      if (args.caution !== undefined) {
        const parsed = parseCautionArg(args.caution);
        if (!parsed.ok) return parsed;
        caution = parsed.value;
      }
      let presentation: MindmapPresentationPatch | undefined;
      if (args.presentation !== undefined) {
        const parsed = parsePresentationArg(args.presentation, snapshot.rootId, `child-of-${snapshot.rootId}`);
        if (!parsed.ok) return parsed;
        presentation = parsed.value;
      }
      const htmlError = htmlCardValidationError({ text: typeof args.text === "string" ? args.text : "", contentFormat: presentation?.contentFormat });
      if (htmlError) return failResult("invalid_arguments", htmlError, false);
      const result = await runPersistedMutation(host, () => host.addNode(
        String(args.parentId ?? ""),
        typeof args.text === "string" ? args.text : undefined,
        snapshot.revision,
        typeof args.title === "string" ? args.title : undefined,
        caution,
        typeof args.caption === "string" ? args.caption : undefined,
        presentation,
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
      if (snapshot.writeAccess.activeCardId === args.id) {
        return failResult("active_card_edit", "The human is editing this card. Add an Agent draft child or contribute to another card while the input stays open.", true);
      }
      const patch: MindmapNodeContentPatch = {};
      if (args.agentDraft === true) patch.agentDraft = true;
      if (args.title !== undefined) {
        if (typeof args.title !== "string") return failResult("invalid_arguments", "title must be a string.", false);
        if (node.todoId) return failResult("invalid_arguments", "Edit this TODO title in the manuscript with read_project_files and apply_project_edits.", false);
        patch.title = args.title;
      }
      if (args.text !== undefined) {
        if (typeof args.text !== "string") return failResult("invalid_arguments", "text must be a string.", false);
        if (node.todoId) return failResult("invalid_arguments", "Edit this TODO text in the manuscript with read_project_files and apply_project_edits.", false);
        patch.text = args.text;
      }
      if (args.caption !== undefined) {
        if (typeof args.caption !== "string") return failResult("invalid_arguments", "caption must be a string.", false);
        patch.caption = args.caption;
      }
      if (args.caution !== undefined) {
        const parsed = parseCautionArg(args.caution);
        if (!parsed.ok) return parsed;
        patch.caution = parsed.value;
      }
      if (args.labels !== undefined) patch.labels = args.labels as string[];
      if (args.refs !== undefined) {
        const refs = parseRefsArg(args.refs);
        if (!refs.ok) return refs;
        patch.refs = refs.value;
      }
      if (args.metadata !== undefined) patch.metadata = args.metadata as MindmapNodeContentPatch["metadata"];
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
      if (patch.agentDraft === undefined && patch.title === undefined && patch.text === undefined && patch.caption === undefined && patch.caution === undefined && !patch.labels && !patch.refs && patch.metadata === undefined && !Object.prototype.hasOwnProperty.call(patch, "priority") && !patch.presentation) {
        return failResult("invalid_arguments", "Provide title, text, caption, caution, labels, refs, metadata, priority, presentation, or agentDraft:true.", false);
      }
      const htmlError = htmlCardValidationError({ ...node, ...patch.presentation, text: patch.text ?? node.text });
      if (htmlError) return failResult("invalid_arguments", htmlError, false);
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
      if (node.refs?.some(item => item.kind === "figure" && item.id !== ref.id)) return failResult("invalid_arguments", "This card already has an image. Use apply_mindmap_edits with operation add to create a child, then attach the image there.", false);
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
        return okResult({ id: existing.id, parentId: existing.parentId, todoId, shared: true }, { revision: snapshot.revision, diskHash: snapshot.diskHash });
      }
      if (!host.placeTodoCard) return failResult("capability_unavailable", "This map cannot place TODOs.", false);
      const result = await runPersistedMutation(host, () => host.placeTodoCard!(todoId, String(args.parentId), snapshot.revision));
      if (!result.ok) return result;
      const placed = host.getSnapshot().nodes.find(node => node.id === result.value && node.todoId === todoId);
      if (!placed) return failResult("stale_live_state", "The map changed during placement. Read the current map and retry.", true);
      return okResult({ id: placed.id, parentId: placed.parentId, todoId }, { revision: result.revision, diskHash: result.diskHash, ...(result.remote ? { remote: result.remote } : {}) });
    }
    case "link_todo_card": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      const id = String(args.id);
      const todoId = String(args.todoId);
      if (!hasNode(id)) return failResult("invalid_arguments", "Choose an existing card to link.", false);
      if (host.hasTodo && !host.hasTodo(todoId)) return failResult("unknown_todo", "Choose a current paper TODO.", false);
      if (snapshot.nodes.some(node => node.id === id && node.todoId === todoId)) {
        return okResult({ id, todoId, shared: true }, { revision: snapshot.revision, diskHash: snapshot.diskHash });
      }
      if (snapshot.writeAccess.activeCardId === id) return failResult("active_card_edit", "The human is editing this card. Link it after they finish.", true);
      if (!host.linkTodo) return failResult("capability_unavailable", "This map cannot link existing paper TODOs.", false);
      return runPersistedMutation(host, async () => {
        await host.linkTodo!(id, todoId, snapshot.revision);
        if (!host.getSnapshot().nodes.some(node => node.id === id && node.todoId === todoId)) {
          throw Object.assign(new Error("The linked card changed. Read the current map before retrying."), { code: "stale_live_state" });
        }
        return { id, todoId };
      });
    }
    case "convert_card_to_todo": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      if (args.sectionId !== undefined && (typeof args.sectionId !== "string" || !args.sectionId.trim())) {
        return failResult("invalid_arguments", "sectionId must be a non-empty string when provided.", false);
      }
      const card = snapshot.nodes.find(node => node.id === args.id);
      if (!card?.todoId && card?.contentFormat === "html") return failResult("conversion_loss", "HTML visuals stay on the map. Create a prose task card to promote into the manuscript.", false);
      if (snapshot.writeAccess.activeCardId === args.id) return failResult("active_card_edit", "The human is editing this card. Convert it after they finish.", true);
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

async function executeManagedMapEdit(host: MindmapWebMcpHost, raw: unknown): Promise<OperationResult<unknown>> {
  const parsed = parseCommandInput(MINDMAP_EDIT_INPUT, raw, true);
  if (!parsed.ok) return parsed;
  const args = MINDMAP_EDIT_INPUT.parse(parsed.value);
  const current = host.getSnapshot();
  if (args.expectedDiskHash && args.expectedDiskHash !== current.diskHash) return failResult("stale_disk_state", "The saved map hash changed. Read get_mindmap again.", { retryable: true, currentHash: current.diskHash });
  if (args.edit.operation === "view-preferences") {
    const rev = assertRevision(args.expectedRevision, current.revision);
    if (!rev.ok) return rev;
    const preferences = args.edit.args;
    if (Object.keys(preferences).length !== 1 || typeof preferences.centerOnEdit !== "boolean") return failResult("invalid_arguments", "view-preferences requires only centerOnEdit as a boolean.", false);
    host.setViewPreferences({ centerOnEdit: preferences.centerOnEdit });
    return okResult({ viewLocal: host.getSnapshot().viewLocal }, { revision: current.revision, diskHash: current.diskHash });
  }
  const operations = {
    add: "add_mindmap_node", patch: "patch_mindmap_node", move: "move_mindmap_node",
    "delete-card": "delete_mindmap_node", "delete-branch": "delete_mindmap_branch",
    "place-todo": "place_todo_card", "link-todo": "link_todo_card", "convert-to-todo": "convert_card_to_todo",
    rename: "rename_mindmap", "font-size": "set_mindmap_font_size",
    "attach-image": "attach_mindmap_image", "detach-image": "detach_mindmap_image", "caption-image": "caption_mindmap_image",
  } as const;
  if (!Object.hasOwn(operations, args.edit.operation)) return failResult("invalid_arguments", `Use a managed map operation: ${Object.keys(operations).join(", ")}.`, false);
  const name = operations[args.edit.operation as keyof typeof operations];
  const input: Record<string, unknown> = { ...args.edit.args, expectedRevision: args.expectedRevision };
  if ("requestId" in MINDMAP_INPUTS[name].shape) input.requestId = args.requestId;
  return executeMindmapWebMcpTool(host, name, input);
}

export function buildMindmapWebMcpTools(host: MindmapWebMcpHost) {
  const tools = MINDMAP_WEBMCP_TOOL_NAMES.filter(name => name !== "apply_mindmap_edits").map((name) => ({
    name,
    title: name.replaceAll("_", " "),
    description: mindmapToolDescription(name),
    inputSchema: MINDMAP_WEBMCP_TOOL_SCHEMAS[name],
    annotations: { readOnlyHint: name === "get_mindmap" || name === "focus_mindmap_node", untrustedContentHint: true },
    execute: (args?: unknown) => executeMindmapWebMcpTool(host, name, args),
  }));
  return [...tools, {
    name: "apply_mindmap_edits",
    title: "Edit live mindmap state",
    description: `Apply a live revision-checked operation. edit.operation: add, patch, move, delete-card, delete-branch, place-todo, link-todo, convert-to-todo, rename, font-size, attach-image, detach-image, caption-image, view-preferences. args: add {parentId,title?,text?,caption?,caution?,presentation?}, patch {id,title?,text?,caption?,caution?,labels?,refs?,metadata?,presentation?,priority?,agentDraft?:true}, move {id,parentId,beforeId?,afterId?}, delete {id}, place-todo {todoId,parentId}, link-todo {id,todoId}, conversion {id,sectionId?}, rename {title}, font-size {fontSize}, images {id,assetId,label?}, view-preferences {centerOnEdit}. View preferences are stored in this browser per project and map. Cards delete promotes children, branch delete includes descendants. New cards and agent-authored content changes remain Agent draft until human Save or Delete. Contribute through the current writing tab. While a human edits one card, add Agent draft children or edit other cards. Edit TODO text/completion through project files. Set presentation.cardWidth to 180–1200 canvas pixels, or null for automatic width. ${MINDMAP_EDIT_GUIDANCE}`,
    inputSchema: commandJsonSchema(MINDMAP_EDIT_INPUT),
    annotations: { readOnlyHint: false, destructiveHint: true, untrustedContentHint: true },
    execute: (args?: unknown) => executeManagedMapEdit(host, args),
  }];
}

export function mindmapToolDescription(name: MindmapWebMcpToolName): string {
  if (name === "get_mindmap") {
    return "Read the map, current revision, effective writeAccess and activeCardId. writeAccess explains viewing, recovered drafts, conflicts and updates in progress. TODO title, text, and completion come from TeX. Other card fields belong to this map.";
  }
  if (name === "focus_mindmap_node") {
    return "Select a saved mindmap card on the open map. Use navigate_project first if the mindmap page is not open.";
  }
  if (name === "add_mindmap_node") {
    return `Create an Agent draft under the given parent at the current map revision. Supply a visible title and body and optional collapsed Notes in caption.`;
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
    return `Edit supplied fields at the current card revision. Use caption for Notes. Edit paper TODO wording through apply_project_edits.`;
  }
  if (name === "attach_mindmap_image") return "Attach one existing project image asset to an empty card. For an occupied card, use apply_mindmap_edits with operation add to create a child and attach there. Use read_project_files to inspect the asset; this changes only this map's reference list.";
  if (name === "detach_mindmap_image") return "Detach one image reference from this card without deleting the shared project asset.";
  if (name === "caption_mindmap_image") return "Change one attached image's caption/alt label without changing the asset or other references.";
  if (name === "set_mindmap_collapsed") {
    return "Collapse or expand a branch in the browser view. This preference is stored locally per project and map, and it does not change the repository or Git state.";
  }
  if (name === "place_todo_card") {
    return "Add a card for an existing TeX TODO to the currently open map. Use the stable TODO id read from the current paper, choose the intended parentId, and place the card in the Primary or selected secondary map. Each map may contain one card for a TODO. The same TODO may appear on Primary and multiple secondary maps. All cards share TeX-owned text and completion. This is a shared card, not a move from another map. If the TODO is already on this map, the existing card is returned unchanged.";
  }
  if (name === "convert_card_to_todo") {
    return "Convert this ordinary card into a paper TODO using its title and main text, then bind the card to that TeX-owned id. Pass sectionId to target a current paper section, or omit it for a neutral insertion in the manuscript root. Hierarchy is preserved and completion is left unset. The result separates durable local saves from Git sync: status is pushed, pending, failed, or unconfigured. Reuse requestId to retry safely.";
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
