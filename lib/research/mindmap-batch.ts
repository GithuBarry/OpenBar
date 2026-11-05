import type { Mindmap, MindmapNode } from "@/lib/types";
import { descendantsOf, indexMindmap } from "@/features/mindmap/mindmap-state";
import { normalizeMindmapLabels } from "@/lib/mindmap/node-metadata";
import { sha256Hex } from "@/lib/mindmap/sha256";

export type MindmapBatchChanges = {
  priority?: MindmapNode["priority"] | null;
  progress?: MindmapNode["progress"] | null;
  color?: string | null;
  labelsAdd?: string[];
  labelsRemove?: string[];
};

export type MindmapBatchInput = {
  selectedIds: string[];
  changes?: MindmapBatchChanges;
  deleteMode?: "cards" | "branches";
  move?: { parentId: string; beforeId?: string; afterId?: string };
};

export type MindmapBatchPreview = {
  token: string;
  revision: number;
  diskHash?: string;
  selectedIds: string[];
  branchRootIds: string[];
  affectedNodeIds: string[];
  removedNodeIds: string[];
  descendantCount: number;
  todoCardCount: number;
  deleteMode?: "cards" | "branches";
  move?: MindmapBatchInput["move"];
  changes?: MindmapBatchChanges;
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]),
  );
}

function canonicalInput(input: MindmapBatchInput): MindmapBatchInput {
  return {
    selectedIds: [...new Set(input.selectedIds)].sort(),
    ...(input.changes ? { changes: stable(input.changes) as MindmapBatchChanges } : {}),
    ...(input.deleteMode ? { deleteMode: input.deleteMode } : {}),
    ...(input.move ? { move: stable(input.move) as MindmapBatchInput["move"] } : {}),
  };
}

function branchRoots(mindmap: Mindmap, selected: Set<string>): MindmapNode[] {
  const index = indexMindmap(mindmap);
  return [...selected]
    .map((id) => index.nodeById.get(id))
    .filter((node): node is MindmapNode => Boolean(node))
    .filter((node) => {
      let parent = node.parentId;
      while (parent) {
        if (selected.has(parent)) return false;
        parent = index.nodeById.get(parent)?.parentId || null;
      }
      return true;
    })
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
}

function removeIds(mindmap: Mindmap, selected: Set<string>, mode: "cards" | "branches"): Set<string> {
  const removed = new Set<string>();
  for (const id of selected) {
    const node = mindmap.nodes.find((item) => item.id === id);
    if (!node || node.id === mindmap.rootId) continue;
    removed.add(id);
    if (mode === "branches") {
      for (const descendant of descendantsOf(mindmap, id)) removed.add(descendant);
    }
  }
  return removed;
}

function normalizedSelection(mindmap: Mindmap, input: MindmapBatchInput): { selected: Set<string>; ids: string[] } {
  const requested = [...new Set(input.selectedIds.filter((id) => typeof id === "string" && id.trim()))];
  if (!requested.length) throw new Error("Select at least one mindmap card.");
  const index = indexMindmap(mindmap);
  const unknown = requested.find((id) => !index.nodeById.has(id));
  if (unknown) throw new Error(`Unknown mindmap card "${unknown}".`);
  if (requested.includes(mindmap.rootId)) throw new Error("The root card cannot be selected for this operation.");
  const selected = new Set(requested);
  if (input.deleteMode && input.move) throw new Error("A batch cannot delete and move cards in one operation.");
  if (!input.deleteMode && !input.move && !input.changes) throw new Error("A batch needs changes, movement, or deletion.");
  return { selected, ids: requested };
}

export function previewMindmapBatch(mindmap: Mindmap, input: MindmapBatchInput): MindmapBatchPreview {
  const { selected, ids } = normalizedSelection(mindmap, input);
  const roots = branchRoots(mindmap, selected);
  const removed = input.deleteMode ? removeIds(mindmap, selected, input.deleteMode) : new Set<string>();
  const affected = input.deleteMode ? [...removed] : input.move ? roots.map((node) => node.id) : ids;
  const todoCardCount = [...removed].filter((id) => mindmap.nodes.find((node) => node.id === id)?.todoId).length;
  const previewBody = {
    projectId: mindmap.projectId,
    mapId: mindmap.id || "draft",
    revision: mindmap.revision ?? 0,
    diskHash: mindmap.diskHash || "",
    input: canonicalInput(input),
  };
  return {
    token: `mbp_${sha256Hex(JSON.stringify(stable(previewBody)))}`,
    revision: mindmap.revision ?? 0,
    ...(mindmap.diskHash ? { diskHash: mindmap.diskHash } : {}),
    selectedIds: ids,
    branchRootIds: roots.map((node) => node.id),
    affectedNodeIds: affected,
    removedNodeIds: [...removed],
    descendantCount: Math.max(0, removed.size - (input.deleteMode === "branches" ? ids.length : 0)),
    todoCardCount,
    ...(input.deleteMode ? { deleteMode: input.deleteMode } : {}),
    ...(input.move ? { move: input.move } : {}),
    ...(input.changes ? { changes: input.changes } : {}),
  };
}

function updateChildrenOrder(nodes: MindmapNode[]): MindmapNode[] {
  const children = new Map<string, MindmapNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = children.get(node.parentId);
    if (list) list.push(node);
    else children.set(node.parentId, [node]);
  }
  const orderById = new Map<string, number>();
  for (const list of children.values()) {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
    list.forEach((node, order) => orderById.set(node.id, order));
  }
  return nodes.map((node) => orderById.has(node.id) ? { ...node, order: orderById.get(node.id) } : node);
}

function applyDelete(mindmap: Mindmap, input: MindmapBatchInput): Mindmap {
  if (!input.deleteMode) return mindmap;
  const selected = new Set(input.selectedIds);
  const removed = removeIds(mindmap, selected, input.deleteMode);
  const index = indexMindmap(mindmap);
  const next = mindmap.nodes
    .filter((node) => !removed.has(node.id))
    .map((node) => {
      if (!node.parentId || !removed.has(node.parentId)) return node;
      let parent: string | null = node.parentId;
      while (parent && removed.has(parent)) parent = index.nodeById.get(parent)?.parentId || null;
      return { ...node, parentId: parent || mindmap.rootId };
    });
  return { ...mindmap, nodes: updateChildrenOrder(next) };
}

function applyMove(mindmap: Mindmap, input: MindmapBatchInput): Mindmap {
  if (!input.move) return mindmap;
  const selected = new Set(input.selectedIds);
  const roots = branchRoots(mindmap, selected);
  const index = indexMindmap(mindmap);
  const destination = index.nodeById.get(input.move.parentId);
  if (!destination) throw new Error(`Unknown destination card "${input.move.parentId}".`);
  for (const root of roots) {
    if (root.id === destination.id || descendantsOf(mindmap, root.id, index).has(destination.id)) {
      throw new Error("A batch move cannot place a card inside its own branch.");
    }
  }
  const rootIds = new Set(roots.map((node) => node.id));
  const siblings = (index.childrenByParent.get(destination.id) || []).filter((node) => !rootIds.has(node.id));
  let insertAt = siblings.length;
  if (input.move.beforeId) {
    const before = siblings.findIndex((node) => node.id === input.move!.beforeId);
    if (before >= 0) insertAt = before;
  } else if (input.move.afterId) {
    const after = siblings.findIndex((node) => node.id === input.move!.afterId);
    if (after >= 0) insertAt = after + 1;
  }
  const moved = roots.map((node) => ({ ...node, parentId: destination.id }));
  const ordered = [...siblings];
  ordered.splice(insertAt, 0, ...moved);
  const orderById = new Map(ordered.map((node, order) => [node.id, order]));
  return {
    ...mindmap,
    nodes: mindmap.nodes.map((node) => {
      const order = orderById.get(node.id);
      return order === undefined ? node : { ...node, ...(rootIds.has(node.id) ? { parentId: destination.id } : {}), order };
    }),
  };
}

function applyChanges(mindmap: Mindmap, input: MindmapBatchInput): Mindmap {
  const changes = input.changes;
  if (!changes) return mindmap;
  const selected = new Set(input.selectedIds);
  const addLabels = new Set((changes.labelsAdd || []).map((label) => label.trim()).filter(Boolean));
  const removeLabels = new Set((changes.labelsRemove || []).map((label) => label.trim()).filter(Boolean));
  return {
    ...mindmap,
    nodes: mindmap.nodes.map((node) => {
      if (!selected.has(node.id)) return node;
      const tags = normalizeMindmapLabels([...(node.tags || []), ...addLabels].filter((label) => !removeLabels.has(label)));
      return {
        ...node,
        ...(changes.priority !== undefined ? { priority: changes.priority || undefined } : {}),
        ...(changes.progress !== undefined ? { progress: changes.progress === null ? undefined : changes.progress } : {}),
        ...(changes.color !== undefined ? { color: changes.color || undefined } : {}),
        ...(changes.labelsAdd || changes.labelsRemove ? { tags: tags.length ? tags : undefined } : {}),
        updatedAt: new Date().toISOString(),
      };
    }),
  };
}

export function applyMindmapBatch(mindmap: Mindmap, input: MindmapBatchInput): { mindmap: Mindmap; preview: MindmapBatchPreview } {
  const preview = previewMindmapBatch(mindmap, input);
  const moved = applyMove(mindmap, input);
  const changed = applyChanges(moved, input);
  const deleted = applyDelete(changed, input);
  return { mindmap: { ...deleted, updatedAt: new Date().toISOString() }, preview };
}

export function batchTokenMatches(mindmap: Mindmap, input: MindmapBatchInput, token: string): boolean {
  return previewMindmapBatch(mindmap, input).token === token;
}
