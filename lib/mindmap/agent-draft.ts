import type { MindmapNode } from "@/lib/types";

function authoredContent(node: MindmapNode): string {
  return JSON.stringify([
    ...(node.todoId ? [] : [node.title || "", node.text || ""]),
    node.caption || "", node.caution?.critical || "", node.caution?.important || "", node.caution?.background || "",
  ]);
}

/** Agent-authored content stays reviewable until a human saves the card. */
export function markAgentDraft(node: MindmapNode, previous?: MindmapNode): MindmapNode {
  return !previous || previous.agentDraft || node.agentDraft || authoredContent(node) !== authoredContent(previous)
    ? { ...node, agentDraft: true }
    : node;
}
