/**
 * Complex table detection shared by the interactive preview and the server
 * Pandoc fragment converter. No Node filesystem; safe to import from the client.
 */

import { printRaw } from "@unified-latex/unified-latex-util-print-raw";

import { patchTabularCell } from "./table-ast";
import { isEnvironment, parseTex } from "./tex-ast";
import { isComplexTableSource } from "./table-complexity";

export { isComplexTableSource } from "./table-complexity";

const TABLE_ENVS = new Set(["tabular", "tabular*", "tabularx", "longtable"]);

export type TableFragment = {
  key: string;
  source: string;
  from: number;
  to: number;
  env: string;
};

export type TablePatchError = "complex" | "missing_table" | "missing_cell";

/** FNV-1a, portable across Node and the browser. */
export function tableFragmentKey(source: string): string {
  let hash = 2166136261;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function nodeSlice(source: string, node: unknown): { text: string; from: number; to: number } {
  const record = node as { position?: { start?: { offset?: number }; end?: { offset?: number } } };
  const from = record.position?.start?.offset;
  const to = record.position?.end?.offset;
  if (typeof from === "number" && typeof to === "number" && to >= from) {
    return { text: source.slice(from, to), from, to };
  }
  const text = printRaw(node as never);
  const at = source.indexOf(text);
  return { text, from: at < 0 ? 0 : at, to: at < 0 ? text.length : at + text.length };
}

function envName(node: { env?: string }): string {
  return String(node.env || "").replace(/\*$/, "");
}

export function extractTableFragments(source: string): TableFragment[] {
  const fragments: TableFragment[] = [];
  const seen = new Set<string>();
  const visit = (nodes: unknown[]) => {
    for (const node of nodes) {
      if (isEnvironment(node)) {
        const env = envName(node);
        if (TABLE_ENVS.has(env) || TABLE_ENVS.has(node.env || "")) {
          const slice = nodeSlice(source, node);
          if (!seen.has(`${slice.from}:${slice.to}`)) {
            seen.add(`${slice.from}:${slice.to}`);
            fragments.push({
              key: tableFragmentKey(slice.text),
              source: slice.text,
              from: slice.from,
              to: slice.to,
              env,
            });
          }
        }
        if (Array.isArray(node.content)) visit(node.content);
      } else if (node && typeof node === "object" && Array.isArray((node as { content?: unknown }).content)) {
        visit((node as { content: unknown[] }).content);
      }
    }
  };
  try {
    visit(parseTex(source).content || []);
  } catch {
    return [];
  }
  return fragments.sort((a, b) => a.from - b.from);
}

export function extractComplexTableFragments(source: string): TableFragment[] {
  return extractTableFragments(source).filter((item) => isComplexTableSource(item.source, item.env));
}

/** Replace exactly one simple tabular cell. Complex tables are not patched. */
export function patchSectionTableCell(
  sectionTex: string,
  tableIndex: number,
  row: number,
  column: number,
  tex: string,
): { ok: true; tex: string } | { ok: false; reason: TablePatchError } {
  if (!Number.isInteger(tableIndex) || tableIndex < 0) return { ok: false, reason: "missing_table" };
  const tables = extractTableFragments(sectionTex);
  const table = tables[tableIndex];
  if (!table) return { ok: false, reason: "missing_table" };
  if (isComplexTableSource(table.source, table.env)) return { ok: false, reason: "complex" };
  const patched = patchTabularCell(table.source, row, column, tex);
  if (!patched.ok) return { ok: false, reason: "missing_cell" };
  return {
    ok: true,
    tex: `${sectionTex.slice(0, table.from)}${patched.source}${sectionTex.slice(table.to)}`,
  };
}
