import { findMacroMatches } from "@/lib/marker-codec";
import { nodesToPlainText, parseTex } from "@/lib/tex-project/tex-ast";

const ANNOTATION_MACROS = ["obtodo", "obcomment", "obmarker"];

/**
 * Count words in the manuscript body using the same plain-text projection
 * used by the paper analysis helpers. OpenBar annotations stay out of the
 * count because they are editing metadata rather than manuscript prose.
 */
export function countPaperWords(source: string): number {
  const documentStart = source.search(/\\begin\s*\{document\}/);
  const documentEnd = source.search(/\\end\s*\{document\}/);
  const bodyStart = documentStart >= 0 ? source.indexOf("\n", documentStart) + 1 : 0;
  const bodyEnd = documentEnd > bodyStart ? documentEnd : source.length;
  let body = source.slice(bodyStart, bodyEnd);

  const annotations = findMacroMatches(body, ANNOTATION_MACROS);
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const match = annotations[index]!;
    body = `${body.slice(0, match.index)}${body.slice(match.index + match.length)}`;
  }
  // Markers carry a second mandatory argument (`kind`, then placeholder
  // text). Remove that full pair so planned table cells stay out of the
  // manuscript count.
  body = body.replace(/\\obmarker\s*(?:\[[^\]\n]*\])?\s*\{[^{}]*\}\s*\{[^{}]*\}/g, " ");

  const parsed = parseTex(body);
  const plain = nodesToPlainText(parsed)
    .replace(/%[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return 0;
  return plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length || 0;
}

export function formatPaperCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)));
}
