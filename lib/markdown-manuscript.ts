import { fromMarkdown } from "mdast-util-from-markdown";
import type { RootContent } from "mdast";

// The post contains references, never a second copy of paper TODO/comment text.
export const MARKDOWN_MANUSCRIPT_PATH = /^(?:(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.md)$/;
const anchorPattern = /^<!--ob:(todo|comment):([A-Za-z0-9][A-Za-z0-9._-]{0,127})-->$/;
export const markdownAnchorMatch = (text: string) => anchorPattern.exec(text);
export type MarkdownAnchor = { kind: "todo" | "comment"; id: string; from: number; to: number };

export function frontMatterEnd(source: string) {
  const header = /^(?:\uFEFF)?---[ \t]*\r?\n[\s\S]*?^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(source);
  return header?.index === 0 ? header[0].length : 0;
}

export function markdownIndex(source: string) {
  const start = frontMatterEnd(source);
  const tree = fromMarkdown(source.slice(start));
  const anchors: MarkdownAnchor[] = [];
  const headings: { title: string; level: number; from: number; to: number }[] = [];
  const text = (node: RootContent): string => "value" in node ? node.value : "children" in node ? node.children.map(text).join("") : "";
  function visit(node: RootContent) {
    if (!node.position) return;
    const from = start + node.position.start.offset!;
    const to = start + node.position.end.offset!;
    if (node.type === "heading") headings.push({ title: text(node), level: node.depth, from, to });
    if (node.type === "html") {
      const match = markdownAnchorMatch(node.value);
      if (match) anchors.push({ kind: match[1] as MarkdownAnchor["kind"], id: match[2]!, from, to });
    }
    if ("children" in node) node.children.forEach(visit);
  }
  tree.children.forEach(visit);
  return { start, anchors, headings };
}

export function cleanMarkdownExport(source: string) {
  let result = source;
  for (const anchor of markdownIndex(source).anchors.reverse()) result = result.slice(0, anchor.from) + result.slice(anchor.to);
  return result;
}

export function insertMarkdownAnchor(source: string, at: number, kind: MarkdownAnchor["kind"], id: string) {
  const token = `<!--ob:${kind}:${id}-->`;
  const next = source.slice(0, at) + token + source.slice(at);
  if (!Number.isInteger(at) || at < 0 || at > source.length || !anchorPattern.test(token)
    || !markdownIndex(next).anchors.some(anchor => anchor.from === at && anchor.id === id)) {
    throw new Error("Place the cursor in Markdown prose, outside the header, code, and HTML blocks.");
  }
  return next;
}

/** CodeMirror offsets count a CRLF as one character. Keep untouched bytes,
 * including mixed line endings, when applying a transaction to authored text. */
export function applyMarkdownChanges(source: string, changes: { from: number; to: number; insert: string }[]) {
  const eol = source.match(/\r\n|\r|\n/)?.[0] ?? "\n";
  let raw = 0, logical = 0, previous = 0, out = "";
  function seek(offset: number) {
    while (logical < offset && raw < source.length) {
      raw += source[raw] === "\r" && source[raw + 1] === "\n" ? 2 : 1;
      logical++;
    }
    return raw;
  }
  for (const { from, to, insert } of changes) {
    out += source.slice(previous, seek(from)) + insert.replaceAll("\n", eol);
    previous = seek(to);
  }
  return out + source.slice(previous);
}
