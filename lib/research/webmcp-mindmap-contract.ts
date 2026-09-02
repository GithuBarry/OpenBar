/**
 * Mindmap page WebMCP tools. Schemas match the browser WebMCP mindmap contract.
 */

import { failResult, okResult, WEBMCP_ERROR_CODES, type OperationResult } from "./operation-result";
import { MINDMAP_WEBMCP_TOOL_NAMES, parseWebMcpArgs, unknownWebMcpArgument, type JsonSchemaObject, type MindmapWebMcpToolName } from "./webmcp-paper-contract";
import type { SharedWebMcpActions, CurrentLocation } from "./webmcp-shared-contract";
import { ARTIFACT_KINDS, isArtifactKind } from "./artifact-link";
import { safeUrl } from "@/lib/safe-url";
import type { ArtifactKind, MindmapNode, MindmapNodeShape, Maturity } from "@/lib/types";

const PRESENTATION_SHAPES = ["branch", "leaf", "note", "callout"] as const;

export type LiveMindmapNode = Pick<
  MindmapNode,
  "id" | "parentId" | "text" | "collapsed" | "contentFormat" | "maturity" | "shape" | "color" | "tags" | "progress" | "refs" | "metadata" | "createdAt" | "updatedAt"
>;

export type MindmapPresentationPatch = Pick<MindmapNode, "contentFormat" | "maturity" | "shape" | "color" | "tags" | "progress">;

export type LiveMindmapSnapshot = {
  project: string;
  mapId: string;
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
  addNode: (parentId: string, text?: string, expectedRevision?: number) => string | Promise<string>;
  renameNode: (id: string, text: string, expectedRevision?: number) => void | Promise<void>;
  moveNode: (id: string, parentId: string, beforeId?: string, afterId?: string, expectedRevision?: number) => void | Promise<void>;
  deleteNode: (id: string, expectedRevision?: number) => void | Promise<void>;
  setCollapsed: (id: string, collapsed: boolean, expectedRevision?: number) => void | Promise<void>;
  setPresentation: (id: string, patch: MindmapPresentationPatch, expectedRevision?: number) => void | Promise<void>;
  linkArtifact: (id: string, kind: ArtifactKind, artifactId: string, label?: string, url?: string, expectedRevision?: number) => void | Promise<void>;
  setActivityHighlight: (since?: string) => void;
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
    { parentId: { type: "string" }, text: { type: "string" }, expectedRevision: { type: "integer", minimum: 0 } },
    ["parentId", "expectedRevision"],
  ),
  rename_mindmap_node: objectSchema(
    { id: { type: "string" }, text: { type: "string" }, expectedRevision: { type: "integer", minimum: 0 } },
    ["id", "text", "expectedRevision"],
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
  set_mindmap_node_presentation: objectSchema(
    {
      id: { type: "string" },
      contentFormat: { type: "string", enum: ["plain", "markdown", "tex", "html"] },
      maturity: { type: "string", enum: ["empty", "hypothesized", "draft", "review", "final"] },
      shape: { type: "string", enum: ["branch", "leaf", "note", "callout"] },
      color: { type: "string" },
      tags: { type: "array", items: { type: "string" }, maxItems: 12 },
      progress: { type: "number", minimum: 0, maximum: 100 },
      expectedRevision: { type: "integer", minimum: 0 },
    },
    ["id", "expectedRevision"],
  ),
  link_mindmap_artifact: objectSchema(
    {
      id: { type: "string" },
      kind: { type: "string", enum: ARTIFACT_KINDS },
      artifactId: { type: "string" },
      label: { type: "string" },
      url: { type: "string" },
      expectedRevision: { type: "integer", minimum: 0 },
    },
    ["id", "kind", "artifactId", "expectedRevision"],
  ),
  highlight_mindmap_activity: objectSchema({
    since: { type: "string", description: "ISO calendar date (YYYY-MM-DD). Omit for the past seven days." },
    clear: { type: "boolean", description: "Clear the activity highlight from the open map." },
  }),
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
    case "get_mindmap":
      return okResult(snapshot, { revision: snapshot.revision, diskHash: snapshot.diskHash });
    case "focus_mindmap_node": {
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      host.focusNode(String(args.id ?? ""));
      return okResult({ id: args.id }, { revision: snapshot.revision });
    }
    case "add_mindmap_node": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.parentId)) return failResult("invalid_arguments", `Unknown parent "${String(args.parentId ?? "")}".`, false);
      if (args.text !== undefined && typeof args.text !== "string") return failResult("invalid_arguments", "text must be a string.", false);
      const result = await runPersistedMutation(host, () => host.addNode(
        String(args.parentId ?? ""),
        typeof args.text === "string" ? args.text : undefined,
        snapshot.revision,
      ));
      return result.ok ? okResult({ id: result.value }, { revision: result.revision, diskHash: result.diskHash }) : result;
    }
    case "rename_mindmap_node": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      if (typeof args.text !== "string") return failResult("invalid_arguments", "text must be a string.", false);
      const result = await runPersistedMutation(host, () => host.renameNode(String(args.id ?? ""), args.text as string, snapshot.revision));
      return result.ok ? okResult({ id: args.id }, { revision: result.revision, diskHash: result.diskHash }) : result;
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
    case "set_mindmap_node_presentation": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      const patch: MindmapPresentationPatch = {};
      if (args.contentFormat !== undefined) {
        if (args.contentFormat !== "plain" && args.contentFormat !== "markdown" && args.contentFormat !== "tex" && args.contentFormat !== "html") {
          return failResult("invalid_arguments", "contentFormat must be plain, markdown, tex, or html.", false);
        }
        patch.contentFormat = args.contentFormat;
      }
      if (args.maturity !== undefined) {
        if (!(["empty", "hypothesized", "draft", "review", "final"] as const).includes(args.maturity as Maturity)) {
          return failResult("invalid_arguments", "maturity is invalid.", false);
        }
        patch.maturity = args.maturity as Maturity;
      }
      if (args.shape !== undefined) {
        if (args.id === snapshot.rootId) {
          return failResult("invalid_arguments", "The root topic keeps the root style.", false);
        }
        if (!PRESENTATION_SHAPES.includes(args.shape as (typeof PRESENTATION_SHAPES)[number])) {
          return failResult("invalid_arguments", "shape is invalid.", false);
        }
        patch.shape = args.shape as MindmapNodeShape;
      }
      if (args.color !== undefined) {
        if (typeof args.color !== "string" || args.color.length > 80) return failResult("invalid_arguments", "color must be a short CSS color value.", false);
        patch.color = args.color || undefined;
      }
      if (args.tags !== undefined) {
        if (!Array.isArray(args.tags) || args.tags.length > 12 || args.tags.some((tag) => typeof tag !== "string" || !tag.trim() || tag.trim().length > 40)) {
          return failResult("invalid_arguments", "tags must contain up to 12 short labels.", false);
        }
        patch.tags = Array.from(new Set(args.tags.map((tag) => tag.trim())));
      }
      if (args.progress !== undefined) {
        if (typeof args.progress !== "number" || !Number.isFinite(args.progress) || args.progress < 0 || args.progress > 100) {
          return failResult("invalid_arguments", "progress must be a number from 0 to 100.", false);
        }
        patch.progress = Math.round(args.progress * 10) / 10;
      }
      if (Object.keys(patch).length === 0) return failResult("invalid_arguments", "Provide at least one presentation property.", false);
      const result = await runPersistedMutation(host, () => host.setPresentation(String(args.id ?? ""), patch, snapshot.revision));
      return result.ok ? okResult({ id: args.id, patch }, { revision: result.revision, diskHash: result.diskHash }) : result;
    }
    case "link_mindmap_artifact": {
      const rev = assertRevision(args.expectedRevision, snapshot.revision);
      if (!rev.ok) return rev;
      if (!hasNode(args.id)) return failResult("invalid_arguments", `Unknown mindmap node "${String(args.id ?? "")}".`, false);
      if (typeof args.kind !== "string" || !isArtifactKind(args.kind) || typeof args.artifactId !== "string" || !args.artifactId.trim()) {
        return failResult("invalid_arguments", "Artifact kind and id are required.", false);
      }
      if (args.label !== undefined && typeof args.label !== "string") return failResult("invalid_arguments", "label must be a string.", false);
      if (args.url !== undefined && (
        typeof args.url !== "string"
        || !/^https?:\/\//i.test(args.url.trim())
        || !safeUrl(args.url)
      )) {
        return failResult("invalid_arguments", "url must be an http(s) URL.", false);
      }
      const result = await runPersistedMutation(host, () => host.linkArtifact(
        String(args.id ?? ""),
        args.kind as ArtifactKind,
        (args.artifactId as string).trim(),
        args.label as string | undefined,
        typeof args.url === "string" ? args.url : undefined,
        snapshot.revision,
      ));
      return result.ok ? okResult({ id: args.id }, { revision: result.revision, diskHash: result.diskHash }) : result;
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
    return "Read the live mindmap: nodes, hierarchy, paper links, and revision. Saved nodes are researcher-authored; paper TODOs also appear as a derived activity overlay in the UI.";
  }
  if (name === "focus_mindmap_node") {
    return "Select a saved mindmap node in the open map. Use navigate_project first if the mindmap page is not open.";
  }
  if (name === "add_mindmap_node") {
    return "Add a child topic under a parent. Pass text and parentId. Presentation fields are optional; research work should use text, hierarchy, and paper links.";
  }
  if (name === "rename_mindmap_node") {
    return "Rename a saved mindmap node. Pass expectedRevision from get_mindmap.";
  }
  if (name === "move_mindmap_node") {
    return "Move a saved mindmap node to a new parent or sibling position.";
  }
  if (name === "delete_mindmap_node") {
    return "Delete a saved mindmap node. Derived paper TODOs cannot be deleted here; complete them in the manuscript.";
  }
  if (name === "highlight_mindmap_activity") {
    return "Visually highlight cards updated since a date on the open live mindmap. Omit since for the past seven days.";
  }
  if (name === "set_mindmap_node_presentation") {
    return "Optional visual presentation (shape, color, tags, progress). Prefer text and paper links for research work.";
  }
  if (name === "set_mindmap_collapsed") {
    return "Collapse or expand a branch in the live map, preserving the saved planning view.";
  }
  if (name === "link_mindmap_artifact") {
    return "Link a mindmap node to a paper section, TODO, or other project location. Use kind draft-section or draft-todo for manuscript links.";
  }
  return `Mindmap operation ${name}. Work with text, hierarchy, and paper links. The open page supplies the project.`;
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
