import { indexMindmap } from "@/lib/mindmap-index";
import type { Mindmap, MindmapNode } from "@/lib/types";

export type DeletedMindmapBranch = {
  projectId: string;
  mapId: string;
  nodeId: string;
  parentId: string | null;
  nodes: MindmapNode[];
};

export function captureDeletedMindmapBranch(mindmap: Mindmap, id: string): DeletedMindmapBranch | null {
  const { nodeById, childrenByParent } = indexMindmap(mindmap);
  const node = nodeById.get(id);
  if (!node || id === mindmap.rootId) return null;
  const ids = new Set([id]), queue = [id];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const child of childrenByParent.get(queue[cursor]) || []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      queue.push(child.id);
    }
  }
  return {
    projectId: mindmap.projectId, mapId: mindmap.id || "draft", nodeId: id, parentId: node.parentId,
    nodes: structuredClone(mindmap.nodes.filter(item => ids.has(item.id))),
  };
}

/** Restore the captured branch alongside the current map's intervening edits. */
export function restoreDeletedMindmapBranch(mindmap: Mindmap, branch: DeletedMindmapBranch):
  { ok: true; mindmap: Mindmap } | { ok: false; message: string } {
  if (mindmap.projectId !== branch.projectId || (mindmap.id || "draft") !== branch.mapId) {
    return { ok: false, message: "Open the original map to revert this deletion." };
  }
  const { nodeById } = indexMindmap(mindmap);
  const existing = branch.nodes.filter(node => nodeById.has(node.id));
  if (existing.length === branch.nodes.length) return { ok: true, mindmap };
  if (existing.length) return { ok: false, message: "Some deleted card IDs are already in use. Review those cards before reverting." };
  if (branch.parentId && !nodeById.has(branch.parentId)) {
    return { ok: false, message: "The original parent card was also deleted. Restore it before reverting this branch." };
  }
  const todoIds = new Set(mindmap.nodes.flatMap(node => node.todoId?.trim() ? [node.todoId.trim()] : []));
  for (const node of branch.nodes) {
    const todoId = node.todoId?.trim();
    if (!todoId) continue;
    if (todoIds.has(todoId)) return { ok: false, message: "A deleted TODO is already placed elsewhere on this map." };
    todoIds.add(todoId);
  }
  return { ok: true, mindmap: { ...mindmap, nodes: [...mindmap.nodes, ...structuredClone(branch.nodes)] } };
}
