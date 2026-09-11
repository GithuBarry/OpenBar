import type { Mindmap, MindmapNode } from "@/lib/types";

export type MindmapIndex = {
  nodeById: Map<string, MindmapNode>;
  childrenByParent: Map<string, MindmapNode[]>;
};

export function byOrder(a: MindmapNode, b: MindmapNode): number {
  return (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);
}

export function indexMindmap(mindmap: Mindmap | null | undefined): MindmapIndex {
  const nodes = Array.isArray(mindmap?.nodes) ? mindmap.nodes : [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, MindmapNode[]>();
  for (const node of nodes) {
    if (!node.parentId || !nodeById.has(node.parentId)) continue;
    const siblings = childrenByParent.get(node.parentId);
    if (siblings) siblings.push(node);
    else childrenByParent.set(node.parentId, [node]);
  }
  for (const siblings of childrenByParent.values()) siblings.sort(byOrder);
  return { nodeById, childrenByParent };
}

export function persistableMindmapNode(node: MindmapNode): MindmapNode {
  const next: MindmapNode = {
    id: node.id,
    text: node.todoId?.trim() ? "" : node.text,
    parentId: node.parentId,
  };
  // Extended notes are map-owned context for ordinary and TODO-backed cards.
  if (node.caption?.trim()) next.caption = node.caption.trim();
  if (!node.todoId?.trim() && node.title !== undefined) next.title = node.title;
  if (node.todoId?.trim()) next.todoId = node.todoId.trim();
  if (node.shape) next.shape = node.shape === "note" ? "leaf" : node.shape;
  if (node.agentDraft || node.shape === "note") next.agentDraft = true;
  if (node.metadata) next.metadata = node.metadata;
  if (node.contentFormat) next.contentFormat = node.contentFormat;
  if (node.tableLayout) next.tableLayout = node.tableLayout;
  if (node.color) next.color = node.color;
  if (node.tags?.length) next.tags = node.tags;
  if (node.progress !== undefined) next.progress = node.progress;
  if (node.priority) next.priority = node.priority;
  if (node.refs?.length) next.refs = node.refs;
  if (node.order !== undefined) next.order = node.order;
  if (node.createdAt) next.createdAt = node.createdAt;
  if (node.updatedAt) next.updatedAt = node.updatedAt;
  return next;
}

export function persistableMindmap(mindmap: Mindmap): Mindmap {
  return {
    ...mindmap,
    nodes: mindmap.nodes.map(persistableMindmapNode),
  };
}

/** Each paper TODO can have one card in a given map. Other maps may reuse it. */
export function assertUniqueMindmapTodoIds(mindmap: Mindmap): void {
  const nodeByTodo = new Map<string, string>();
  for (const node of mindmap.nodes) {
    const todoId = node.todoId?.trim();
    if (!todoId) continue;
    const previous = nodeByTodo.get(todoId);
    if (previous) throw new Error(`Mindmap binds TODO "${todoId}" to both "${previous}" and "${node.id}".`);
    nodeByTodo.set(todoId, node.id);
  }
}

export function emptyMindmap(
  projectId: string,
  spec: { id: string; title: string; role: "draft" | "planning"; rootText?: string },
): Mindmap {
  const now = new Date().toISOString();
  return {
    projectId,
    id: spec.id,
    title: spec.title,
    role: spec.role,
    rootId: "root",
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "root",
        text: spec.rootText || spec.title,
        parentId: null,
        shape: "root",
        order: 0,
        createdAt: now,
      },
    ],
  };
}

export function slugifyMindmapId(title: string): string {
  const slug = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "map";
}

/** Count a forest bottom-up in linear time, including very deep branches. */
export function countMindmapDescendants(mindmap: Mindmap): Map<string, number> {
  const nodeById = new Map(mindmap.nodes.map(node => [node.id, node]));
  const counts = new Map(mindmap.nodes.map(node => [node.id, 0]));
  const remaining = new Map(mindmap.nodes.map(node => [node.id, 0]));
  for (const node of mindmap.nodes) {
    if (node.parentId && nodeById.has(node.parentId)) remaining.set(node.parentId, remaining.get(node.parentId)! + 1);
  }
  const queue = mindmap.nodes.filter(node => remaining.get(node.id) === 0).map(node => node.id);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    const parent = nodeById.get(id)?.parentId;
    if (!parent || !nodeById.has(parent)) continue;
    counts.set(parent, counts.get(parent)! + 1 + counts.get(id)!);
    const left = remaining.get(parent)! - 1;
    remaining.set(parent, left);
    if (left === 0) queue.push(parent);
  }
  return counts;
}
