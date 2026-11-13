import { fromMarkdown } from "mdast-util-from-markdown";

export type InlineFormat = "bold" | "italic";
export type InlineSyntax = "markdown" | "tex";
export type InlineFormattingSpan = { from: number; to: number; innerFrom: number; innerTo: number; open: string; close: string };
export type FormatChange = { from: number; to: number; insert: string; selFrom: number; selTo: number };

function wordAt(doc: string, cursor: number): { from: number; to: number } | null {
  for (const match of doc.matchAll(/[\p{L}\p{N}\p{M}]+(?:['’-][\p{L}\p{N}\p{M}]+)*/gu)) {
    if (match.index <= cursor && cursor <= match.index + match[0].length) {
      return { from: match.index, to: match.index + match[0].length };
    }
  }
  return null;
}

export function texClosingBrace(doc: string, opening: number): number | null {
  let depth = 1;
  for (let i = opening + 1; i < doc.length; i++) {
    if (doc[i] === "\\") { i++; continue; }
    if (doc[i] === "{") depth++;
    if (doc[i] === "}" && --depth === 0) return i;
  }
  return null;
}

export function inlineFormattingSpans(doc: string, syntax: InlineSyntax, kind: InlineFormat): InlineFormattingSpan[] {
  const spans: InlineFormattingSpan[] = [];
  if (syntax === "tex") {
    for (const match of doc.matchAll(/\\(textbf|emph|textit)\{/g)) {
      if (match.index > 0 && doc[match.index - 1] === "\\") continue;
      if ((kind === "bold") !== (match[1] === "textbf")) continue;
      const close = texClosingBrace(doc, match.index + match[0].length - 1);
      if (close !== null) spans.push({ from: match.index, to: close + 1, innerFrom: match.index + match[0].length, innerTo: close, open: match[0], close: "}" });
    }
    return spans;
  }
  const tree = fromMarkdown(doc);
  type AstNode = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: AstNode[] };
  const visit = (node: AstNode) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (node.type === (kind === "bold" ? "strong" : "emphasis") && from !== undefined && to !== undefined) {
      const length = kind === "bold" ? 2 : 1;
      spans.push({ from, to, innerFrom: from + length, innerTo: to - length, open: doc.slice(from, from + length), close: doc.slice(to - length, to) });
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  return spans;
}

function wrap(text: string, open: string, close: string, syntax: InlineSyntax): string {
  if (!text) return "";
  if (syntax === "tex") return open + text + close;
  // Markdown emphasis delimiters belong next to the text they format.
  return text.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_all, before, body, after) => body ? before + open + body + close + after : text);
}

/** Slice a formatted phrase while keeping nested marks balanced on each side. */
function styledSlice(doc: string, start: number, end: number, from: number, to: number, spans: InlineFormattingSpan[], syntax: InlineSyntax): string {
  let result = "";
  let cursor = start;
  const children = spans.filter((span) => span.from >= start && span.to <= end)
    .sort((a, b) => a.from - b.from || b.to - a.to);
  const plain = (left: number, right: number) => doc.slice(Math.max(left, from), Math.max(Math.max(left, from), Math.min(right, to)));
  for (const child of children) {
    if (child.from < cursor) continue;
    result += plain(cursor, child.from);
    if (from <= child.from && to >= child.to) result += doc.slice(child.from, child.to);
    else if (from < child.innerTo && to > child.innerFrom) {
      result += wrap(styledSlice(doc, child.innerFrom, child.innerTo, from, to, spans, syntax), child.open, child.close, syntax);
    }
    cursor = child.to;
  }
  result += plain(cursor, end);
  return result;
}

/** Operates on authored text, with syntax-aware toggles and zero placeholder words. */
export function formatInlineSelection(doc: string, from: number, to: number, syntax: InlineSyntax, kind: InlineFormat): FormatChange | null {
  if (from === to) {
    const word = wordAt(doc, from);
    if (!word) return null;
    ({ from, to } = word);
  }
  const span = inlineFormattingSpans(doc, syntax, kind)
    .filter((item) => (from === item.from && to === item.to) || (from >= item.innerFrom && to <= item.innerTo))
    .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
  if (span) {
    const start = Math.max(from, span.innerFrom);
    const end = Math.min(to, span.innerTo);
    const nested = [...inlineFormattingSpans(doc, syntax, "bold"), ...inlineFormattingSpans(doc, syntax, "italic")];
    const slice = (from: number, to: number) => styledSlice(doc, span.innerFrom, span.innerTo, from, to, nested, syntax);
    const before = wrap(slice(span.innerFrom, start), span.open, span.close, syntax);
    const picked = slice(start, end);
    const after = wrap(slice(end, span.innerTo), span.open, span.close, syntax);
    return { from: span.from, to: span.to, insert: before + picked + after, selFrom: span.from + before.length, selTo: span.from + before.length + picked.length };
  }
  const picked = doc.slice(from, to);
  if (!picked.trim()) return null;
  const open = syntax === "tex" ? kind === "bold" ? "\\textbf{" : "\\emph{" : kind === "bold" ? "**" : "*";
  const close = syntax === "tex" ? "}" : open;
  const leading = syntax === "markdown" ? /^\s*/.exec(picked)![0].length : 0;
  const trailing = syntax === "markdown" ? /\s*$/.exec(picked)![0].length : 0;
  return { from, to, insert: wrap(picked, open, close, syntax), selFrom: from + leading + open.length, selTo: from + picked.length - trailing + open.length };
}
