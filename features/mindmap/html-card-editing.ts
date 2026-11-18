import type { MindmapNode } from "@/lib/types";
import { ordinaryMindmapCardContent } from "@/lib/research/todo-map";

export function cardFormatPatch(node: MindmapNode, contentFormat: MindmapNode["contentFormat"]) {
  const content = ordinaryMindmapCardContent(node);
  return contentFormat === "html" || node.contentFormat === "html"
    ? { contentFormat, title: content.title, text: content.body }
    : { contentFormat };
}
