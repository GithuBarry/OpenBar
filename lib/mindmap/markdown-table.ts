import type { Nodes, Table } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { stripInlineInfoNotes } from "./inline-info-notes";
import { INLINE_MARKDOWN_BR_RE } from "./markdown-breaks";

type TableMetadata = { columns: number; startsWithTable: boolean; verboseHeaders: boolean };
const recentTables = new Map<string, TableMetadata>();
const CACHE_LIMIT = 128;
const CACHE_CHARACTER_LIMIT = 256 * 1024;
const EMPTY_TABLE: TableMetadata = { columns: 0, startsWithTable: false, verboseHeaders: false };
let cachedCharacters = 0;

function cellText(node: Nodes): string {
  if ("children" in node) return node.children.map(cellText).join("");
  if (node.type === "break") return "\n";
  if ("value" in node) {
    return String(node.value).replace(INLINE_MARKDOWN_BR_RE, "\n").replace(/<[^>]*>/g, " ");
  }
  return "";
}

function cellMaxLineLength(node: Nodes): number {
  const visible = stripInlineInfoNotes(cellText(node), " ⓘ");
  return visible.split("\n").reduce((max, line) => Math.max(max, line.trim().length), 0);
}

function hasVerboseHeaders(table: Table): boolean {
  const [header, ...rows] = table.children;
  return Boolean(header && rows.length && header.children.some((cell, column) => {
    const headerLength = cellMaxLineLength(cell);
    if (headerLength < 18) return false;
    const lengths = rows.map(row => row.children[column] ? cellMaxLineLength(row.children[column]) : 0).filter(Boolean);
    if (!lengths.length) return false;
    const mean = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
    return mean <= 12 && headerLength >= mean * 2.5;
  }));
}

/** Share one GFM parse across card content, layout, and inspector metadata. */
function tableMetadata(text: string): TableMetadata {
  if (!/[\r\n][\t >|]*:?-/.test(text)) return EMPTY_TABLE;
  const cached = recentTables.get(text);
  if (cached) return cached;
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const tables: Table[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "table") tables.push(node);
    else if ("children" in node) node.children.forEach(visit);
  };
  visit(tree);
  const columns = tables.reduce((max, table) => Math.max(max, table.children[0]?.children.length ?? 0), 0);
  const first = tree.children[0];
  const startsWithTable = first?.type === "table" && !text.slice(0, first.position?.start.offset).trim();
  const metadata = { columns, startsWithTable, verboseHeaders: tables.some(hasVerboseHeaders) };
  if (text.length <= CACHE_CHARACTER_LIMIT) {
    while (recentTables.size >= CACHE_LIMIT || cachedCharacters + text.length > CACHE_CHARACTER_LIMIT) {
      const oldest = recentTables.keys().next().value!;
      cachedCharacters -= oldest.length;
      recentTables.delete(oldest);
    }
    recentTables.set(text, metadata);
    cachedCharacters += text.length;
  }
  return metadata;
}

export function markdownTableColumns(text: string): number {
  return tableMetadata(text).columns;
}

export function startsWithMarkdownTable(text: string): boolean {
  return tableMetadata(text).startsWithTable;
}

/** Compare rendered GFM cell text, including tables with optional outer pipes. */
export function markdownTableHasVerboseHeaders(text: string): boolean {
  return tableMetadata(text).verboseHeaders;
}
