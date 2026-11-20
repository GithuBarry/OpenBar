import type { MindmapNode } from "@/lib/types";
import { startsWithMarkdownTable } from "./markdown-table";
import { looksLikeMarkdown } from "./markdown-detect";

/** Auto-detect Markdown tables and prose syntax on agent drafts with an omitted format. */
export function withAgentTableFormat(node: MindmapNode): MindmapNode {
  if (!node.agentDraft || node.todoId || node.contentFormat !== undefined) return node;
  if (node.title && /^[\t >|]*:?-/.test(node.text)) {
    const combined = `${node.title}\n${node.text}`;
    if (startsWithMarkdownTable(combined)) return { ...node, title: "", text: combined, contentFormat: "markdown" };
  }
  if (looksLikeMarkdown(node.text) || looksLikeMarkdown(node.title || "")) {
    return { ...node, contentFormat: "markdown" };
  }
  return node;
}

function authoredContent(node: MindmapNode): string {
  return JSON.stringify([
    ...(node.todoId ? [] : [node.title || "", node.text || ""]),
    node.caption || "", node.caution?.critical || "", node.caution?.important || "", node.caution?.background || "",
  ]);
}

/** Agent-authored content stays reviewable until a human saves the card. */
export function markAgentDraft(node: MindmapNode, previous?: MindmapNode): MindmapNode {
  if (!previous || authoredContent(node) !== authoredContent(previous)) {
    return withAgentTableFormat({ ...node, agentDraft: true });
  }
  return previous.agentDraft && !node.agentDraft ? { ...node, agentDraft: true } : node;
}
