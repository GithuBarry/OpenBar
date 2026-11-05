/**
 * One TODO, two views: TeX meaning + mindmap placement.
 *
 * Primary Unplaced = TeX ids minus Primary bound ids. Secondary maps
 * reconcile against the same TeX TODOs but never drive global Unplaced.
 * Missing-source bindings stay on that map until the researcher repairs them.
 * draft role / id is the persisted Primary map.
 */

import { startsWithMarkdownTable } from "@/lib/mindmap/markdown-table";
import type { ArtifactRef, Mindmap, MindmapNode } from "@/lib/types";
import { todoIsComplete, todoMetaFromAttrs } from "@/lib/todo-meta";
import type { PaperTodo } from "@/lib/research/paper-analysis";
import { indexMindmap, persistableMindmap, persistableMindmapNode } from "@/lib/mindmap-index";

export { persistableMindmap, persistableMindmapNode };

const DRAFT_MINDMAP_ID = "draft";

export type TodoSyncWarning =
  | { kind: "duplicate-tex-id"; todoId: string }
  | { kind: "duplicate-binding"; todoId: string; nodeIds: string[] }
  | { kind: "missing-source"; todoId: string; nodeId: string }
  | { kind: "idless-todo"; count: number };

export type BoundTodoCard = {
  node: MindmapNode;
  todo: PaperTodo;
  completed: boolean;
  displayTitle: string;
  displayText: string;
  activityAt: string;
};

export type MissingTodoCard = {
  node: MindmapNode;
  todoId: string;
};

export type UnplacedTodoCard = {
  todo: PaperTodo;
  completed: boolean;
  displayTitle: string;
  displayText: string;
};

export type MindmapCardContent = {
  title: string;
  body: string;
};

export type TodoReconciliation = {
  bound: BoundTodoCard[];
  boundByNode: Map<string, BoundTodoCard>;
  missingByNode: Map<string, MissingTodoCard>;
  unplaced: UnplacedTodoCard[];
  missing: MissingTodoCard[];
  warnings: TodoSyncWarning[];
  texIds: string[];
  boundIds: string[];
};

const UNPLACED_PARENT = "__unplaced__";

export function isTodoCard(node: MindmapNode): boolean {
  return Boolean(node.todoId?.trim());
}

export function texTodoIdentity(todo: PaperTodo): string | null {
  const id = todo.id?.trim() || todo.attrs.id?.trim() || "";
  return id || null;
}

export function todoActivityAt(todo: PaperTodo, node?: MindmapNode): string {
  const meta = todoMetaFromAttrs(todo.attrs);
  const texTimes = [meta.updatedAt, meta.completedAt, meta.createdAt, todo.updatedAt, todo.completedAt, todo.createdAt]
    .filter(Boolean) as string[];
  const mapTimes = [node?.updatedAt, node?.createdAt].filter(Boolean) as string[];
  return [...texTimes, ...mapTimes].sort().at(-1) || "";
}

/** Read the paper-owned title when a newer paper snapshot provides one. */
export function mindmapCardContentForTodo(todo: { text: string; title?: string }): MindmapCardContent {
  const title = typeof todo.title === "string" ? todo.title.trim() : "";
  if (title) return { title, body: todo.text };
  const newline = todo.text.indexOf("\n");
  if (newline < 0) return { title: todo.text.trim(), body: "" };
  return {
    title: todo.text.slice(0, newline).trim(),
    body: todo.text.slice(newline + 1),
  };
}

/** Read the map-owned title and body, with a first-line fallback for older maps. */
export function ordinaryMindmapCardContent(node: MindmapNode): MindmapCardContent {
  const combined = node.title !== undefined ? `${node.title}
${node.text}` : node.text;
  if (node.contentFormat === "markdown" && startsWithMarkdownTable(combined)) return { title: "", body: combined.trimStart() };
  if (node.title !== undefined) return { title: node.title.trim(), body: node.text };
  const newline = node.text.indexOf("\n");
  if (newline < 0) return { title: node.text.trim(), body: "" };
  return {
    title: node.text.slice(0, newline).trim(),
    body: node.text.slice(newline + 1),
  };
}

export function joinMindmapCardContent(content: MindmapCardContent): string {
  return content.body.length > 0 ? `${content.title}\n${content.body}` : content.title;
}

export function mindmapCardContentForNode(node: MindmapNode, reconciliation: TodoReconciliation): MindmapCardContent {
  if (!node.todoId) return ordinaryMindmapCardContent(node);
  const bound = reconciliation.boundByNode.get(node.id);
  if (bound) return mindmapCardContentForTodo(bound.todo);
  const missing = reconciliation.missingByNode.get(node.id);
  if (missing) {
    const fallback = ordinaryMindmapCardContent(node);
    return {
      title: fallback.title || `Missing paper TODO: ${missing.todoId}`,
      body: fallback.body,
    };
  }
  return ordinaryMindmapCardContent(node);
}

function countBy<T>(items: T[], key: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    if (!id) continue;
    const list = groups.get(id);
    if (list) list.push(item);
    else groups.set(id, [item]);
  }
  return groups;
}

export function reconcileTodos(mindmap: Mindmap | null, todos: PaperTodo[]): TodoReconciliation {
  const warnings: TodoSyncWarning[] = [];
  const identified = todos.filter((todo) => texTodoIdentity(todo));
  const idless = todos.filter((todo) => !texTodoIdentity(todo));
  if (idless.length) warnings.push({ kind: "idless-todo", count: idless.length });

  const texById = countBy(identified, texTodoIdentity);
  for (const [id, group] of texById) {
    if (group.length > 1) {
      warnings.push({ kind: "duplicate-tex-id", todoId: id });
    }
  }
  const uniqueTex = new Map<string, PaperTodo>();
  for (const [id, group] of texById) {
    if (group.length === 1) uniqueTex.set(id, group[0]!);
  }

  const bindings = (mindmap?.nodes || []).filter((node) => node.todoId?.trim());
  const bindByTodo = countBy(bindings, (node) => node.todoId?.trim() || null);
  for (const [todoId, nodes] of bindByTodo) {
    if (nodes.length > 1) warnings.push({ kind: "duplicate-binding", todoId, nodeIds: nodes.map((node) => node.id) });
  }

  const bound: BoundTodoCard[] = [];
  const missing: MissingTodoCard[] = [];
  const boundIds = new Set<string>();

  for (const [todoId, nodes] of bindByTodo) {
    const todo = uniqueTex.get(todoId);
    if (!todo || nodes.length > 1) {
      for (const node of nodes) missing.push({ node, todoId });
      continue;
    }
    const node = nodes[0]!;
    boundIds.add(todoId);
    const content = mindmapCardContentForTodo(todo);
    bound.push({
      node,
      todo,
      completed: todoIsComplete(todo.attrs) || Boolean(todo.completedAt),
      displayTitle: content.title,
      displayText: joinMindmapCardContent(content),
      activityAt: todoActivityAt(todo, node),
    });
  }

  const unplaced: UnplacedTodoCard[] = [];
  for (const [id, todo] of uniqueTex) {
    if (boundIds.has(id)) continue;
    const content = mindmapCardContentForTodo(todo);
    unplaced.push({
      todo,
      completed: todoIsComplete(todo.attrs) || Boolean(todo.completedAt),
      displayTitle: content.title,
      displayText: joinMindmapCardContent(content),
    });
  }

  for (const item of missing) {
    warnings.push({ kind: "missing-source", todoId: item.todoId, nodeId: item.node.id });
  }

  return {
    bound,
    boundByNode: new Map(bound.map(item => [item.node.id, item])),
    missingByNode: new Map(missing.map(item => [item.node.id, item])),
    unplaced,
    missing,
    warnings,
    texIds: [...uniqueTex.keys()].sort(),
    boundIds: [...boundIds].sort(),
  };
}

export function identityHolds(reconciliation: TodoReconciliation): boolean {
  const blocking = reconciliation.warnings.filter((warning) => warning.kind !== "idless-todo");
  if (blocking.length) return false;
  return reconciliation.texIds.length === reconciliation.boundIds.length + reconciliation.unplaced.length;
}

export function displayTextForNode(node: MindmapNode, reconciliation: TodoReconciliation): string {
  return joinMindmapCardContent(mindmapCardContentForNode(node, reconciliation));
}

export function displayTitleForNode(node: MindmapNode, reconciliation: TodoReconciliation): string {
  return mindmapCardContentForNode(node, reconciliation).title;
}

export function displayBodyForNode(node: MindmapNode, reconciliation: TodoReconciliation): string {
  return mindmapCardContentForNode(node, reconciliation).body;
}

export function nodeIsComplete(node: MindmapNode, reconciliation: TodoReconciliation): boolean {
  return Boolean(reconciliation.boundByNode.get(node.id)?.completed);
}

export function nodeActivityAt(node: MindmapNode, reconciliation: TodoReconciliation): string {
  const bound = reconciliation.boundByNode.get(node.id);
  if (bound) return bound.activityAt;
  return node.updatedAt || node.createdAt || "";
}

/** Count descendant TODOs once, from leaves to roots, including deep maps. */
export function todoCountsByParent(reconciliation: TodoReconciliation, mindmap: Mindmap): Map<string, { complete: number; total: number }> {
  const { nodeById, childrenByParent } = indexMindmap(mindmap);
  const counts = new Map(mindmap.nodes.map(node => [node.id, { complete: 0, total: 0 }]));
  const remaining = new Map(mindmap.nodes.map(node => [node.id, childrenByParent.get(node.id)?.length || 0]));
  const queue = mindmap.nodes.filter(node => remaining.get(node.id) === 0);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const node = queue[cursor]!;
    const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
    if (!parent) continue;
    const own = counts.get(node.id)!;
    const target = counts.get(parent.id)!;
    target.total += own.total + (node.todoId ? 1 : 0);
    target.complete += own.complete + (node.todoId && nodeIsComplete(node, reconciliation) ? 1 : 0);
    const left = remaining.get(parent.id)! - 1;
    remaining.set(parent.id, left);
    if (left === 0) queue.push(parent);
  }
  return counts;
}

export function todosFromPaperState(
  todos: Array<{ id: string; title?: string; text: string; completed: boolean }>,
): Array<PaperTodo & { title?: string }> {
  return todos.map((todo, index) => ({
    id: todo.id,
    text: todo.text,
    ...(typeof todo.title === "string" ? { title: todo.title } : {}),
    line: index,
    start: 0,
    end: 0,
    attrs: (todo.completed ? { completed: "2020-01-01T00:00:00.000Z" } : {}) as Record<string, string>,
    macro: "obtodo",
    ...(todo.completed ? { completedAt: "2020-01-01T00:00:00.000Z" } : {}),
  }));
}

export function paperSectionRefs(node: MindmapNode): ArtifactRef[] {
  return (node.refs || []).filter((ref) => ref.kind === "paper-section");
}

/** Persisted Primary map: role `draft` or id `draft` / `mindmap`. */
export function isPrimaryMindmap(
  map?: { id?: string | null; role?: string | null } | string | null,
): boolean {
  if (map == null) return false;
  if (typeof map === "string") return !map || map === DRAFT_MINDMAP_ID || map === "mindmap";
  if (map.role === "draft") return true;
  if (map.role === "planning") return false;
  return isPrimaryMindmap(map.id || DRAFT_MINDMAP_ID);
}

export function findPrimaryMindmap<T extends { id?: string | null; role?: string | null }>(maps: T[]): T | undefined {
  return maps.find(isPrimaryMindmap);
}

export function primaryMindmapId(map?: Mindmap | null): string {
  return isPrimaryMindmap(map) ? (map?.id || DRAFT_MINDMAP_ID) : DRAFT_MINDMAP_ID;
}

export { UNPLACED_PARENT, DRAFT_MINDMAP_ID };
