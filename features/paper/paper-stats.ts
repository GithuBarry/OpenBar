import { visit } from "@unified-latex/unified-latex-util-visit";
import { nodesToPlainText, parseTex } from "@/lib/tex-project/tex-ast";

const ANNOTATION_MACROS = new Set(["obtodo", "obcomment", "obmarker"]);

/**
 * Count words in the manuscript body using the same plain-text projection
 * used by the paper analysis helpers. OpenBar annotations stay out of the
 * count because they are editing metadata rather than manuscript prose.
 */
export function countPaperWords(source: string): number {
  const documentStart = /\\begin\s*\{document\}/.exec(source);
  const documentEnd = source.search(/\\end\s*\{document\}/);
  const bodyStart = documentStart ? documentStart.index + documentStart[0].length : 0;
  const bodyEnd = documentEnd > bodyStart ? documentEnd : source.length;
  const parsed = parseTex(source.slice(bodyStart, bodyEnd));
  visit(parsed, (node) => {
    if (node.type === "macro" && ANNOTATION_MACROS.has(node.content)) node.args = [];
  });
  const plain = nodesToPlainText(parsed)
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return 0;
  return plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length || 0;
}

export function formatPaperCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)));
}
