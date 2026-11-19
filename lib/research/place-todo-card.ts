import { applyMindmapAction, newNodeId } from "@/features/mindmap/mindmap-state";
import type { Mindmap } from "@/lib/types";
import { failResult, okResult } from "./operation-result";

/** A TODO has at most one card per map. Moving an existing card is a separate operation. */
export function placeTodoCard(map: Mindmap, todoId: string, parentId: string, agentDraft = false) {
  if (!map.nodes.some(node => node.id === parentId)) {
    return failResult("invalid_arguments", `Unknown parent "${parentId}". Choose a current map card.`, false);
  }
  const existing = map.nodes.find(node => node.todoId === todoId);
  if (existing) return okResult({ map, nodeId: existing.id, parentId: existing.parentId, existing: true });
  const next = applyMindmapAction(map, { type: "add-node", parentId, todoId, agentDraft, id: newNodeId() });
  if (!next.selectedId) return failResult("invalid_arguments", "Could not add the TODO to this parent.", false);
  return okResult({ map: next.mindmap, nodeId: next.selectedId, parentId, existing: false });
}
