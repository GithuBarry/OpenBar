"use client";

import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  isolateHistory,
  indentWithTab,
} from "@codemirror/commands";
import { codeFolding, foldEffect, foldedRanges, foldGutter, foldKeymap, foldService, HighlightStyle, indentUnit, LanguageSupport, syntaxHighlighting, unfoldEffect } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import {
  Annotation,
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
  MatchDecorator,
  placeholder as cmPlaceholder,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { styleTags, tags } from "@lezer/highlight";

import { boundaryLineNumbers } from "./boundary-line-numbers";
import { autocompletion, completionKeymap, acceptCompletion } from "@codemirror/autocomplete";
import { latex, latexCompletionSource, latexLanguage } from "codemirror-lang-latex";
import { projectCompletions, type PaperCompletionContext } from "./latex-completion";
import { latexLspCompletions, type LatexLspContext } from "./latex-lsp-completion";
import { commentKindsSource, metadataMarkers } from "./metadata-markers";
import { obMarkerDecorations, headingCountSeed } from "./ob-cm-decorations";
import { bannerRanges } from "@/lib/tex-project/source-bundle-format";
import { cn } from "@/lib/utils";
import { formatInlineSelection, type InlineFormat, type InlineSyntax } from "@/lib/mindmap/text-formatting";
import { AGENT_MENTION_PATTERN } from "@/lib/research/agent-mentions";

export type { EditorView } from "@codemirror/view";

// The LaTeX grammar assigns separate node types to known commands, and some
// of those nodes have no color tag. Give each control sequence the same tag
// while letting the parser keep comments and literal text distinct.
const commandTags = Object.fromEntries(latexLanguage.parser.nodeSet.types
  .filter((type) => type.name.endsWith("CtrlSeq"))
  .map((type) => [type.name, tags.keyword]));
const paperLatexLanguage = latexLanguage.configure({ props: [styleTags(commandTags)] });
const latexSyntax = () => new LanguageSupport(paperLatexLanguage,
  latex({ enableLinting: false, enableTooltips: false, enableAutocomplete: false, autoCloseTags: false, autoCloseBrackets: false }).support);

const mentionMatcher = new MatchDecorator({
  regexp: new RegExp(AGENT_MENTION_PATTERN.source, "gi"),
  decoration: Decoration.mark({ class: "ob-cm-agent-mention" }),
});
const agentMentionDecorations = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = mentionMatcher.createDeco(view); }
  update(update: ViewUpdate) { this.decorations = mentionMatcher.updateDeco(update, this.decorations); }
}, { decorations: plugin => plugin.decorations });

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

export type TexFocusContext = {
  from: number;
  to: number;
  beforeLines: number;
  afterLines: number;
};

const focusContextEffect = StateEffect.define<TexFocusContext | null>();
const sourceHighlightEffect = StateEffect.define<{ from: number; to: number } | null>();
const sourceHighlight = Decoration.mark({ class: "ob-cm-source-highlight" });
const sourceHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    if (transaction.docChanged) decorations = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(sourceHighlightEffect)) continue;
      const range = effect.value;
      decorations = range && range.to > range.from
        ? Decoration.set([sourceHighlight.range(range.from, range.to)])
        : Decoration.none;
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const FOCUS_LINE = Decoration.line({ class: "ob-cm-context-focus" });
const CONTEXT_LINE = Decoration.line({ class: "ob-cm-context-faded" });

function focusContextDecorations(state: EditorState, context: TexFocusContext | null): DecorationSet {
  if (!context || state.doc.lines === 0) return Decoration.none;

  const from = Math.max(0, Math.min(context.from, state.doc.length));
  const to = Math.max(from, Math.min(context.to, state.doc.length));
  const firstTargetLine = state.doc.lineAt(from).number;
  const lastTargetLine = state.doc.lineAt(Math.max(from, to - 1)).number;
  const firstContextLine = Math.max(1, firstTargetLine - Math.max(0, context.beforeLines));
  const lastContextLine = Math.min(state.doc.lines, lastTargetLine + Math.max(0, context.afterLines));
  const builder = new RangeSetBuilder<Decoration>();

  for (let lineNumber = firstContextLine; lineNumber <= lastContextLine; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const decoration = lineNumber >= firstTargetLine && lineNumber <= lastTargetLine ? FOCUS_LINE : CONTEXT_LINE;
    builder.add(line.from, line.from, decoration);
  }
  return builder.finish();
}

function focusContextField(initialContext: TexFocusContext | null) {
  let context = initialContext;
  return StateField.define<DecorationSet>({
    create: (state) => focusContextDecorations(state, context),
    update: (decorations, transaction) => {
      const effect = transaction.effects.find((item) => item.is(focusContextEffect));
      if (effect) {
        context = effect.value;
        return focusContextDecorations(transaction.state, context);
      }
      if (transaction.docChanged) return focusContextDecorations(transaction.state, context);
      return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

const obHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "rgb(var(--faint))", fontStyle: "italic" },
  { tag: [tags.keyword, tags.heading], color: "rgb(var(--accent-text))" },
  { tag: tags.atom, color: "rgb(var(--accent-text))" },
  { tag: tags.tagName, color: "rgb(var(--accent-text))" },
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
    fontSize: "calc(0.875rem * var(--paper-editor-font-scale, 1))",
    border: "none",
    outline: "none",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    fontSize: "calc(0.875rem * var(--paper-editor-font-scale, 1))",
    lineHeight: "calc(1.5rem * var(--paper-editor-font-scale, 1))",
    overflow: "auto",
    height: "100%",
    minWidth: 0,
    padding: "2rem",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    fontSize: "calc(0.875rem * var(--paper-editor-font-scale, 1))",
    lineHeight: "calc(1.5rem * var(--paper-editor-font-scale, 1))",
    flexShrink: 1,
    minWidth: 0,
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
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgb(var(--accent) / 0.25) !important",
  },
  ".ob-cm-source-highlight": {
    backgroundColor: "rgb(var(--accent) / 0.22)",
    borderRadius: "2px",
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
  ".ob-cm-claim, .ob-cm-claim *": { color: "rgb(var(--accent-text))" },
  ".cm-line .ob-cm-claim-body, .cm-line .ob-cm-claim-body *": { color: "rgb(var(--ink))" },
  ".ob-cm-todo, .ob-cm-todo *": { color: "rgb(var(--warn-text))" },
  ".cm-line .ob-cm-todo-body, .cm-line .ob-cm-todo-body *": { color: "rgb(var(--ink))" },
  ".ob-cm-comment, .ob-cm-comment *": { color: "rgb(var(--comment-color, var(--muted)))" },
  ".ob-cm-annotation-brace": {
    color: "rgb(var(--warn-text)) !important",
  },
  ".ob-cm-marker, .ob-cm-marker *": { color: "rgb(var(--accent-text))" },
  ".ob-cm-cite, .ob-cm-cite *, .ob-cm-ref, .ob-cm-ref *": { color: "rgb(var(--accent-text))" },
  ".ob-cm-brace-marker": {
    color: "rgb(var(--ink))",
    backgroundColor: "rgb(var(--accent) / 0.2)",
  },
  ".ob-ed-heading, .ob-ed-heading *": {
    fontWeight: "700",
    color: "rgb(var(--accent-text))",
  },
  ".ob-cm-file-banner": {
    color: "rgb(var(--faint))",
    backgroundColor: "rgb(var(--accent) / 0.08)",
    fontStyle: "italic",
  },
  ".ob-cm-context-faded": {
    opacity: "0.42",
    transition: "opacity 140ms ease",
  },
  ".ob-cm-context-focus": {
    opacity: "1",
    backgroundColor: "rgb(var(--accent) / 0.045)",
  },
});

const obCompactTheme = EditorView.theme({
  ".ob-cm-agent-mention": {
    color: "rgb(var(--ink))",
    backgroundColor: "rgb(var(--accent) / .12)",
    borderRadius: "3px",
    boxShadow: "0 0 0 1px rgb(var(--accent) / .2)",
  },
  "&": {
    height: "auto !important",
    backgroundColor: "transparent",
    color: "rgb(var(--ink))",
    fontSize: "calc(0.8125rem * var(--paper-editor-font-scale, 1))",
    border: "none",
    outline: "none",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    fontSize: "calc(0.78rem * var(--paper-editor-font-scale, 1))",
    lineHeight: "calc(1.3rem * var(--paper-editor-font-scale, 1))",
    overflowX: "clip",
    overflowY: "visible",
    height: "auto !important",
    minWidth: 0,
    maxWidth: "100%",
    width: "100%",
    padding: "0.25rem 0.4rem",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    fontSize: "calc(0.78rem * var(--paper-editor-font-scale, 1))",
    lineHeight: "calc(1.3rem * var(--paper-editor-font-scale, 1))",
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
    width: "100%",
    whiteSpace: "break-spaces",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
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
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgb(var(--accent) / 0.25) !important",
  },
  ".ob-cm-claim, .ob-cm-claim *": { color: "rgb(var(--accent-text))" },
  ".cm-line .ob-cm-claim-body, .cm-line .ob-cm-claim-body *": { color: "rgb(var(--ink))" },
  ".ob-cm-todo, .ob-cm-todo *": { color: "rgb(var(--warn-text))" },
  ".cm-line .ob-cm-todo-body, .cm-line .ob-cm-todo-body *": { color: "rgb(var(--ink))" },
  ".ob-cm-comment, .ob-cm-comment *": { color: "rgb(var(--comment-color, var(--muted)))" },
  ".ob-cm-annotation-brace": {
    color: "rgb(var(--warn-text)) !important",
  },
  ".ob-cm-marker, .ob-cm-marker *": { color: "rgb(var(--accent-text))" },
  ".ob-cm-cite, .ob-cm-cite *, .ob-cm-ref, .ob-cm-ref *": { color: "rgb(var(--accent-text))" },
  ".ob-cm-brace-marker": {
    color: "rgb(var(--ink))",
    backgroundColor: "rgb(var(--accent) / 0.2)",
  },
  ".ob-ed-heading, .ob-ed-heading *": {
    fontWeight: "700",
    color: "rgb(var(--accent-text))",
  },
  ".ob-cm-context-faded": {
    opacity: "0.42",
    transition: "opacity 140ms ease",
  },
  ".ob-cm-context-focus": {
    opacity: "1",
    backgroundColor: "rgb(var(--accent) / 0.045)",
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

function applyInlineFormat(view: EditorView, syntax: InlineSyntax, kind: InlineFormat): boolean {
  if (view.state.readOnly) return false;
  const selection = view.state.selection.main;
  const change = formatInlineSelection(view.state.doc.toString(), selection.from, selection.to, syntax, kind);
  if (!change) return false;
  view.dispatch({
    changes: { from: change.from, to: change.to, insert: change.insert },
    selection: { anchor: change.selFrom, head: change.selTo },
    annotations: isolateHistory.of("full"),
    userEvent: "input.format",
    scrollIntoView: true,
  });
  view.focus();
  return true;
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
  revealRange: (from: number, to: number, options?: { isCurrent?: () => boolean; onDone?: () => void; scrollContainer?: HTMLElement }) => void;
  surround: (open: string, close: string, placeholder?: string) => void;
  format: (syntax: InlineSyntax, kind: InlineFormat) => boolean;
  insertAtCursor: (text: string, asBlock?: boolean) => void;
  getLiveSource: () => string;
  getVirtualSelection: () => { from: number; to: number } | null;
  applyVirtualChange: (from: number, to: number, insert: string) => boolean;
};

export type TexDocChange = { from: number; to: number; insert: string };

export type TexCodeMirrorProps = {
  value: string;
  isValueCurrent?: () => boolean;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onDocChanges?: (changes: TexDocChange[], length: number) => void;
  onScroll?: () => void;
  onFocus?: () => void;
  onReady?: () => void;
  onCommit?: () => void;
  onCancel?: () => void;
  placeholder?: string;
  className?: string;
  variant?: "pane" | "compact" | "nested";
  nativeSearch?: boolean;
  texHighlighting?: boolean;
  lineOffset?: number;
  getCompletionContext?: () => PaperCompletionContext;
  getLspContext?: () => LatexLspContext | undefined;
  headingCounts?: Map<string, number>;
  focusContext?: TexFocusContext | null;
};

const bannerField = StateField.define<Array<{ from: number; to: number }>>({
  create: (state) => bannerRanges(state.doc.toString()),
  update: (ranges, tr) => {
    if (!tr.docChanged) return ranges;
    let next = ranges;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const delta = inserted.length - (toA - fromA);
      next = next.map((range) => {
        if (toA <= range.from) return { from: range.from + delta, to: range.to + delta };
        return range;
      });
    });
    return next;
  },
});

function seedKeyOf(counts?: Map<string, number>): string {
  if (!counts?.size) return "";
  return [...counts.entries()].map(([key, value]) => `${key}:${value}`).join("|");
}

export const TexCodeMirror = forwardRef<TexCodeMirrorHandle, TexCodeMirrorProps>(
  function TexCodeMirror({
    value,
    isValueCurrent,
    readOnly = false,
    onChange,
    onDocChanges,
    onScroll,
    onFocus,
    onReady,
    onCommit,
    onCancel,
    placeholder,
    className,
    variant = "pane",
    nativeSearch = true,
    texHighlighting = true,
    lineOffset = 0,
    getCompletionContext,
    getLspContext,
    headingCounts,
    focusContext = null,
  }, ref) {
    const completionContextRef = useRef(getCompletionContext);
    completionContextRef.current = getCompletionContext;
    const lspContextRef = useRef(getLspContext);
    lspContextRef.current = getLspContext;
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const highlightTimerRef = useRef<number | null>(null);
    const placeholderCompRef = useRef(new Compartment());
    const seedCompRef = useRef(new Compartment());
    const lineCompRef = useRef(new Compartment());
    const languageCompRef = useRef(new Compartment());
    const readOnlyCompRef = useRef(new Compartment());
    const onChangeRef = useRef(onChange);
    const onDocChangesRef = useRef(onDocChanges);
    const onScrollRef = useRef(onScroll);
    const onFocusRef = useRef(onFocus);
    const onReadyRef = useRef(onReady);
    const onCommitRef = useRef(onCommit);
    const onCancelRef = useRef(onCancel);
    const valueRef = useRef(value);
    const placeholderRef = useRef(placeholder);
    const headingCountsRef = useRef(headingCounts);
    const variantRef = useRef(variant);
    const focusContextRef = useRef(focusContext);
    onChangeRef.current = onChange;
    onDocChangesRef.current = onDocChanges;
    onScrollRef.current = onScroll;
    onFocusRef.current = onFocus;
    onReadyRef.current = onReady;
    onCommitRef.current = onCommit;
    onCancelRef.current = onCancel;
    valueRef.current = value;
    placeholderRef.current = placeholder;
    headingCountsRef.current = headingCounts;
    variantRef.current = variant;
    focusContextRef.current = focusContext;

    const applyLocal = (from: number, to: number, insert: string): boolean => {
      const view = viewRef.current;
      if (!view || view.state.readOnly) return false;
      const len = view.state.doc.length;
      const start = clampPos(from, len);
      const end = clampPos(to, len);
      const sel = view.state.selection.main;
      const intersects = sel.to >= start && sel.from <= end;
      const hadFocus = view.hasFocus;
      view.dispatch({
        changes: { from: start, to: end, insert },
        ...(intersects ? { selection: { anchor: start + insert.length }, scrollIntoView: true } : {}),
        annotations: [Transaction.addToHistory.of(true)],
      });
      if (hadFocus || intersects) view.focus();
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
      revealRange: (from, to, options) => {
        const view = viewRef.current;
        if (!view) { options?.onDone?.(); return; }
        const start = clampPos(from, view.state.doc.length);
        const end = Math.max(start, clampPos(to, view.state.doc.length));
        if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
        const effects: StateEffect<unknown>[] = [sourceHighlightEffect.of({ from: start, to: end })];
        foldedRanges(view.state).between(start, end, (from, to) => { effects.push(unfoldEffect.of({ from, to })); });
        view.dispatch({ effects });
        const scroller = options?.scrollContainer ?? view.scrollDOM;
        view.requestMeasure({
          read: (editor) => {
            const line = editor.lineBlockAt(start);
            return { top: editor.documentTop + line.top, bottom: editor.documentTop + line.bottom, pane: scroller.getBoundingClientRect() };
          },
          write: ({ top, bottom, pane }) => {
            if (!options?.isCurrent || options.isCurrent()) {
              const margin = 12;
              if (top < pane.top + margin) scroller.scrollTop += top - pane.top - margin;
              else if (bottom > pane.bottom - margin) scroller.scrollTop += Math.min(top - pane.top - margin, bottom - pane.bottom + margin);
            }
            options?.onDone?.();
          },
        });
        highlightTimerRef.current = window.setTimeout(() => {
          if (viewRef.current === view) view.dispatch({ effects: sourceHighlightEffect.of(null) });
          highlightTimerRef.current = null;
        }, 3000);
      },
      surround: (open, close, ph) => {
        const view = viewRef.current;
        if (!view || view.state.readOnly) return;
        surroundSelection(view, open, close, ph);
      },
      format: (syntax, kind) => {
        const view = viewRef.current;
        return view && !view.state.readOnly ? applyInlineFormat(view, syntax, kind) : false;
      },
      insertAtCursor: (text, asBlock = false) => {
        const view = viewRef.current;
        if (!view || view.state.readOnly) return;
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

      const completion = autocompletion({ override: [latexCompletionSource(true), projectCompletions(() => completionContextRef.current?.() ?? { source: viewRef.current?.state.doc.toString() || valueRef.current, citationKeys: [] }), latexLspCompletions(() => lspContextRef.current?.())] });
      const placeholderComp = placeholderCompRef.current;
      const seedComp = seedCompRef.current;
      const compact = variantRef.current === "compact";
      const focusField = focusContextField(focusContextRef.current);
      const view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: valueRef.current,
          extensions: [
            readOnlyCompRef.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
            languageCompRef.current.of(texHighlighting ? [latexSyntax(), completion] : []),
            syntaxHighlighting(obHighlightStyle),
            ...(compact ? [agentMentionDecorations] : []),
            history(),
            drawSelection(),
            ...(compact ? [] : [
              codeFolding({ placeholderText: "⋯" }),
              lineCompRef.current.of(lineNumbers({ formatNumber: (number) => String(number + lineOffset) })),
              foldGutter(),
              foldService.of(packageFoldService),
            ]),
            ...(variantRef.current === "nested" ? [EditorView.decorations.compute(["doc"], (state) => {
              const end = state.doc.length;
              if (!end || state.doc.sliceString(end - 1, end) !== "\n") return Decoration.none;
              // The newline separates source slices without adding a display row.
              return Decoration.set([Decoration.replace({}).range(end - 1, end)]);
            })] : []),
            EditorView.lineWrapping,
            EditorState.tabSize.of(2),
            indentUnit.of("  "),
            keymap.of([
              { key: "Tab", run: acceptCompletion },
              ...completionKeymap,
              {
                key: "Mod-Enter",
                run: () => {
                  onCommitRef.current?.();
                  return Boolean(onCommitRef.current);
                },
              },
              {
                key: "Escape",
                run: () => {
                  onCancelRef.current?.();
                  return Boolean(onCancelRef.current);
                },
              },
              {
                key: "Mod-b",
                run: (ed) => {
                  applyInlineFormat(ed, "tex", "bold");
                  return true;
                },
              },
              {
                key: "Mod-i",
                run: (ed) => {
                  applyInlineFormat(ed, "tex", "italic");
                  return true;
                },
              },
              ...(compact ? [] : [indentWithTab, ...foldKeymap]),
              ...(!compact && nativeSearch ? searchKeymap : []),
              ...historyKeymap,
              ...defaultKeymap,
            ]),
            ...(!compact && nativeSearch ? [search()] : []),
            seedComp.of(headingCountSeed.of(new Map(headingCountsRef.current))),
            obMarkerDecorations,
            ...(variantRef.current === "nested" ? [metadataMarkers, commentKindsSource.of(() => completionContextRef.current?.().source ?? ""), boundaryLineNumbers] : []),
            focusField,
            sourceHighlightField,
            bannerField,
            EditorState.transactionFilter.of((tr) => {
              if (compact || !tr.docChanged) return tr;
              const banners = tr.startState.field(bannerField);
              let blocked = false;
              tr.changes.iterChanges((fromA, toA) => {
                for (const range of banners) {
                  if (fromA < range.to && toA > range.from) blocked = true;
                }
              });
              return blocked ? [] : tr;
            }),
            compact ? obCompactTheme : obEditorTheme,
            EditorView.editorAttributes.of({
              class: compact ? "ob-cm-editor ob-cm-compact" : "ob-cm-editor",
            }),
            EditorView.contentAttributes.of({ spellcheck: "true", ...(!nativeSearch ? { tabindex: "0" } : {}) }),
            placeholderComp.of(placeholderRef.current ? cmPlaceholder(placeholderRef.current) : []),
            EditorView.updateListener.of((update) => {
              if (update.focusChanged && update.view.hasFocus) onFocusRef.current?.();
              if (!update.docChanged) return;
              if (update.transactions.some((tr) => tr.annotation(fromPropSync))) return;
              const notify = onDocChangesRef.current;
              if (notify) {
                const changes: TexDocChange[] = [];
                update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                  changes.push({ from: fromA, to: toA, insert: inserted.toString() });
                });
                notify(changes, update.state.doc.length);
                return;
              }
              onChangeRef.current?.(update.state.doc.toString());
            }),
          ],
        }),
      });
      viewRef.current = view;
      onReadyRef.current?.();
      const initialFoldFrame = requestAnimationFrame(() => {
        if (viewRef.current === view) collapseInitialPackageGroups(view);
      });

      const onScrollDom = () => {
        onScrollRef.current?.();
      };
      view.scrollDOM.addEventListener("scroll", onScrollDom, { passive: true });

      return () => {
        cancelAnimationFrame(initialFoldFrame);
        if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
        view.scrollDOM.removeEventListener("scroll", onScrollDom);
        view.destroy();
        viewRef.current = null;
      };
    }, []);

    useEffect(() => {
      viewRef.current?.dispatch({ effects: readOnlyCompRef.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
    }, [readOnly]);

    const focusContextKey = focusContext
      ? `${focusContext.from}:${focusContext.to}:${focusContext.beforeLines}:${focusContext.afterLines}`
      : "";
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ effects: focusContextEffect.of(focusContextRef.current) });
    }, [focusContextKey]);

    useLayoutEffect(() => {
      const view = viewRef.current;
      if (!view || (isValueCurrent && !isValueCurrent())) return;
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
    }, [value, isValueCurrent]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: placeholderCompRef.current.reconfigure(placeholder ? cmPlaceholder(placeholder) : []),
      });
    }, [placeholder]);

    useEffect(() => {
      viewRef.current?.dispatch({
        effects: languageCompRef.current.reconfigure(texHighlighting ? [latexSyntax(), autocompletion({ override: [latexCompletionSource(true), projectCompletions(() => completionContextRef.current?.() ?? { source: viewRef.current?.state.doc.toString() || valueRef.current, citationKeys: [] }), latexLspCompletions(() => lspContextRef.current?.())] })] : []),
      });
    }, [texHighlighting]);

    useEffect(() => { if (variantRef.current === "compact") return; viewRef.current?.dispatch({ effects: lineCompRef.current.reconfigure(lineNumbers({ formatNumber: (number) => String(number + lineOffset) })) }); }, [lineOffset]);

    const seedKey = seedKeyOf(headingCounts);
    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: seedCompRef.current.reconfigure(headingCountSeed.of(new Map(headingCountsRef.current))),
      });
    }, [seedKey]);

    return (
      <div
        ref={hostRef}
        className={cn(
          "ob-cm-root",
          variant === "compact" && "ob-cm-root-compact",
          variant === "nested" && "ob-cm-root-nested",
          className,
        )}
      />
    );
  },
);

TexCodeMirror.displayName = "TexCodeMirror";
