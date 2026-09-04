import { Facet, RangeSetBuilder, type ChangeDesc, type Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

import { findMacroMatches } from "@/lib/marker-codec";
import { headingOccurrenceKey, texHeadingLevel } from "./heading-keys";
import { splitBundleSource } from "@/lib/tex-project/source-bundle-format";

const MACRO_NAMES = [
  "obtodo",
  "obcomment",
  "obmarker",
  "obcite",
  "cite",
  "citep",
  "citet",
  "ref",
  "label",
];

const MACRO_CLASS: Record<string, string> = {
  obtodo: "ob-cm-todo",
  obcomment: "ob-cm-comment",
  obmarker: "ob-cm-marker",
  obcite: "ob-cm-cite",
  cite: "ob-cm-cite",
  citep: "ob-cm-cite",
  citet: "ob-cm-cite",
  ref: "ob-cm-ref",
  label: "ob-cm-ref",
};

const MACRO_MARKS: Record<string, Decoration> = Object.fromEntries(
  [...new Set(Object.values(MACRO_CLASS))].map((cls) => [cls, Decoration.mark({ class: cls })]),
);

const TODO_BODY_MARK = Decoration.mark({ class: "ob-cm-todo-body" });

const ANNOTATION_BRACE_MARK = Decoration.mark({ class: "ob-cm-annotation-brace" });

const BRACE_MARK = Decoration.mark({ class: "ob-cm-brace-marker" });

const TEX_HEADING_CMD =
  /^[ \t]*\\(title|section|subsection|subsubsection|paragraph|subparagraph)\*?/;

const HEADING_CLASS = "ob-ed-heading";
const FILE_BANNER_MARK = Decoration.mark({ class: "ob-cm-file-banner" });
const INTERNAL_ENVELOPE_REPLACE = Decoration.replace({});
const EMPTY_HEADING_COUNTS = new Map<string, number>();

const INTERNAL_ENVELOPE_LINE = /^%\s*OB-(?:SECTION\b|EDIT-(?:BEGIN|END)\b)/;

/** Prior heading occurrence counts so nested file editors share global keys with the preview. */
export const headingCountSeed = Facet.define<Map<string, number>, Map<string, number>>({
  combine(maps) {
    return maps.at(-1) ?? EMPTY_HEADING_COUNTS;
  },
});

interface MarkRange {
  from: number;
  to: number;
  decoration: Decoration;
  rank: number;
  kind: string;
}

function matchDelimited(src: string, openPos: number, openCh: string, closeCh: string): number | null {
  if (src[openPos] !== openCh) return null;
  let depth = 1;
  let p = openPos + 1;
  while (p < src.length && depth > 0) {
    if (src[p] === "\\") {
      p += 2;
      continue;
    }
    if (src[p] === openCh) depth++;
    else if (src[p] === closeCh) depth--;
    p++;
  }
  return depth === 0 ? p : null;
}

function skipWs(src: string, pos: number): number {
  while (pos < src.length && (src[pos] === " " || src[pos] === "\t")) pos++;
  return pos;
}

function firstNonWs(src: string, from: number, to: number): number {
  let i = from;
  while (i < to && (src[i] === " " || src[i] === "\t")) i++;
  return i;
}

function hasUnescapedCommentBefore(text: string, index: number): boolean {
  let lineStart = index;
  while (lineStart > 0 && text.charCodeAt(lineStart - 1) !== 10) lineStart--;
  for (let i = lineStart; i < index; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === "%") return true;
  }
  return false;
}

function isEscaped(text: string, index: number): boolean {
  let n = 0;
  while (index - n - 1 >= 0 && text[index - n - 1] === "\\") n++;
  return n % 2 === 1;
}

function commentIndex(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === "%") return i;
  }
  return -1;
}

function headingMark(key: string): Decoration {
  return Decoration.mark({
    class: HEADING_CLASS,
    attributes: {
      id: `ob-ed-h-${key}`,
      "data-ob-heading-key": key,
    },
  });
}

function headingRangeOnLine(
  text: string,
  lineStart: number,
  lineEnd: number,
  counts: Map<string, number>,
): MarkRange | null {
  const contentStart = firstNonWs(text, lineStart, lineEnd);
  if (contentStart >= lineEnd || text[contentStart] === "%") return null;
  const line = text.slice(lineStart, lineEnd);
  const tex = TEX_HEADING_CMD.exec(line);
  if (!tex) return null;
  const command = tex[1]!;
  if (command === "title") return null;
  const from = lineStart + tex[0].indexOf("\\");
  let pos = lineStart + tex[0].length;
  pos = skipWs(text, pos);
  const close = matchDelimited(text, pos, "{", "}");
  if (close === null || close <= from) return null;
  const inner = text.slice(pos + 1, close - 1);
  const key = headingOccurrenceKey(texHeadingLevel(command), inner, counts);
  return { from, to: close, decoration: headingMark(key), rank: 2, kind: "heading" };
}

function collectHeadings(text: string, ranges: MarkRange[], counts: Map<string, number>): void {
  let lineStart = 0;
  while (lineStart <= text.length) {
    const nl = text.indexOf("\n", lineStart);
    const lineEnd = nl === -1 ? text.length : nl;
    const heading = headingRangeOnLine(text, lineStart, lineEnd, counts);
    if (heading) ranges.push(heading);
    if (nl === -1) break;
    lineStart = nl + 1;
  }
}

function splitChromeAndBody(
  text: string,
  index: number,
  length: number,
  body: string,
): { chromeTo: number; bodyFrom: number; bodyTo: number; openBrace: number; closeBrace: number } | null {
  const matchEnd = index + length;
  if (matchEnd <= index) return null;
  const closeBrace = matchEnd - 1;
  if (text[closeBrace] !== "}") return null;
  const bodyFrom = closeBrace - body.length;
  const openBrace = bodyFrom - 1;
  if (openBrace < index || text[openBrace] !== "{") return null;
  return { chromeTo: openBrace, bodyFrom, bodyTo: closeBrace, openBrace, closeBrace };
}

function collectMacros(text: string, ranges: MarkRange[]): void {
  for (const match of findMacroMatches(text, MACRO_NAMES)) {
    if (hasUnescapedCommentBefore(text, match.index)) continue;
    const cls = MACRO_CLASS[match.name];
    const decoration = cls ? MACRO_MARKS[cls] : undefined;
    if (!decoration) continue;
    if (match.name === "obtodo" || match.name === "obcomment") {
      const split = splitChromeAndBody(text, match.index, match.length, match.body);
      if (split) {
        if (split.chromeTo > match.index) {
          ranges.push({
            from: match.index,
            to: split.chromeTo,
            decoration,
            rank: 0,
            kind: match.name,
          });
        }
        ranges.push({
          from: split.openBrace,
          to: split.openBrace + 1,
          decoration: ANNOTATION_BRACE_MARK,
          rank: 1,
          kind: `${match.name}-brace`,
        });
        if (split.bodyTo > split.bodyFrom) {
          ranges.push({
            from: split.bodyFrom,
            to: split.bodyTo,
            decoration: match.name === "obtodo" ? TODO_BODY_MARK : decoration,
            rank: 0,
            kind: `${match.name}-body`,
          });
        }
        ranges.push({
          from: split.closeBrace,
          to: split.closeBrace + 1,
          decoration: ANNOTATION_BRACE_MARK,
          rank: 1,
          kind: `${match.name}-brace`,
        });
        continue;
      }
    }
    let to = match.index + match.length;
    if (match.name === "obmarker") {
      const second = matchDelimited(text, skipWs(text, to), "{", "}");
      if (second !== null) to = second;
    }
    if (to > match.index) {
      ranges.push({ from: match.index, to, decoration, rank: 0, kind: match.name });
    }
  }
}

function collectBraceMarkers(text: string, ranges: MarkRange[]): void {
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const from = text.indexOf("{?", searchFrom);
    if (from === -1) break;
    searchFrom = from + 2;
    if (hasUnescapedCommentBefore(text, from)) continue;
    const close = matchDelimited(text, from, "{", "}");
    if (close === null) continue;
    const inner = text.slice(from + 2, close - 1).trimStart();
    if (!/^(notfinal|placeholder|verify|cite|citation-needed|todo)\b/i.test(inner)) continue;
    ranges.push({ from, to: close, decoration: BRACE_MARK, rank: 1, kind: "brace" });
    searchFrom = close;
  }
}

function collectInternalEnvelopeLines(text: string, ranges: MarkRange[]): void {
  let lineStart = 0;
  while (lineStart <= text.length) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    if (INTERNAL_ENVELOPE_LINE.test(text.slice(lineStart, lineEnd))) {
      ranges.push({
        from: lineStart,
        to: lineEnd,
        decoration: INTERNAL_ENVELOPE_REPLACE,
        rank: 3,
        kind: "internal-envelope",
      });
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
}

function collectMarkRanges(text: string, counts = new Map<string, number>()): MarkRange[] {
  const ranges: MarkRange[] = [];
  collectInternalEnvelopeLines(text, ranges);
  collectHeadings(text, ranges, counts);
  collectMacros(text, ranges);
  collectBraceMarkers(text, ranges);
  for (const part of splitBundleSource(text)) {
    if (part.bodyFrom > part.bannerFrom) {
      ranges.push({
        from: part.bannerFrom,
        to: part.bodyFrom,
        decoration: FILE_BANNER_MARK,
        rank: 2,
        kind: "file-banner",
      });
    }
  }
  ranges.sort((a, b) => a.from - b.from || b.rank - a.rank || a.to - b.to);
  return ranges;
}

function addMarks(builder: RangeSetBuilder<Decoration>, ranges: MarkRange[]): void {
  let lastTo = 0;
  for (const range of ranges) {
    if (range.from < lastTo || range.from >= range.to) continue;
    builder.add(range.from, range.to, range.decoration);
    lastTo = range.to;
  }
}

export function collectObDecorationRanges(text: string): { from: number; to: number; kind: string }[] {
  const out: { from: number; to: number; kind: string }[] = [];
  let lastTo = 0;
  for (const range of collectMarkRanges(text)) {
    if (range.from < lastTo || range.from >= range.to) continue;
    out.push({ from: range.from, to: range.to, kind: range.kind });
    lastTo = range.to;
  }
  return out;
}

export function decorationsForDoc(doc: Text | string, seed?: Map<string, number>): DecorationSet {
  const text = typeof doc === "string" ? doc : doc.toString();
  const builder = new RangeSetBuilder<Decoration>();
  addMarks(builder, collectMarkRanges(text, seed ? new Map(seed) : new Map()));
  return builder.finish();
}

function lineIsHeading(line: string): boolean {
  const i = firstNonWs(line, 0, line.length);
  return i < line.length && line[i] !== "%" && TEX_HEADING_CMD.test(line);
}

function sliceHasHeading(slice: string): boolean {
  let lineStart = 0;
  while (lineStart <= slice.length) {
    const nl = slice.indexOf("\n", lineStart);
    const lineEnd = nl === -1 ? slice.length : nl;
    if (lineIsHeading(slice.slice(lineStart, lineEnd))) return true;
    if (nl === -1) break;
    lineStart = nl + 1;
  }
  return false;
}

function seedHeadingCounts(doc: Text, before: number, counts: Map<string, number>): void {
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.from >= before) break;
    headingRangeOnLine(line.text, 0, line.text.length, counts);
  }
}

function laterHeadings(doc: Text, after: number, counts: Map<string, number>): MarkRange[] {
  const ranges: MarkRange[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.from <= after) continue;
    const heading = headingRangeOnLine(line.text, 0, line.text.length, counts);
    if (heading) {
      ranges.push({ ...heading, from: heading.from + line.from, to: heading.to + line.from });
    }
  }
  return ranges;
}

function constructStart(doc: Text, bracePos: number): number {
  const look = Math.max(0, bracePos - 200);
  const s = doc.sliceString(look, Math.min(doc.length, bracePos + 2));
  const i = bracePos - look;
  if (s[i] === "{" && s[i + 1] === "?") return bracePos;
  let p = i;
  while (p > 0 && (s[p - 1] === " " || s[p - 1] === "\t" || s[p - 1] === "\n")) p--;
  if (p > 0 && s[p - 1] === "]") {
    let depth = 1;
    p--;
    while (p > 0 && depth > 0) {
      p--;
      if (isEscaped(s, p)) continue;
      if (s[p] === "]") depth++;
      else if (s[p] === "[") depth--;
    }
    while (p > 0 && (s[p - 1] === " " || s[p - 1] === "\t" || s[p - 1] === "\n")) p--;
  }
  while (p > 0 && /[A-Za-z0-9@*]/.test(s[p - 1]!)) p--;
  if (p > 0 && s[p - 1] === "\\") p--;
  return look + p;
}

function expandLeft(doc: Text, from: number): number {
  let depth = 0;
  let pos = from;
  while (pos > 0) {
    const line = doc.lineAt(pos - 1);
    const cmt = commentIndex(line.text);
    const codeEnd = cmt === -1 ? line.text.length : cmt;
    const localEnd = Math.min(codeEnd, pos - line.from);
    for (let i = localEnd - 1; i >= 0; i--) {
      if (isEscaped(line.text, i)) continue;
      const ch = line.text[i];
      if (ch === "}") depth++;
      else if (ch === "{") {
        if (depth === 0) return constructStart(doc, line.from + i);
        depth--;
      }
    }
    pos = line.from;
    if (depth === 0) break;
  }
  return pos;
}

function balanceRight(doc: Text, from: number, to: number): number {
  let depth = 0;
  let pos = from;
  while (pos <= doc.length) {
    const line = doc.lineAt(Math.min(pos, doc.length));
    const cmt = commentIndex(line.text);
    const codeEnd = cmt === -1 ? line.text.length : cmt;
    let i = pos <= line.from ? 0 : pos - line.from;
    for (; i < codeEnd; i++) {
      if (isEscaped(line.text, i)) continue;
      const ch = line.text[i];
      if (ch === "{") depth++;
      else if (ch === "}" && depth > 0) depth--;
    }
    if (line.to >= to && depth === 0) return line.to;
    if (line.number === doc.lines) return line.to;
    pos = line.to + 1;
  }
  return doc.length;
}

function expandConstructRange(doc: Text, from: number, to: number): { from: number; to: number } {
  from = doc.lineAt(from).from;
  to = doc.lineAt(Math.min(to, doc.length)).to;
  from = expandLeft(doc, from);
  to = Math.max(to, balanceRight(doc, from, to));
  return { from, to };
}

function expandRescan(
  doc: Text,
  deco: DecorationSet,
  from: number,
  to: number,
): { from: number; to: number } {
  let range = expandConstructRange(doc, from, to);
  let grown = false;
  deco.between(range.from, range.to, (a, b) => {
    if (a < range.from) {
      range.from = a;
      grown = true;
    }
    if (b > range.to) {
      range.to = b;
      grown = true;
    }
  });
  if (grown) range = expandConstructRange(doc, range.from, range.to);
  return range;
}

function mergeRanges(ranges: { from: number; to: number }[]): { from: number; to: number }[] {
  if (ranges.length < 2) return ranges;
  ranges.sort((a, b) => a.from - b.from);
  const out = [{ ...ranges[0]! }];
  for (let i = 1; i < ranges.length; i++) {
    const cur = ranges[i]!;
    const last = out[out.length - 1]!;
    if (cur.from <= last.to) last.to = Math.max(last.to, cur.to);
    else out.push({ ...cur });
  }
  return out;
}

function decorationRangesFromMarks(ranges: MarkRange[]) {
  const sorted = ranges.slice().sort((a, b) => a.from - b.from || b.rank - a.rank || a.to - b.to);
  const out = [];
  let lastTo = 0;
  for (const range of sorted) {
    if (range.from < lastTo || range.from >= range.to) continue;
    out.push(range.decoration.range(range.from, range.to));
    lastTo = range.to;
  }
  return out;
}

function rescanRange(
  deco: DecorationSet,
  doc: Text,
  from: number,
  to: number,
  seed?: Map<string, number>,
): DecorationSet {
  const slice = doc.sliceString(from, to);
  const counts = new Map(seed);
  const touchedHeading = sliceHasHeading(slice);
  if (touchedHeading) seedHeadingCounts(doc, from, counts);
  const marks = collectMarkRanges(slice, counts).map((range) => ({
    ...range,
    from: range.from + from,
    to: range.to + from,
  }));
  deco = deco.update({
    filterFrom: from,
    filterTo: to,
    filter: (a, b) => b <= from || a >= to,
    add: decorationRangesFromMarks(marks),
    sort: true,
  });
  // ponytail: later heading occurrence keys are rewritten only when this window has a heading
  if (touchedHeading && to < doc.length) {
    deco = deco.update({
      filterFrom: to + 1,
      filterTo: doc.length,
      filter: (a, _b, value) => a <= to || value.spec.class !== HEADING_CLASS,
      add: decorationRangesFromMarks(laterHeadings(doc, to, counts)),
      sort: true,
    });
  }
  return deco;
}

export function updateObDecorations(
  deco: DecorationSet,
  changes: ChangeDesc,
  doc: Text,
  seed?: Map<string, number>,
): DecorationSet {
  deco = deco.map(changes);
  const raw: { from: number; to: number }[] = [];
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    raw.push({
      from: doc.lineAt(fromB).from,
      to: doc.lineAt(Math.min(toB, doc.length)).to,
    });
  });
  const expanded = mergeRanges(raw.map((range) => expandRescan(doc, deco, range.from, range.to)));
  for (const range of expanded) deco = rescanRange(deco, doc, range.from, range.to, seed);
  return deco;
}

export const obMarkerDecorations = ViewPlugin.fromClass(
  class ObMarkerPlugin {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = decorationsForDoc(view.state.doc, view.state.facet(headingCountSeed));
    }

    update(update: ViewUpdate) {
      const seed = update.state.facet(headingCountSeed);
      if (update.docChanged) {
        this.decorations = updateObDecorations(this.decorations, update.changes, update.state.doc, seed);
        return;
      }
      if (update.startState.facet(headingCountSeed) !== seed) {
        this.decorations = decorationsForDoc(update.state.doc, seed);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
