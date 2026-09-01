"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { codeFolding, foldEffect, foldGutter, foldKeymap, foldService, HighlightStyle, indentUnit, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags } from "@lezer/highlight";

import { obMarkerDecorations, headingCountSeed } from "./ob-cm-decorations";
import { splitBundleSource } from "@/lib/tex-project/source-bundle-format";
import { cn } from "@/lib/utils";

export type { EditorView } from "@codemirror/view";

function headingFoldService(state: EditorState, lineStart: number, _lineEnd: number) {
  const line = state.doc.lineAt(lineStart);
  if (/^% === openbarry:file /.test(line.text)) {
    let to = state.doc.length;
    for (let num = line.number + 1; num <= state.doc.lines; num++) {
      const next = state.doc.line(num);
      if (/^% === openbarry:file /.test(next.text)) {
        to = next.from;
        break;
      }
    }
    if (to <= line.to) return null;
    return { from: line.to, to };
  }
  const match = /^\s*\\(title|section|subsection|subsubsection|paragraph|subparagraph)\*?/.exec(line.text);
  if (!match) return null;
  const rank: Record<string, number> = {
    title: 1,
    section: 2,
    subsection: 3,
    subsubsection: 4,
    paragraph: 5,
    subparagraph: 6,
  };
  const level = rank[match[1]!] || 2;
  let to = state.doc.length;
  for (let num = line.number + 1; num <= state.doc.lines; num++) {
    const next = state.doc.line(num);
    const found = /^\s*\\(title|section|subsection|subsubsection|paragraph|subparagraph)\*?/.exec(next.text);
    if (found && (rank[found[1]!] || 2) <= level) {
      to = next.from;
      break;
    }
  }
  if (to <= line.to) return null;
  return { from: line.to, to };
}

const PACKAGE_LINE = /^\s*\\(?:usepackage|RequirePackage)\b/;
const PACKAGE_SPACER = /^\s*(?:%.*)?$/;

/** Fold consecutive package declarations while leaving the first one visible. */
function packageFoldService(state: EditorState, lineStart: number, _lineEnd: number) {
  const line = state.doc.lineAt(lineStart);
  if (!PACKAGE_LINE.test(line.text)) return null;
  if (/\\begin\s*\{document\}/.test(state.sliceDoc(0, lineStart))) return null;

  let previous = line.number - 1;
  while (previous >= 1 && PACKAGE_SPACER.test(state.doc.line(previous).text)) previous -= 1;
  if (previous >= 1 && PACKAGE_LINE.test(state.doc.line(previous).text)) return null;

  let last = line.number;
  let packageCount = 1;
  while (last < state.doc.lines) {
    let next = last + 1;
    while (next <= state.doc.lines && PACKAGE_SPACER.test(state.doc.line(next).text)) next += 1;
    if (next > state.doc.lines || !PACKAGE_LINE.test(state.doc.line(next).text)) break;
    last = next;
    packageCount += 1;
  }
  if (packageCount < 2) return null;
  return { from: line.to, to: state.doc.line(last).to };
}

function initialPackageFolds(state: EditorState): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const range = packageFoldService(state, line.from, line.to);
    if (!range) continue;
    ranges.push(range);
    number = state.doc.lineAt(range.to).number;
  }
  return ranges;
}

function collapseInitialPackageGroups(view: EditorView): void {
  const packageFolds = initialPackageFolds(view.state);
  if (packageFolds.length) view.dispatch({ effects: packageFolds.map((range) => foldEffect.of(range)) });
}

const fromPropSync = Annotation.define<boolean>();

const obHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "rgb(var(--faint))", fontStyle: "italic" },
  { tag: tags.keyword, color: "rgb(var(--accent) / 0.9)" },
  { tag: tags.atom, color: "rgb(var(--accent) / 0.9)" },
  { tag: tags.tagName, color: "rgb(var(--accent) / 0.9)" },
  { tag: tags.meta, color: "rgb(var(--muted))" },
  { tag: tags.bracket, color: "rgb(var(--muted))" },
  { tag: tags.string, color: "rgb(var(--ink))" },
  { tag: tags.processingInstruction, color: "rgb(var(--muted))" },
]);

const obEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "rgb(var(--ink))",
    fontSize: "0.875rem",
    border: "none",
    outline: "none",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.875rem",
    lineHeight: "1.625rem",
    overflow: "auto",
    height: "100%",
    padding: "2rem",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.875rem",
    lineHeight: "1.625rem",
    padding: 0,
    caretColor: "rgb(var(--ink))",
    color: "rgb(var(--ink))",
  },
  ".cm-line": {
    padding: 0,
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "rgb(var(--ink))",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgb(var(--accent) / 0.25) !important",
  },
  ".cm-placeholder": {
    color: "rgb(var(--faint))",
  },
  ".cm-panel": {
    backgroundColor: "rgb(var(--canvas))",
    color: "rgb(var(--ink))",
    borderTop: "1px solid rgb(var(--faint) / 0.4)",
  },
  ".cm-panel input": {
    backgroundColor: "rgb(var(--canvas))",
    color: "rgb(var(--ink))",
    border: "1px solid rgb(var(--faint) / 0.4)",
  },
  ".ob-cm-claim, .ob-cm-claim *": { color: "rgb(var(--accent))" },
  ".cm-line .ob-cm-claim-body, .cm-line .ob-cm-claim-body *": { color: "rgb(var(--ink))" },
  ".ob-cm-todo, .ob-cm-todo *": { color: "rgb(var(--m-draft))" },
  ".cm-line .ob-cm-todo-body, .cm-line .ob-cm-todo-body *": { color: "rgb(var(--ink))" },
  ".ob-cm-comment, .ob-cm-comment *": { color: "rgb(var(--muted))" },
  ".ob-cm-marker, .ob-cm-marker *": { color: "rgb(var(--m-hypo))" },
  ".ob-cm-cite, .ob-cm-cite *, .ob-cm-ref, .ob-cm-ref *": { color: "rgb(var(--accent) / 0.9)" },
  ".ob-cm-brace-marker": {
    color: "rgb(var(--m-hypo))",
    backgroundColor: "rgb(var(--m-hypo) / 0.2)",
  },
  ".ob-ed-heading, .ob-ed-heading *": {
    fontWeight: "700",
    color: "rgb(var(--accent))",
  },
  ".ob-cm-file-banner": {
    color: "rgb(var(--faint))",
    backgroundColor: "rgb(var(--accent) / 0.08)",
    fontStyle: "italic",
  },
});

const obNestedTheme = EditorView.theme({
  "&": {
    height: "auto",
    backgroundColor: "transparent",
    color: "rgb(var(--ink))",
    fontSize: "0.875rem",
    border: "none",
    outline: "none",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.875rem",
    lineHeight: "1.625rem",
    overflow: "visible",
    height: "auto",
    padding: "0.7rem 0.9rem",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.875rem",
    lineHeight: "1.625rem",
    padding: 0,
    caretColor: "rgb(var(--ink))",
    color: "rgb(var(--ink))",
  },
  ".cm-line": {
    padding: 0,
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "rgb(var(--ink))",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "rgb(var(--accent) / 0.25) !important",
  },
  ".ob-cm-claim, .ob-cm-claim *": { color: "rgb(var(--accent))" },
  ".cm-line .ob-cm-claim-body, .cm-line .ob-cm-claim-body *": { color: "rgb(var(--ink))" },
  ".ob-cm-todo, .ob-cm-todo *": { color: "rgb(var(--m-draft))" },
  ".cm-line .ob-cm-todo-body, .cm-line .ob-cm-todo-body *": { color: "rgb(var(--ink))" },
  ".ob-cm-comment, .ob-cm-comment *": { color: "rgb(var(--muted))" },
  ".ob-cm-marker, .ob-cm-marker *": { color: "rgb(var(--m-hypo))" },
  ".ob-cm-cite, .ob-cm-cite *, .ob-cm-ref, .ob-cm-ref *": { color: "rgb(var(--accent) / 0.9)" },
  ".ob-cm-brace-marker": {
    color: "rgb(var(--m-hypo))",
    backgroundColor: "rgb(var(--m-hypo) / 0.2)",
  },
  ".ob-ed-heading, .ob-ed-heading *": {
    fontWeight: "700",
    color: "rgb(var(--accent))",
  },
});

export function toggleSurround(
  doc: string,
  from: number,
  to: number,
  open: string,
  close: string,
  placeholder = "",
): { from: number; to: number; insert: string; selFrom: number; selTo: number } {
  const picked = doc.slice(from, to);
  if (picked.startsWith(open) && picked.endsWith(close) && picked.length >= open.length + close.length) {
    const inner = picked.slice(open.length, picked.length - close.length);
    return { from, to, insert: inner, selFrom: from, selTo: from + inner.length };
  }
  if (
    from >= open.length
    && doc.slice(from - open.length, from) === open
    && doc.slice(to, to + close.length) === close
  ) {
    return {
      from: from - open.length,
      to: to + close.length,
      insert: picked,
      selFrom: from - open.length,
      selTo: from - open.length + picked.length,
    };
  }
  const inner = picked.length > 0 ? picked : placeholder;
  const insert = `${open}${inner}${close}`;
  return { from, to, insert, selFrom: from + open.length, selTo: from + open.length + inner.length };
}

function surroundSelection(view: EditorView, open: string, close: string, placeholder = ""): void {
  const sel = view.state.selection.main;
  const next = toggleSurround(view.state.doc.toString(), sel.from, sel.to, open, close, placeholder);
  view.dispatch({
    changes: { from: next.from, to: next.to, insert: next.insert },
    selection: { anchor: next.selFrom, head: next.selTo },
    scrollIntoView: true,
  });
  view.focus();
}

function insertAtCursor(view: EditorView, text: string, asBlock: boolean): void {
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const from = sel.from;
  const to = sel.to;
  let insert = text;
  let cursor = from + text.length;
  if (asBlock) {
    const before = from > 0 ? doc.sliceString(from - 1, from) : "\n";
    const after = to < doc.length ? doc.sliceString(to, to + 1) : "\n";
    const prefix = before !== "\n" ? "\n\n" : "";
    const suffix = after !== "\n" ? "\n\n" : "\n";
    insert = `${prefix}${text}${suffix}`;
    cursor = from + prefix.length + text.length;
  }
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: cursor, head: cursor },
    scrollIntoView: true,
  });
  view.focus();
}

function clampPos(pos: number, length: number): number {
  return Math.max(0, Math.min(pos, length));
}

export type TexCodeMirrorHandle = {
  focus: () => void;
  getScroller: () => HTMLElement | null;
  getView: () => EditorView | null;
  getSelection: () => { from: number; to: number } | null;
  setSelection: (from: number, to: number) => void;
  surround: (open: string, close: string, placeholder?: string) => void;
  insertAtCursor: (text: string, asBlock?: boolean) => void;
  getLiveSource: () => string;
  getVirtualSelection: () => { from: number; to: number } | null;
  applyVirtualChange: (from: number, to: number, insert: string) => boolean;
};

export type TexCodeMirrorProps = {
  value: string;
  onChange: (value: string) => void;
  onScroll?: () => void;
  onFocus?: () => void;
  placeholder?: string;
  className?: string;
  variant?: "pane" | "nested";
  headingCounts?: Map<string, number>;
};

function seedKeyOf(counts?: Map<string, number>): string {
  if (!counts?.size) return "";
  return [...counts.entries()].map(([key, value]) => `${key}:${value}`).join("|");
}

export const TexCodeMirror = forwardRef<TexCodeMirrorHandle, TexCodeMirrorProps>(
  function TexCodeMirror({
    value,
    onChange,
    onScroll,
    onFocus,
    placeholder,
    className,
    variant = "pane",
    headingCounts,
  }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const placeholderCompRef = useRef(new Compartment());
    const seedCompRef = useRef(new Compartment());
    const onChangeRef = useRef(onChange);
    const onScrollRef = useRef(onScroll);
    const onFocusRef = useRef(onFocus);
    const valueRef = useRef(value);
    const placeholderRef = useRef(placeholder);
    const headingCountsRef = useRef(headingCounts);
    const variantRef = useRef(variant);
    onChangeRef.current = onChange;
    onScrollRef.current = onScroll;
    onFocusRef.current = onFocus;
    valueRef.current = value;
    placeholderRef.current = placeholder;
    headingCountsRef.current = headingCounts;
    variantRef.current = variant;

    const applyLocal = (from: number, to: number, insert: string): boolean => {
      const view = viewRef.current;
      if (!view) return false;
      const len = view.state.doc.length;
      const start = clampPos(from, len);
      const end = clampPos(to, len);
      view.dispatch({
        changes: { from: start, to: end, insert },
        selection: { anchor: start + insert.length },
        scrollIntoView: true,
      });
      view.focus();
      return true;
    };

    useImperativeHandle(ref, () => ({
      focus: () => {
        viewRef.current?.focus();
      },
      getScroller: () => viewRef.current?.scrollDOM ?? null,
      getView: () => viewRef.current,
      getSelection: () => {
        const view = viewRef.current;
        if (!view) return null;
        const sel = view.state.selection.main;
        return { from: sel.from, to: sel.to };
      },
      setSelection: (from, to) => {
        const view = viewRef.current;
        if (!view) return;
        const len = view.state.doc.length;
        view.dispatch({
          selection: { anchor: clampPos(from, len), head: clampPos(to, len) },
          scrollIntoView: true,
        });
        view.focus();
      },
      surround: (open, close, ph) => {
        const view = viewRef.current;
        if (!view) return;
        surroundSelection(view, open, close, ph);
      },
      insertAtCursor: (text, asBlock = false) => {
        const view = viewRef.current;
        if (!view) return;
        insertAtCursor(view, text, asBlock);
      },
      getLiveSource: () => viewRef.current?.state.doc.toString() ?? valueRef.current,
      getVirtualSelection: () => {
        const view = viewRef.current;
        if (!view) return null;
        const sel = view.state.selection.main;
        return { from: sel.from, to: sel.to };
      },
      applyVirtualChange: (from, to, insert) => {
        return applyLocal(from, to, insert);
      },
    }), []);

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      const placeholderComp = placeholderCompRef.current;
      const seedComp = seedCompRef.current;
      const nested = variantRef.current === "nested";
      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: valueRef.current,
          extensions: [
            StreamLanguage.define(stex),
            syntaxHighlighting(obHighlightStyle),
            history(),
            drawSelection(),
            codeFolding(),
            foldGutter(),
            foldService.of(packageFoldService),
            foldService.of(headingFoldService),
            EditorView.lineWrapping,
            EditorState.tabSize.of(2),
            indentUnit.of("  "),
            keymap.of([
              {
                key: "Mod-b",
                run: (ed) => {
                  surroundSelection(ed, "\\textbf{", "}", "bold");
                  return true;
                },
              },
              {
                key: "Mod-i",
                run: (ed) => {
                  surroundSelection(ed, "\\emph{", "}", "italic");
                  return true;
                },
              },
              indentWithTab,
              ...foldKeymap,
              ...searchKeymap,
              ...historyKeymap,
              ...defaultKeymap,
            ]),
            search(),
            seedComp.of(headingCountSeed.of(new Map(headingCountsRef.current))),
            obMarkerDecorations,
            EditorState.transactionFilter.of((tr) => {
              if (nested || !tr.docChanged) return tr;
              const text = tr.startState.doc.toString();
              const blocked = { hit: false };
              tr.changes.iterChanges((fromA, toA) => {
                for (const part of splitBundleSource(text)) {
                  if (fromA < part.bodyFrom && toA > part.bannerFrom) blocked.hit = true;
                }
              });
              return blocked.hit ? [] : tr;
            }),
            nested ? obNestedTheme : obEditorTheme,
            EditorView.editorAttributes.of({ class: nested ? "ob-cm-editor ob-cm-nested" : "ob-cm-editor" }),
            EditorView.contentAttributes.of({ spellcheck: "true" }),
            placeholderComp.of(placeholderRef.current ? cmPlaceholder(placeholderRef.current) : []),
            EditorView.updateListener.of((update) => {
              if (update.focusChanged && update.view.hasFocus) onFocusRef.current?.();
              if (!update.docChanged) return;
              if (update.transactions.some((tr) => tr.annotation(fromPropSync))) return;
              onChangeRef.current(update.state.doc.toString());
            }),
          ],
        }),
      });
      viewRef.current = view;
      const initialFoldFrame = requestAnimationFrame(() => {
        if (viewRef.current === view) collapseInitialPackageGroups(view);
      });

      const onScrollDom = () => {
        onScrollRef.current?.();
      };
      view.scrollDOM.addEventListener("scroll", onScrollDom, { passive: true });

      return () => {
        cancelAnimationFrame(initialFoldFrame);
        view.scrollDOM.removeEventListener("scroll", onScrollDom);
        view.destroy();
        viewRef.current = null;
      };
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current === value) return;
      const sel = view.state.selection.main;
      const length = value.length;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        selection: { anchor: clampPos(sel.anchor, length), head: clampPos(sel.head, length) },
        annotations: [fromPropSync.of(true), Transaction.addToHistory.of(false)],
      });
      requestAnimationFrame(() => {
        if (viewRef.current === view && view.state.doc.toString() === value) collapseInitialPackageGroups(view);
      });
    }, [value]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: placeholderCompRef.current.reconfigure(placeholder ? cmPlaceholder(placeholder) : []),
      });
    }, [placeholder]);

    const seedKey = seedKeyOf(headingCounts);
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: seedCompRef.current.reconfigure(headingCountSeed.of(new Map(headingCountsRef.current))),
      });
    }, [seedKey]);

    return <div ref={hostRef} className={cn("ob-cm-root", variant === "nested" && "ob-cm-root-nested", className)} />;
  },
);

TexCodeMirror.displayName = "TexCodeMirror";
