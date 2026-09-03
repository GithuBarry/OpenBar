import type { MindmapNode } from "@/lib/types";

/** Return the paper TODO ids currently bound by live nodes in one map. */
export function boundTodoIds(
  nodes: ReadonlyArray<Pick<MindmapNode, "id" | "todoId">>,
  excludedNodeId?: string,
): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.id === excludedNodeId) continue;
    const todoId = node.todoId?.trim();
    if (todoId) ids.add(todoId);
  }
  return ids;
}

/**
 * Keep picker choices derived from the editor's current nodes. A selected
 * broken card may be excluded while it is being relinked.
 */
export function availableTodoCandidates<T extends { id: string }>(
  todos: readonly T[],
  nodes: ReadonlyArray<Pick<MindmapNode, "id" | "todoId">>,
  excludedNodeId?: string,
): T[] {
  const bound = boundTodoIds(nodes, excludedNodeId);
  return todos.filter((todo) => {
    const id = todo.id.trim();
    return Boolean(id) && !bound.has(id);
  });
}
