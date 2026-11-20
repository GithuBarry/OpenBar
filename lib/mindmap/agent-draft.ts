import type { MindmapNode } from "@/lib/types";
import { markdownTableColumns, startsWithMarkdownTable } from "./markdown-table";

function looksLikeMarkdownProse(text: string): boolean {
  if (!text) return false;
  if (/\[[^\]\n]+\]\((?:https?:\/\/|\/)[^)\s]+\)/.test(text)) return true;
  if (/\*\*[^*\n]+\*\*/.test(text)) return true;
  if (/`[^`\n]+`/.test(text)) return true;
  if (/^#{1,4}\s+\S/m.test(text)) return true;
  if (/(?:^|\n)[ \t]*[-*]\s+\S[\s\S]*\n[ \t]*[-*]\s+\S/.test(text)) return true;
  return false;
}

/** Auto-detect Markdown tables and prose syntax on agent drafts with an omitted format. */
export function withAgentTableFormat(node: MindmapNode): MindmapNode {
  if (!node.agentDraft || node.todoId || node.contentFormat !== undefined) return node;
  if (node.title && /^[\t >|]*:?-/.test(node.text)) {
    const combined = `${node.title}\n${node.text}`;
    if (startsWithMarkdownTable(combined)) return { ...node, title: "", text: combined, contentFormat: "markdown" };
  }
  if (markdownTableColumns(node.text) || looksLikeMarkdownProse(node.text) || looksLikeMarkdownProse(node.title || "")) {
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
