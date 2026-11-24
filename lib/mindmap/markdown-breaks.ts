type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[]; data?: unknown };

export const MARKDOWN_BR_RE = /^<br\s*\/?>$/i;
export const INLINE_MARKDOWN_BR_RE = /<br\s*\/?>/gi;

/**
 * Safely turn explicit inline `<br>`, `<br/>`, and `<br />` tags into `<br />`
 * elements without enabling raw HTML rendering or injecting a trailing newline
 * (which would double-break under `white-space: pre-line`).
 */
export function remarkLineBreaks() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || node.type === "code" || node.type === "inlineCode") return;
      node.children = node.children.map((child): MarkdownNode => {
        if (child.type === "html" && typeof child.value === "string" && MARKDOWN_BR_RE.test(child.value.trim())) {
          return { type: "markdownLineBreak", data: { hName: "br" } };
        }
        visit(child);
        return child;
      });
    };
    visit(tree);
  };
}
