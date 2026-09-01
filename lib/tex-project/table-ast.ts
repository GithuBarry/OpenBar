/**
 * Table structure from unified-latex, retaining exact source slices.
 */

import { isMacro, parseTex, type TexNode } from "./tex-ast";

function isRowBreak(node: unknown): boolean {
  return isMacro(node) && (node.content === "\\" || node.content === "cr" || node.content === "tabularnewline");
}

function isCellBreak(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const record = node as { type?: string; content?: unknown };
  if (record.type === "string" && record.content === "&") return true;
  if (record.type === "alignmentTab" || record.type === "alignmenttab") return true;
  return isMacro(node) && node.content === "&";
}

function isRule(node: unknown): boolean {
  return isMacro(node) && /^(?:hline|toprule|midrule|bottomrule|cline)$/.test(node.content.replace(/\*$/, ""));
}

function sliceOf(source: string, node: unknown): string {
  const record = node as { position?: { start?: { offset?: number }; end?: { offset?: number } } };
  const start = record.position?.start?.offset;
  const end = record.position?.end?.offset;
  if (typeof start === "number" && typeof end === "number") return source.slice(start, end);
  return "";
}

export function tabularCellsFromTex(body: string): string[][] {
  const wrapped = `\\begin{tabular}{l}${body}\\end{tabular}`;
  const ast = parseTex(wrapped);
  const env = ast.content.find((node) => node && typeof node === "object" && (node as { type?: string }).type === "environment");
  const nodes = (env && typeof env === "object" && Array.isArray((env as { content?: unknown }).content)
    ? (env as { content: TexNode[] }).content
    : ast.content) as TexNode[];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  const flushCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  const flushRow = () => {
    flushCell();
    if (row.some((item) => item)) rows.push(row);
    row = [];
  };
  for (const node of nodes) {
    if (isRowBreak(node)) {
      flushRow();
      continue;
    }
    if (isCellBreak(node)) {
      flushCell();
      continue;
    }
    if (isRule(node)) continue;
    const slice = sliceOf(wrapped, node);
    cell += slice || (typeof (node as { content?: unknown }).content === "string" ? String((node as { content: string }).content) : "");
  }
  flushRow();
  return rows.filter((item) => item.length);
}
