/**
 * Browser-safe TeX repair helpers. Keep Node-only Pandoc conversion in pandoc.ts.
 */

export function suspiciousTexSequences(source: string): string[] {
  const hits: string[] = [];
  if (source.includes("\\textbackslash\\{\\}")) hits.push("escaped-backslash-braces");
  if (source.includes("\\textbackslash{}hline") || source.includes("\\textbackslash\\{\\}hline")) hits.push("escaped-hline");
  if (/\\obmarker\{[^}]+\}\s*\\\{/.test(source)) hits.push("escaped-marker-braces");
  if (/\\textbackslash(?:\\\{\\\}|\\\{\})\s*\\textbackslash(?:\\\{\\\}|\\\{\})/.test(source)) hits.push("lost-cell-delimiters");
  return hits;
}

export function proposedTableRepair(source: string): string {
  return source
    .replace(/\\textbackslash\\{\\}\\textbackslash\\{\\}/g, "\\\\")
    .replace(/\\textbackslash\\{\\}hline/g, "\\hline")
    .replace(/\\textbackslash\{\}hline/g, "\\hline")
    .replace(/\\textbackslash\\{\\}/g, "\\")
    .replace(/\\obmarker\{([^}]+)\}\\\{([^}]*)\\\}/g, "\\obmarker{$1}{$2}")
    .replace(/ \\& /g, " & ");
}
