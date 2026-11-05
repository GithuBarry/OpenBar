import { Facet, RangeSetBuilder, type Text } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, type DecorationSet, ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import { parser } from "codemirror-lang-latex";

import { commentKindAppearance } from "@/lib/comment-kinds";
import { findMacroMatches, parseAnchorAttrs } from "@/lib/marker-codec";
import { splitBundleSource } from "@/lib/tex-project/source-bundle-format";
import { headingOccurrenceKey, texHeadingLevel } from "./heading-keys";

const MACRO_CLASSES: Record<string, string> = {
  obtodo: "ob-cm-todo", obcomment: "ob-cm-comment", obmarker: "ob-cm-marker",
  obcite: "ob-cm-cite", cite: "ob-cm-cite", citep: "ob-cm-cite", citet: "ob-cm-cite",
  ref: "ob-cm-ref", label: "ob-cm-ref",
};
const ANNOTATION_BRACE = Decoration.mark({ class: "ob-cm-annotation-brace" });
const TODO_BODY = Decoration.mark({ class: "ob-cm-todo-body" });
const BRACE_MARK = Decoration.mark({ class: "ob-cm-brace-marker" });
const EMPTY_HEADING_COUNTS = new Map<string, number>();

/** Included editors inherit heading occurrence counts from their predecessors. */
export const headingCountSeed = Facet.define<Map<string, number>, Map<string, number>>({
  combine: (maps) => maps.at(-1) ?? EMPTY_HEADING_COUNTS,
});

type MarkRange = { from: number; to: number; decoration: Decoration; rank: number; kind: string };
type LatexTree = ReturnType<typeof parser.parse>;

function collectMarkRanges(text: string, tree: LatexTree, seed?: Map<string, number>): MarkRange[] {
  const ranges: MarkRange[] = [];
  const counts = new Map(seed);
  const commandEnds = new Map<number, number>();
  tree.iterate({ enter: (node) => {
    if (node.name === "Comment" || node.name === "VerbatimEnvironment") return false;
    if (node.name === "Command") commandEnds.set(node.from, node.node.firstChild?.getChildren("TextArgument")[1]?.to ?? node.to);
    if (node.name === "Group" && /^\{\?\s*(notfinal|placeholder|verify|cite|citation-needed|todo)\b/i.test(text.slice(node.from, node.to))) {
      ranges.push({ from: node.from, to: node.to, decoration: BRACE_MARK, rank: 1, kind: "brace" });
    }
    if (node.name !== "SectioningCommand") return;
    const command = /^\\(section|subsection|subsubsection|paragraph|subparagraph)\*?/.exec(text.slice(node.from, node.to));
    const title = node.node.getChild("SectioningArgument");
    if (!command || !title || text[title.to - 1] !== "}") return;
    const key = headingOccurrenceKey(texHeadingLevel(command[1]!), text.slice(title.from + 1, title.to - 1), counts);
    ranges.push({ from: node.from, to: node.to, rank: 2, kind: "heading", decoration: Decoration.mark({
      class: "ob-ed-heading", attributes: { id: "ob-ed-h-" + key, "data-ob-heading-key": key },
    }) });
  } });

  // The shared annotation codec preserves quoted attributes and project macros.
  // CodeMirror's incremental grammar owns headings and construct bounds.
  for (const macro of findMacroMatches(text, Object.keys(MACRO_CLASSES))) {
    const appearance = macro.name === "obcomment" ? commentKindAppearance(parseAnchorAttrs(macro.attrs).kind) : undefined;
    const decoration = Decoration.mark({
      class: MACRO_CLASSES[macro.name] + (appearance ? " ob-comment-tone-" + appearance.tone : ""),
      ...(appearance ? { attributes: { title: appearance.label } } : {}),
    });
    const end = macro.index + macro.length;
    if (macro.name === "obtodo" || macro.name === "obcomment") {
      const close = end - 1;
      const open = close - macro.body.length - 1;
      if (text[open] === "{" && text[close] === "}") {
        ranges.push({ from: macro.index, to: open, decoration, rank: 0, kind: macro.name });
        ranges.push({ from: open, to: open + 1, decoration: ANNOTATION_BRACE, rank: 1, kind: macro.name + "-brace" });
        if (open + 1 < close) ranges.push({ from: open + 1, to: close, decoration: macro.name === "obtodo" ? TODO_BODY : decoration, rank: 0, kind: macro.name + "-body" });
        ranges.push({ from: close, to: end, decoration: ANNOTATION_BRACE, rank: 1, kind: macro.name + "-brace" });
        continue;
      }
    }
    ranges.push({ from: macro.index, to: macro.name === "obmarker" ? commandEnds.get(macro.index) ?? end : end, decoration, rank: 0, kind: macro.name });
  }
  for (const part of splitBundleSource(text)) {
    ranges.push({ from: part.bannerFrom, to: part.bodyFrom, decoration: Decoration.mark({ class: "ob-cm-file-banner" }), rank: 2, kind: "file-banner" });
  }
  ranges.sort((a, b) => a.from - b.from || b.rank - a.rank || a.to - b.to);
  let end = 0;
  return ranges.filter((range) => {
    if (range.from < end || range.from >= range.to) return false;
    end = range.to;
    return true;
  });
}

export function collectObDecorationRanges(text: string): { from: number; to: number; kind: string }[] {
  return collectMarkRanges(text, parser.parse(text)).map(({ from, to, kind }) => ({ from, to, kind }));
}

function decorations(text: string, tree: LatexTree, seed?: Map<string, number>): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of collectMarkRanges(text, tree, seed)) builder.add(range.from, range.to, range.decoration);
  return builder.finish();
}

export function decorationsForDoc(doc: Text | string, seed?: Map<string, number>): DecorationSet {
  const text = typeof doc === "string" ? doc : doc.toString();
  return decorations(text, parser.parse(text), seed);
}

export const obMarkerDecorations = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = decorations(view.state.doc.toString(), syntaxTree(view.state), view.state.facet(headingCountSeed));
  }
  update(update: ViewUpdate) {
    const tree = syntaxTree(update.state);
    const seed = update.state.facet(headingCountSeed);
    if (update.docChanged || tree !== syntaxTree(update.startState) || seed !== update.startState.facet(headingCountSeed)) {
      this.decorations = decorations(update.state.doc.toString(), tree, seed);
    }
  }
}, { decorations: (plugin) => plugin.decorations });
