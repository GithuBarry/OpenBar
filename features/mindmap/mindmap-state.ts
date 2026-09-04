import { byOrder, indexMindmap, type MindmapIndex } from "@/lib/mindmap-index";
import type { Mindmap, MindmapNode } from "@/lib/types";

export { byOrder, indexMindmap };
export type { MindmapIndex };

export const HISTORY_LIMIT = 50;

export type MindmapSession = {
  mindmap: Mindmap;
  selectedId: string;
  past: Mindmap[];
  future: Mindmap[];
  revision: number;
};

/** Semantic node fields that the inspector and agent tools may edit. */
export type MindmapNodePatch = Pick<
  MindmapNode,
  "title" | "shape" | "metadata" | "contentFormat" | "color" | "refs" | "tags" | "progress"
> & { text?: string };

function semanticPatch(patch: MindmapNodePatch): MindmapNodePatch {
  const next: MindmapNodePatch = {};
  if (Object.prototype.hasOwnProperty.call(patch, "title")) next.title = patch.title;
  if (Object.prototype.hasOwnProperty.call(patch, "text")) next.text = patch.text;
  if (Object.prototype.hasOwnProperty.call(patch, "shape")) next.shape = patch.shape;
  if (Object.prototype.hasOwnProperty.call(patch, "metadata")) next.metadata = patch.metadata;
  if (Object.prototype.hasOwnProperty.call(patch, "contentFormat")) next.contentFormat = patch.contentFormat;
  if (Object.prototype.hasOwnProperty.call(patch, "color")) next.color = patch.color;
  if (Object.prototype.hasOwnProperty.call(patch, "refs")) next.refs = patch.refs;
  if (Object.prototype.hasOwnProperty.call(patch, "tags")) next.tags = patch.tags;
  if (Object.prototype.hasOwnProperty.call(patch, "progress")) next.progress = patch.progress;
  return next;
}

function patchTouchesActivity(patch: MindmapNodePatch): boolean {
  return Object.prototype.hasOwnProperty.call(patch, "title")
    || Object.prototype.hasOwnProperty.call(patch, "text")
    || Object.prototype.hasOwnProperty.call(patch, "progress")
    || Object.prototype.hasOwnProperty.call(patch, "tags")
    || Object.prototype.hasOwnProperty.call(patch, "metadata")
    || Object.prototype.hasOwnProperty.call(patch, "refs");
}

export type MindmapTreeAction =
  | { type: "add-node"; parentId: string; id: string; title?: string; text?: string; todoId?: string }
  | { type: "move-sibling"; id: string; direction: -1 | 1 }
  | { type: "edit-text"; id: string; text: string }
  | { type: "edit-card"; id: string; title: string; text: string }
  | { type: "collapse"; id: string }
  | { type: "delete-subtree"; id: string }
  | { type: "delete-node-keep-children"; id: string }
  | { type: "patch-node"; id: string; patch: MindmapNodePatch }
  | { type: "bind-todo"; id: string; todoId: string }
  | { type: "unbind-todo"; id: string; title?: string; text: string }
  | { type: "reparent"; id: string; parentId: string; beforeId?: string; afterId?: string }
  | { type: "rename-map"; title: string }
  | { type: "replace"; mindmap: Mindmap; selectedId?: string };

export type MindmapSessionAction =
  | MindmapTreeAction
  | { type: "hydrate"; mindmap: Mindmap }
  | { type: "ack-save"; diskHash?: string; persistedRevision?: number; updatedAt?: string }
  | { type: "rebase-disk-hash"; diskHash?: string }
  | { type: "select"; id: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "record-history"; before: Mindmap }
  | { type: "revert"; mindmap: Mindmap };

const TRANSIENT_TYPES = new Set<MindmapTreeAction["type"]>(["edit-text", "edit-card"]);

export function cloneMindmap<T>(value: T): T {
  return structuredClone(value);
}

export function newNodeId(): string {
  const runtimeCrypto = globalThis.crypto;
  if (typeof runtimeCrypto?.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof runtimeCrypto?.getRandomValues === "function") {
    runtimeCrypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function splitCardText(value: string): { title: string; text: string } {
  const newline = value.indexOf("\n");
  if (newline < 0) return { title: value, text: "" };
  return { title: value.slice(0, newline), text: value.slice(newline + 1) };
}

export function mapSignature(mindmap: Mindmap): string {
  return JSON.stringify({ projectId: mindmap.projectId, title: mindmap.title, rootId: mindmap.rootId, nodes: mindmap.nodes });
}

export function descendantsOf(mindmap: Mindmap, id: string, index = indexMindmap(mindmap)): Set<string> {
  const found = new Set<string>();
  const visit = (parentId: string) => {
    for (const child of index.childrenByParent.get(parentId) || []) {
      if (found.has(child.id)) continue;
      found.add(child.id);
      visit(child.id);
    }
  };
  visit(id);
  return found;
}

/** Outline used by the Map-indexed walk the editor relies on. */
export function mindmapOutline(mindmap: Mindmap | null): string {
  if (!mindmap) return "";
  const { nodeById, childrenByParent } = indexMindmap(mindmap);
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const node = nodeById.get(id);
    if (!node) return;
    const fallbackTitle = node.title !== undefined ? node.title.trim() : node.text.split("\n")[0].trim();
    const title = fallbackTitle || (node.todoId ? `TODO ${node.todoId}` : node.id);
    lines.push(`${"  ".repeat(depth)}- ${node.todoId ? "☐ " : ""}${title}`);
    for (const child of childrenByParent.get(id) || []) walk(child.id, depth + 1);
  };
  walk(mindmap.rootId, 0);
  return lines.join("\n");
}

export function createMindmapSession(mindmap: Mindmap, selectedId?: string): MindmapSession {
  const cloned = cloneMindmap(mindmap);
  const index = indexMindmap(cloned);
  const initialSelected = selectedId && index.nodeById.has(selectedId) ? selectedId : cloned.rootId;
  return {
    mindmap: cloned,
    selectedId: initialSelected,
    past: [],
    future: [],
    revision: Math.max(0, cloned.revision ?? 0),
  };
}

export function applyMindmapAction(mindmap: Mindmap, action: MindmapTreeAction): {
  mindmap: Mindmap;
  selectedId?: string;
} {
  if (action.type === "replace") {
    const next = cloneMindmap(action.mindmap);
    return { mindmap: next, selectedId: action.selectedId ?? next.rootId };
  }

  const index = indexMindmap(mindmap);

  switch (action.type) {
    case "add-node": {
      if (!index.nodeById.has(action.parentId) || index.nodeById.has(action.id)) return { mindmap };
      const siblingOrders = (index.childrenByParent.get(action.parentId) || []).map((node) => node.order ?? 0);
      const legacy = splitCardText(action.text ?? "");
      const title = action.title ?? (action.text?.trim() ? legacy.title : "New topic");
      const text = action.todoId ? "" : (action.title !== undefined ? (action.text ?? "") : legacy.text);
      return {
        selectedId: action.id,
        mindmap: {
          ...mindmap,
          nodes: [
            ...mindmap.nodes,
            {
              id: action.id,
              ...(action.todoId ? {} : { title }),
              text,
              ...(action.todoId ? { todoId: action.todoId } : {}),
              parentId: action.parentId,
              shape: "leaf",
              order: siblingOrders.length ? Math.max(...siblingOrders) + 1 : 0,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      };
    }
    case "move-sibling": {
      const node = index.nodeById.get(action.id);
      if (!node || node.parentId === null) return { mindmap };
      const siblings = index.childrenByParent.get(node.parentId) || [];
      const position = siblings.findIndex((item) => item.id === node.id);
      const other = siblings[position + action.direction];
      if (!other) return { mindmap };
      const nodeOrder = other.order ?? position + action.direction;
      const otherOrder = node.order ?? position;
      return {
        mindmap: {
          ...mindmap,
          nodes: mindmap.nodes.map((item) => {
            if (item.id === node.id) return { ...item, order: nodeOrder };
            if (item.id === other.id) return { ...item, order: otherOrder };
            return item;
          }),
        },
      };
    }
    case "edit-text": {
      const node = index.nodeById.get(action.id);
      if (node?.todoId) return { mindmap };
      const parts = splitCardText(action.text);
      return {
        mindmap: updateNode(mindmap, index, action.id, (item) => (
          item.title === parts.title && item.text === parts.text
            ? item
            : { ...item, title: parts.title, text: parts.text, updatedAt: new Date().toISOString() }
        )),
      };
    }
    case "edit-card": {
      const node = index.nodeById.get(action.id);
      if (node?.todoId) return { mindmap };
      return {
        mindmap: updateNode(mindmap, index, action.id, (item) => (
          item.title === action.title && item.text === action.text
            ? item
            : { ...item, title: action.title, text: action.text, updatedAt: new Date().toISOString() }
        )),
      };
    }
    case "collapse": {
      return {
        mindmap: updateNode(mindmap, index, action.id, (node) => ({ ...node, collapsed: !node.collapsed })),
      };
    }
    case "delete-subtree": {
      const node = index.nodeById.get(action.id);
      if (!node || node.id === mindmap.rootId) return { mindmap };
      const toRemove = descendantsOf(mindmap, node.id, index);
      toRemove.add(node.id);
      return {
        selectedId: node.parentId || mindmap.rootId,
        mindmap: { ...mindmap, nodes: mindmap.nodes.filter((item) => !toRemove.has(item.id)) },
      };
    }
    case "delete-node-keep-children": {
      const node = index.nodeById.get(action.id);
      if (!node || node.id === mindmap.rootId || !node.parentId) return { mindmap };
      const children = index.childrenByParent.get(node.id) || [];
      const parentId = node.parentId;
      const siblings = index.childrenByParent.get(parentId) || [];
      const removedPosition = siblings.findIndex((item) => item.id === node.id);
      const remaining = siblings.filter((item) => item.id !== node.id);
      const nextSiblings = [
        ...remaining.slice(0, Math.max(0, removedPosition)),
        ...children,
        ...remaining.slice(Math.max(0, removedPosition)),
      ];
      const orderById = new Map(nextSiblings.map((item, index) => [item.id, index]));
      return {
        selectedId: parentId,
        mindmap: {
          ...mindmap,
          nodes: mindmap.nodes
            .filter((item) => item.id !== node.id)
            .map((item) => {
              if (children.some((child) => child.id === item.id)) return { ...item, parentId, order: orderById.get(item.id) };
              if (orderById.has(item.id)) return { ...item, order: orderById.get(item.id) };
              return item;
            }),
        },
      };
    }
    case "bind-todo": {
      return {
        mindmap: updateNode(mindmap, index, action.id, (node) => {
          const { title: _title, ...rest } = node;
          return {
            ...rest,
            todoId: action.todoId,
            text: "",
            updatedAt: new Date().toISOString(),
          };
        }),
      };
    }
    case "unbind-todo": {
      return {
        mindmap: updateNode(mindmap, index, action.id, (node) => {
          const { todoId: _todoId, ...rest } = node;
          return {
            ...rest,
            ...(action.title !== undefined ? { title: action.title } : {}),
            text: action.text,
            updatedAt: new Date().toISOString(),
          };
        }),
      };
    }
    case "patch-node": {
      const node = index.nodeById.get(action.id);
      const patch = semanticPatch(action.patch);
      if (node?.todoId) {
        delete patch.title;
        delete patch.text;
      }
      if (Object.keys(patch).length === 0) return { mindmap };
      return {
        mindmap: updateNode(mindmap, index, action.id, (node) => ({
          ...node,
          ...patch,
          ...(patchTouchesActivity(patch) ? { updatedAt: new Date().toISOString() } : {}),
        })),
      };
    }
    case "reparent": {
      const node = index.nodeById.get(action.id);
      const parent = index.nodeById.get(action.parentId);
      if (!node || !parent || node.id === mindmap.rootId || node.id === action.parentId) return { mindmap };
      if (descendantsOf(mindmap, node.id, index).has(action.parentId)) return { mindmap };
      const siblings = (index.childrenByParent.get(action.parentId) || []).filter((item) => item.id !== node.id);
      let order = siblings.length ? Math.max(...siblings.map((item) => item.order ?? 0)) + 1 : 0;
      if (action.beforeId) {
        const target = siblings.find((item) => item.id === action.beforeId);
        order = target ? (target.order ?? 0) - 0.5 : order;
      } else if (action.afterId) {
        const target = siblings.find((item) => item.id === action.afterId);
        order = target ? (target.order ?? 0) + 0.5 : order;
      }
      const nextNodes = mindmap.nodes.map((item) => (
        item.id === node.id ? { ...item, parentId: action.parentId, order } : item
      ));
      const resorted = [...nextNodes].filter((item) => item.parentId === action.parentId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const orderById = new Map(resorted.map((item, index) => [item.id, index]));
      return {
        mindmap: {
          ...mindmap,
          nodes: nextNodes.map((item) => (
            item.parentId === action.parentId && orderById.has(item.id)
              ? { ...item, order: orderById.get(item.id) }
              : item
          )),
        },
      };
    }
    case "rename-map": {
      const title = action.title.trim();
      if (!title || title === (mindmap.title || "")) return { mindmap };
      return { mindmap: { ...mindmap, title, updatedAt: new Date().toISOString() } };
    }
  }
}

export function mindmapReducer(state: MindmapSession, action: MindmapSessionAction): MindmapSession {
  switch (action.type) {
    case "select": {
      if (action.id === state.selectedId) return state;
      if (!indexMindmap(state.mindmap).nodeById.has(action.id)) return state;
      return { ...state, selectedId: action.id };
    }
    case "hydrate":
      return { ...createMindmapSession(action.mindmap, retainSelection(action.mindmap, state.selectedId)) };
    case "ack-save": {
      const mindmap = {
        ...state.mindmap,
        ...(action.diskHash !== undefined ? { diskHash: action.diskHash } : {}),
        ...(action.persistedRevision !== undefined ? { revision: action.persistedRevision } : {}),
        ...(action.updatedAt !== undefined ? { updatedAt: action.updatedAt } : {}),
      };
      return { ...state, mindmap };
    }
    case "rebase-disk-hash":
      return {
        ...state,
        mindmap: { ...state.mindmap, diskHash: action.diskHash },
      };
    case "revert": {
      const restored = cloneMindmap(action.mindmap);
      if (mapSignature(restored) === mapSignature(state.mindmap)) return state;
      return {
        ...state,
        mindmap: restored,
        selectedId: retainSelection(restored, state.selectedId),
        revision: state.revision + 1,
      };
    }
    case "record-history": {
      if (mapSignature(action.before) === mapSignature(state.mindmap)) return state;
      return {
        ...state,
        past: pushHistory(state.past, action.before),
        future: [],
      };
    }
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        mindmap: previous,
        selectedId: retainSelection(previous, state.selectedId),
        past: state.past.slice(0, -1),
        future: [cloneMindmap(state.mindmap), ...state.future].slice(0, HISTORY_LIMIT),
        revision: state.revision + 1,
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        mindmap: next,
        selectedId: retainSelection(next, state.selectedId),
        past: pushHistory(state.past, state.mindmap),
        future: state.future.slice(1),
        revision: state.revision + 1,
      };
    }
    default: {
      const applied = applyMindmapAction(state.mindmap, action);
      if (TRANSIENT_TYPES.has(action.type)) {
        return withoutHistory(state, applied.mindmap, applied.selectedId);
      }
      return withHistory(state, applied.mindmap, applied.selectedId);
    }
  }
}

function updateNode(
  mindmap: Mindmap,
  index: MindmapIndex,
  id: string,
  mutate: (node: MindmapNode) => MindmapNode,
): Mindmap {
  if (!index.nodeById.has(id)) return mindmap;
  let changed = false;
  const nodes = mindmap.nodes.map((node) => {
    if (node.id !== id) return node;
    const next = mutate(node);
    if (next === node) return node;
    changed = true;
    return next;
  });
  return changed ? { ...mindmap, nodes } : mindmap;
}

function retainSelection(mindmap: Mindmap, selectedId: string): string {
  return indexMindmap(mindmap).nodeById.has(selectedId) ? selectedId : mindmap.rootId;
}

function pushHistory(past: Mindmap[], snapshot: Mindmap): Mindmap[] {
  return [...past.slice(-(HISTORY_LIMIT - 1)), cloneMindmap(snapshot)];
}

function withHistory(state: MindmapSession, next: Mindmap, selectedId?: string): MindmapSession {
  const nextSelected = selectedId ?? state.selectedId;
  if (next === state.mindmap && nextSelected === state.selectedId) return state;
  if (next === state.mindmap) return { ...state, selectedId: nextSelected };
  return {
    mindmap: next,
    selectedId: nextSelected,
    past: pushHistory(state.past, state.mindmap),
    future: [],
    revision: state.revision + 1,
  };
}

function withoutHistory(state: MindmapSession, next: Mindmap, selectedId?: string): MindmapSession {
  const nextSelected = selectedId ?? state.selectedId;
  if (next === state.mindmap && nextSelected === state.selectedId) return state;
  if (next === state.mindmap) return { ...state, selectedId: nextSelected };
  return { ...state, mindmap: next, selectedId: nextSelected, revision: state.revision + 1 };
}
