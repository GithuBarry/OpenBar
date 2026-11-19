import { cardNotesText } from "@/lib/mindmap/caution";
import { mindmapCardContentForTodo, ordinaryMindmapCardContent } from "@/lib/research/todo-map";
import type { MindmapNode } from "@/lib/types";

/** Retain original prose that will disappear when TeX supplies the card's visible text. */
export function linkedTodoCaption(node: MindmapNode, todo: { title?: string; text: string }): string | undefined {
  const original = ordinaryMindmapCardContent(node);
  const paper = mindmapCardContentForTodo(todo);
  const paragraphs = (value: string) => value.split(/\r?\n(?:[\t ]*\r?\n)+/);
  const seen = new Set([paper.title, ...paragraphs(paper.body), ...paragraphs(cardNotesText(node.caption, node.caution))]
    .map(paragraph => paragraph.trim()));
  const additional = [original.title, ...paragraphs(original.body)].filter(paragraph => {
    const key = paragraph.trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return additional.length ? [node.caption, ...additional].filter(Boolean).join("\n\n") : node.caption;
}
