/**
 * Complex table detection shared by the interactive preview and the server
 * Pandoc fragment converter. No Node filesystem; safe to import from the client.
 */

import { printRaw } from "@unified-latex/unified-latex-util-print-raw";

import { isEnvironment, parseTex } from "./tex-ast";

const TABLE_ENVS = new Set(["tabular", "tabular*", "tabularx", "longtable"]);
const COMPLEX_HINT = /\\(?:multicolumn|multirow|cline|cmidrule)\b/;

export type TableFragment = {
  key: string;
  source: string;
  from: number;
  to: number;
};

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

export function isComplexTableSource(source: string, env = "tabular"): boolean {
  if (env === "tabularx" || env === "longtable" || env === "tabular*") return true;
  return COMPLEX_HINT.test(source);
}

export function extractComplexTableFragments(source: string): TableFragment[] {
  const fragments: TableFragment[] = [];
  const seen = new Set<string>();
  const visit = (nodes: unknown[]) => {
    for (const node of nodes) {
      if (isEnvironment(node)) {
        const env = envName(node);
        if (TABLE_ENVS.has(env) || TABLE_ENVS.has(node.env || "")) {
          const slice = nodeSlice(source, node);
          if (isComplexTableSource(slice.text, env) && !seen.has(`${slice.from}:${slice.to}`)) {
            seen.add(`${slice.from}:${slice.to}`);
            fragments.push({
              key: tableFragmentKey(slice.text),
              source: slice.text,
              from: slice.from,
              to: slice.to,
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

export function wrapComplexTablesForPreview(
  source: string,
  tables: Record<string, string> | undefined,
): string {
  if (!tables || !Object.keys(tables).length) return source;
  const fragments = extractComplexTableFragments(source).filter((item) => tables[item.key]);
  let next = source;
  for (const fragment of [...fragments].sort((a, b) => b.from - a.from)) {
    next = `${next.slice(0, fragment.from)}\\obpandocTable{${fragment.key}}${next.slice(fragment.to)}`;
  }
  return next;
}
