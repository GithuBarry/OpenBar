import type { MindmapNode } from "@/lib/types";

/** Source size is measured with JavaScript string.length, including markup. */
export const MAX_HTML_CARD_LENGTH = 16_384;

export class HtmlCardValidationError extends Error {
  constructor(message: string) { super(message); this.name = "HtmlCardValidationError"; }
}

export function htmlCardValidationError(node: Pick<MindmapNode, "text" | "contentFormat" | "todoId">): string | undefined {
  if (node.contentFormat !== "html") return undefined;
  if (node.todoId?.trim()) return "Paper TODO cards use TeX. Use an ordinary child card for HTML content.";
  if (node.text.length > MAX_HTML_CARD_LENGTH) return `HTML card body exceeds ${MAX_HTML_CARD_LENGTH.toLocaleString("en-US")} UTF-16 code units. Shorten the HTML or use child cards and Notes.`;
}

export function assertHtmlCardBodies(nodes: readonly MindmapNode[]): void {
  for (const node of nodes) {
    const error = htmlCardValidationError(node);
    if (error) throw new HtmlCardValidationError(`Card "${node.id}": ${error}`);
  }
}
