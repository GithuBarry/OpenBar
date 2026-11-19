import { resolvePaperSectionRef, type PaperSectionRefTarget } from "./artifact-link";
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

/** Prefer the card's single resolved destination, then the paper's sole heading. */
export function defaultPaperTodoSection(card: Pick<MindmapNode, "refs">, sections: PaperSectionRefTarget[]): string {
  const linked = new Set<string>();
  for (const ref of card.refs || []) {
    if (ref.kind !== "paper-section") continue;
    const resolved = resolvePaperSectionRef(ref, sections);
    if (resolved.status === "resolved") linked.add(resolved.section.id);
  }
  if (linked.size === 1) return [...linked][0]!;
  return sections.length === 1 ? sections[0]!.id : "";
}
