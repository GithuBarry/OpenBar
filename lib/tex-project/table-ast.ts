/**
 * Table structure from unified-latex, retaining exact source slices.
 */

import { isEnvironment, isMacro, parseTex, type TexNode } from "./tex-ast";
import { isComplexTableSource } from "./table-complexity";
import { texLiteralEnvironmentEnd, texVerbCommandEnd } from "./tex-literals";

export type TableCellSpan = {
  row: number;
  column: number;
  from: number;
  to: number;
  tex: string;
};

export type TableSummary = {
  tableIndex: number;
  rows: number;
  columns: number;
  markerCount: number;
  complex: boolean;
};

function isRowBreak(node: unknown): boolean {
  return isMacro(node) && (node.content === "\\" || node.content === "cr" || node.content === "tabularnewline");
}

function isCellBreak(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const record = node as { type?: string; content?: unknown };
  if (record.type === "string" && record.content === "&") return true;
  if (record.type === "alignmentTab" || record.type === "alignmenttab") return true;
  return false;
}

function isRule(node: unknown): boolean {
  return isMacro(node) && /^(?:hline|toprule|midrule|bottomrule|cline)$/.test(node.content.replace(/\*$/, ""));
}

function offsetOf(node: unknown, which: "start" | "end"): number | undefined {
  const record = node as { position?: { start?: { offset?: number }; end?: { offset?: number } } };
  const offset = record.position?.[which]?.offset;
  return typeof offset === "number" ? offset : undefined;
}

function isTrivia(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const type = (node as { type?: string }).type;
  return type === "whitespace" || type === "parbreak";
}

function isComment(node: unknown): boolean {
  return Boolean(node && typeof node === "object" && (node as { type?: string }).type === "comment");
}

function nodeSpan(node: unknown): { from: number; to: number } | undefined {
  const from = offsetOf(node, "start");
  let to = offsetOf(node, "end");
  if (from == null) return undefined;
  const args = node && typeof node === "object" && Array.isArray((node as { args?: unknown }).args)
    ? (node as { args: unknown[] }).args
    : [];
  for (const arg of args) {
    const record = arg as { closeMark?: string; content?: unknown[] };
    const argTo = offsetOf(arg, "end");
    if (argTo != null && (to == null || argTo > to)) to = argTo;
    const last = Array.isArray(record.content) ? record.content[record.content.length - 1] : undefined;
    const lastEnd = last ? offsetOf(last, "end") : undefined;
    const close = typeof record.closeMark === "string" ? record.closeMark.length : 0;
    if (lastEnd != null && (to == null || lastEnd + close > to)) to = lastEnd + close;
  }
  return to == null ? undefined : { from, to };
}

function looksLikeTabularEnv(source: string): boolean {
  return /^\s*\\begin\{(?:tabular\*?|tabularx|longtable)\}/.test(source);
}

function wrapBody(body: string): { text: string; shift: number } {
  const prefix = "\\begin{tabular}{l}";
  return { text: `${prefix}${body}\\end{tabular}`, shift: prefix.length };
}

function tabularContent(ast: { content?: unknown[] }): TexNode[] {
  const visit = (nodes: unknown[]): TexNode[] | undefined => {
    for (const node of nodes) {
      if (isEnvironment(node) && /^(?:tabular\*?|tabularx|longtable)$/.test(node.env.replace(/\*$/, ""))) {
        return node.content;
      }
      if (node && typeof node === "object" && Array.isArray((node as { content?: unknown }).content)) {
        const hit = visit((node as { content: unknown[] }).content);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  return visit(ast.content || []) ?? ((ast.content || []) as TexNode[]);
}

function tabularEnvironments(nodes: unknown[], found: Array<{ env: string; from: number; to: number }> = []) {
  for (const node of nodes) {
    if (isEnvironment(node) && /^(?:tabular\*?|tabularx|longtable)$/.test(node.env.replace(/\*$/, ""))) {
      const span = nodeSpan(node);
      if (span) found.push({ env: node.env, ...span });
      continue;
    }
    if (node && typeof node === "object" && Array.isArray((node as { content?: unknown }).content)) {
      tabularEnvironments((node as { content: unknown[] }).content, found);
    }
  }
  return found;
}

export function summarizeTabulars(source: string): TableSummary[] {
  const environments = tabularEnvironments(parseTex(source).content || []);
  return environments.map((environment, tableIndex) => {
    const tableTex = source.slice(environment.from, environment.to);
    const cells = tabularCellSpansFromTex(tableTex);
    const rows = cells.length ? Math.max(...cells.map((cell) => cell.row)) + 1 : 0;
    const columns = cells.length ? Math.max(...cells.map((cell) => cell.column)) + 1 : 0;
    return {
      tableIndex,
      rows,
      columns,
      markerCount: (tableTex.match(/\\obmarker\b/g) || []).length,
      complex: isComplexTableSource(tableTex, environment.env),
    };
  });
}

function trimSpan(source: string, from: number, to: number): { from: number; to: number; tex: string } {
  const raw = source.slice(from, to);
  const trimmed = raw.trim();
  if (!trimmed) return { from, to, tex: "" };
  const lead = raw.length - raw.trimStart().length;
  return { from: from + lead, to: from + lead + trimmed.length, tex: trimmed };
}

function spansFromNodes(source: string, nodes: TexNode[]): TableCellSpan[] {
  const spans: TableCellSpan[] = [];
  let rowIndex = 0;
  let column = 0;
  let cellFrom: number | undefined;
  let cellTo: number | undefined;
  let lastSeparatorEnd: number | undefined;
  const mark = (node: unknown) => {
    const span = nodeSpan(node);
    if (!span) return;
    if (cellFrom == null || span.from < cellFrom) cellFrom = span.from;
    if (cellTo == null || span.to > cellTo) cellTo = span.to;
  };
  const flushCell = (boundary: number) => {
    const from = cellFrom ?? boundary;
    const to = cellTo ?? boundary;
    const span = trimSpan(source, from, to);
    spans.push({ row: rowIndex, column, ...span });
    column += 1;
    cellFrom = undefined;
    cellTo = undefined;
  };
  const flushRow = (boundary: number) => {
    flushCell(boundary);
    rowIndex += 1;
    column = 0;
    lastSeparatorEnd = undefined;
  };
  for (const node of nodes) {
    if (isRowBreak(node)) {
      flushRow(offsetOf(node, "start") ?? cellTo ?? cellFrom ?? 0);
      continue;
    }
    if (isCellBreak(node)) {
      flushCell(offsetOf(node, "start") ?? cellTo ?? cellFrom ?? 0);
      lastSeparatorEnd = offsetOf(node, "end");
      continue;
    }
    if (isRule(node) || isComment(node) || (isTrivia(node) && cellFrom == null)) continue;
    mark(node);
  }
  if (cellFrom != null || column > 0) flushRow(lastSeparatorEnd ?? source.length);
  return spans;
}

/** Cell ranges in `source`. Pass a tabular body or a full `\\begin{tabular}…` env. */
export function tabularCellSpansFromTex(source: string): TableCellSpan[] {
  const wrapped = looksLikeTabularEnv(source) ? { text: source, shift: 0 } : wrapBody(source);
  const spans = spansFromNodes(wrapped.text, tabularContent(parseTex(wrapped.text)));
  return spans
    .map((span) => ({
      ...span,
      from: span.from - wrapped.shift,
      to: span.to - wrapped.shift,
    }))
    .filter((span) => span.from >= 0 && span.to >= span.from && span.to <= source.length);
}

export function tabularCellsFromTex(body: string): string[][] {
  const rows: string[][] = [];
  for (const cell of tabularCellSpansFromTex(body)) {
    const row = rows[cell.row] || (rows[cell.row] = []);
    row[cell.column] = cell.tex;
  }
  return rows.filter((item) => item.length);
}

function containsTexComment(source: string): boolean {
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\\") {
      const literalEnd = texVerbCommandEnd(source, index) ?? texLiteralEnvironmentEnd(source, index);
      if (literalEnd !== undefined) { index = literalEnd - 1; continue; }
    }
    if (source[index] !== "%") continue;
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
    if (slashes % 2 === 0) return true;
  }
  return false;
}

export function patchTabularCell(
  source: string,
  row: number,
  column: number,
  tex: string,
): { ok: true; source: string; cell: TableCellSpan } | { ok: false; reason: "missing_cell" | "comment_in_cell" } {
  const cell = tabularCellSpansFromTex(source).find((item) => item.row === row && item.column === column);
  if (!cell) return { ok: false, reason: "missing_cell" };
  if (containsTexComment(cell.tex)) return { ok: false, reason: "comment_in_cell" };
  return { ok: true, source: `${source.slice(0, cell.from)}${tex}${source.slice(cell.to)}`, cell };
}

const MARKER_CELL = "\\obmarker{todo}{result}";

function rowBreakAfter(source: string, from: number): number {
  const rest = source.slice(from);
  const match = rest.match(/^\s*\\\\/);
  if (match) return from + match[0].length;
  const end = rest.search(/\\end\{(?:tabular\*?|tabularx|longtable)\}/);
  return end >= 0 ? from + end : source.length;
}

/**
 * Append one row. Existing rows stay byte-for-byte.
 * `cells` fills the new row; omitted cells become `\\obmarker{todo}{result}`.
 */
export function addTableRow(
  source: string,
  cells: readonly string[] = [],
): { ok: true; source: string } | { ok: false; reason: "missing_cell" } {
  const spans = tabularCellSpansFromTex(source);
  if (!spans.length) return { ok: false, reason: "missing_cell" };
  const last = spans[spans.length - 1]!;
  const width = Math.max(...spans.filter((item) => item.row === last.row).map((item) => item.column)) + 1;
  const row = Array.from({ length: width }, (_, column) => cells[column] ?? MARKER_CELL);
  const insertAt = rowBreakAfter(source, last.to);
  const line = `${row.join(" & ")} \\\\`;
  const before = source.slice(0, insertAt);
  const after = source.slice(insertAt);
  const lead = before.endsWith("\n") ? "" : "\n";
  const trail = after.startsWith("\n") || after.length === 0 ? "" : "\n";
  return { ok: true, source: `${before}${lead}${line}${trail}${after}` };
}

export const insertTabularRow = addTableRow;
export const insertTableRow = addTableRow;
