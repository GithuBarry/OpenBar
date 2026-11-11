import { EditorState, Facet, StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { findMacroMatches, parseAnchorAttrs, serializeAnchorAttrs } from "@/lib/marker-codec";
import { commentKindAppearance, commentKindValidationError, DEFAULT_COMMENT_KINDS } from "@/lib/comment-kinds";

const unlockMetadata = StateEffect.define<number>();
const metadataFocus = StateEffect.define<boolean>();
export const commentKindsSource = Facet.define<() => string, (() => string) | null>({ combine: sources => sources.at(-1) ?? null });
let commentKindMeasureContext: CanvasRenderingContext2D | null | undefined;
class BoundaryAnchor extends WidgetType {
  constructor(readonly raw: string, readonly from: number, readonly active: boolean) { super(); }
  eq(other: BoundaryAnchor) { return this.raw === other.raw && this.from === other.from && this.active === other.active; }
  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ob-cm-anchor-marker${this.active ? " ob-cm-anchor-active" : ""}`;
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "ob-cm-metadata-lock");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "2");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z");
    icon.appendChild(path);
    button.appendChild(icon);
    if (this.active) {
      const raw = document.createElement("code");
      raw.className = "ob-cm-metadata-raw";
      raw.textContent = this.raw;
      button.appendChild(document.createTextNode(" "));
      button.appendChild(raw);
    }
    button.title = `OpenBar anchor\n${this.raw}\nClick to edit this line`;
    button.setAttribute("aria-label", `Edit OpenBar anchor: ${this.raw}`);
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => {
      // Establish editor focus before this widget is replaced by editable text.
      view.focus();
      view.dispatch({ effects: unlockMetadata.of(view.state.doc.lineAt(this.from).number), selection: { anchor: this.from } });
    });
    return button;
  }
  ignoreEvent() { return true; }
}

class AnnotationBadge extends WidgetType {
  constructor(readonly kind: "obtodo" | "obcomment", readonly from: number) { super(); }
  eq(other: AnnotationBadge) { return this.kind === other.kind && this.from === other.from; }
  toDOM(view: EditorView) {
    const button = document.createElement("button");
    const label = this.kind === "obtodo" ? "TODO" : "Comment";
    button.type = "button";
    button.className = `ob-cm-note-badge ${this.kind === "obtodo" ? "ob-cm-note-todo" : "ob-cm-note-comment"}`;
    button.textContent = label;
    button.title = `Show ${label} TeX`;
    button.setAttribute("aria-label", `Show ${label} TeX`);
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => {
      view.focus();
      view.dispatch({ effects: unlockMetadata.of(view.state.doc.lineAt(this.from).number), selection: { anchor: this.from } });
    });
    return button;
  }
  ignoreEvent() { return true; }
}

// Edit only the kind attribute so formatting and other project metadata survive.
function setCommentKind(view: EditorView, from: number, kind: string) {
  if (view.state.readOnly || !view.state.facet(EditorView.editable) || commentKindValidationError(kind)) return;
  const source = view.state.doc.toString();
  const macro = findMacroMatches(source, ["obcomment"]).find(item => item.index === from);
  if (!macro) return;
  const nameEnd = from + "\\obcomment".length;
  let attrsStart = nameEnd;
  while (/\s/.test(source[attrsStart] || "")) attrsStart += 1;
  const value = kind.trim();
  const replacement = value ? serializeAnchorAttrs({ kind: value }) : 'kind=""';
  if (source[attrsStart] !== "[") {
    if (value) view.dispatch({ changes: { from: nameEnd, insert: `[${replacement}]` }, userEvent: "select.commentKind" });
    return;
  }
  // Walk the attribute syntax in the same manner as parseAnchorAttrs. The last
  // occurrence wins there, so update it when duplicate keys are present.
  const raw = macro.attrs;
  let at = 0;
  let kindRange: { from: number; to: number } | undefined;
  while (at < raw.length) {
    while (at < raw.length && /[\s,]/.test(raw[at]!)) at += 1;
    const start = at;
    while (at < raw.length && /[A-Za-z0-9_-]/.test(raw[at]!)) at += 1;
    if (at === start) { at += 1; continue; }
    const key = raw.slice(start, at);
    while (at < raw.length && /\s/.test(raw[at]!)) at += 1;
    if (raw[at] !== "=") { at += 1; continue; }
    at += 1;
    while (at < raw.length && /\s/.test(raw[at]!)) at += 1;
    if (raw[at] === '"' || raw[at] === "'") {
      const quote = raw[at++];
      while (at < raw.length) {
        if (raw[at] === "\\" && at + 1 < raw.length && [quote, "\\", "]"].includes(raw[at + 1])) { at += 2; continue; }
        if (raw[at++] === quote) break;
      }
    } else while (at < raw.length && !/[\s,]/.test(raw[at]!)) at += 1;
    if (key === "kind") kindRange = { from: start, to: at };
  }
  const offset = attrsStart + 1;
  if (kindRange) {
    view.dispatch({ changes: { from: offset + kindRange.from, to: offset + kindRange.to, insert: replacement }, userEvent: "select.commentKind" });
  } else if (value) {
    view.dispatch({ changes: { from: offset + raw.length, insert: `${raw.trim() ? ", " : ""}${replacement}` }, userEvent: "select.commentKind" });
  }
}

class CommentKindBadge extends WidgetType {
  constructor(readonly from: number, readonly kind: string, readonly kinds: readonly string[], readonly readOnly: boolean) { super(); }
  eq(other: CommentKindBadge) {
    return this.from === other.from && this.kind === other.kind && this.readOnly === other.readOnly && this.kinds.join("\0") === other.kinds.join("\0");
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "ob-cm-kind-wrap";
    const error = document.createElement("span");
    error.className = "ob-cm-kind-error";
    error.setAttribute("role", "alert");
    const select = document.createElement("select");
    select.className = "ob-cm-note-badge ob-cm-note-comment ob-cm-kind-select";
    select.setAttribute("aria-label", "Comment type");
    select.title = this.readOnly ? "Comment type (viewing only)" : "Change comment type";
    select.disabled = this.readOnly;
    const label = commentKindAppearance(this.kind).label;
    const context = commentKindMeasureContext ??= document.createElement("canvas").getContext("2d");
    if (context) context.font = "600 12px system-ui, sans-serif";
    const labelWidth = context?.measureText(label).width ?? Array.from(label).length * 8;
    select.style.width = `${Math.min(160, Math.max(44, Math.ceil(labelWidth + 25)))}px`;
    const values: string[] = DEFAULT_COMMENT_KINDS.map(item => item.value);
    for (const kind of [...this.kinds, this.kind]) {
      if (kind && !values.some(value => value.toLowerCase() === kind.toLowerCase())) values.push(kind);
    }
    for (const [index, value] of values.entries()) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = commentKindAppearance(value).label;
      select.appendChild(option);
    }
    select.value = String(Math.max(0, values.findIndex(value => value.toLowerCase() === this.kind.toLowerCase())));
    for (const [value, label] of [["custom", "Custom type…"], ["source", "Show comment TeX"]]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
    select.addEventListener("focus", () => {
      const fullSource = view.state.facet(commentKindsSource)?.();
      if (!fullSource) return;
      const customOption = Array.from(select.options).find(option => option.value === "custom");
      for (const macro of findMacroMatches(fullSource, ["obcomment"])) {
        const kind = parseAnchorAttrs(macro.attrs).kind?.trim();
        if (!kind || values.some(value => value.toLowerCase() === kind.toLowerCase())) continue;
        const option = document.createElement("option");
        option.value = String(values.length);
        option.textContent = commentKindAppearance(kind).label;
        values.push(kind);
        select.insertBefore(option, customOption ?? null);
      }
    });
    select.addEventListener("mousedown", event => event.stopPropagation());
    select.addEventListener("change", () => {
      error.textContent = "";
      if (select.value === "source") {
        view.focus();
        view.dispatch({ effects: unlockMetadata.of(view.state.doc.lineAt(this.from).number), selection: { anchor: this.from } });
      } else if (select.value === "custom") {
        select.hidden = true;
        const input = document.createElement("input");
        input.className = "ob-cm-kind-input";
        input.setAttribute("aria-label", "Custom comment type. Press Enter to save or Escape to cancel.");
        input.maxLength = 80;
        input.placeholder = "Comment type";
        input.value = this.kind;
        const cancel = () => { input.remove(); error.textContent = ""; select.hidden = false; select.value = String(Math.max(0, values.findIndex(value => value.toLowerCase() === this.kind.toLowerCase()))); };
        input.addEventListener("input", () => {
          error.textContent = commentKindValidationError(input.value) ?? "";
          input.setAttribute("aria-invalid", String(!!error.textContent));
        });
        input.addEventListener("keydown", event => {
          event.stopPropagation();
          if (event.key === "Escape") { event.preventDefault(); cancel(); select.focus(); }
          if (event.key === "Enter" && input.value.trim()) {
            event.preventDefault();
            const validationError = commentKindValidationError(input.value);
            if (validationError) { error.textContent = validationError; input.setAttribute("aria-invalid", "true"); return; }
            setCommentKind(view, this.from, input.value); view.focus();
          }
        });
        input.addEventListener("blur", cancel);
        wrap.appendChild(input);
        input.focus();
        input.select();
      } else {
        const value = values[Number(select.value)];
        if (value !== undefined) {
          const validationError = commentKindValidationError(value);
          if (validationError) {
            error.textContent = validationError;
            select.value = String(Math.max(0, values.findIndex(item => item.toLowerCase() === this.kind.toLowerCase())));
          } else setCommentKind(view, this.from, value);
        }
      }
    });
    wrap.appendChild(select);
    wrap.appendChild(error);
    return wrap;
  }
  ignoreEvent() { return true; }
}

type MetadataState = { focused: boolean; unlocked: number | null; decorations: DecorationSet; todoLines: DecorationSet; ranges: { from: number; to: number }[] };

const todoLine = Decoration.line({ class: "ob-cm-todo-line" });

function collectMetadata(state: EditorState, unlocked: number | null, focused: boolean): MetadataState {
  const decorations: Range<Decoration>[] = [];
  const todoLines: Range<Decoration>[] = [];
  const markedTodoLines = new Set<number>();
  const ranges: MetadataState["ranges"] = [];
  const activeLine = focused ? state.doc.lineAt(state.selection.main.head).number : null;
  const add = (from: number, to: number, boundary = false, replacement?: WidgetType) => {
    const line = state.doc.lineAt(from).number;
    if (boundary && line === unlocked) return;
    // Inline IDs and interior metadata stay hidden, including on the cursor line.
    const widget = replacement ?? (boundary ? new BoundaryAnchor(state.sliceDoc(from, to), from, line === activeLine) : undefined);
    decorations.push(Decoration.replace({ widget }).range(from, to));
    ranges.push({ from, to });
  };
  let first = 1;
  let last = state.doc.lines;
  while (first < last && !state.doc.line(first).text.trim()) first += 1;
  while (last > first && !state.doc.line(last).text.trim()) last -= 1;
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (/^\s*%\s*OB-(SECTION\b|EDIT-(?:BEGIN|END)\b)/.test(line.text)) add(line.from, line.to, number === first || number === last);
  }
  const source = state.doc.toString();
  const macros = findMacroMatches(source, ["obtodo", "obcomment"]);
  const kinds = [...new Set(macros.filter(macro => macro.name === "obcomment").map(macro => parseAnchorAttrs(macro.attrs).kind?.trim()).filter((kind): kind is string => !!kind))];
  for (const macro of macros) {
    const line = state.doc.lineAt(macro.index).number;
    if (macro.name === "obtodo") {
      const last = state.doc.lineAt(macro.index + macro.length - 1).number;
      for (let number = line; number <= last; number += 1) {
        if (markedTodoLines.has(number)) continue;
        markedTodoLines.add(number);
        todoLines.push(todoLine.range(state.doc.line(number).from));
      }
    }
    if (line === unlocked) continue;
    const end = macro.index + macro.length;
    const open = end - macro.body.length - 2;
    if (source[open] === "{" && source[end - 1] === "}" && !/[\r\n]/.test(source.slice(macro.index, open + 1))) {
      const selection = state.selection.main;
      const selectingBoundary = focused && !selection.empty && (
        (selection.from < open + 1 && selection.to > macro.index)
        || (selection.from < end && selection.to > end - 1)
      );
      if (selectingBoundary) continue;
      const badge = macro.name === "obcomment"
        ? new CommentKindBadge(macro.index, parseAnchorAttrs(macro.attrs).kind?.trim() ?? "", kinds, state.readOnly || !state.facet(EditorView.editable))
        : new AnnotationBadge("obtodo", macro.index);
      add(macro.index, open + 1, false, badge);
      add(end - 1, end);
      continue;
    }
    if (!macro.attrs) continue;
    let from = macro.index + macro.name.length + 1;
    while (/\s/.test(source[from] || "")) from += 1;
    if (source[from] === "[") add(from, from + macro.attrs.length + 2);
  }
  return { focused, unlocked, decorations: Decoration.set(decorations, true), todoLines: Decoration.set(todoLines, true), ranges };
}

const metadataField = StateField.define<MetadataState>({
  create: state => collectMetadata(state, null, false),
  update(value, transaction) {
    const unlock = transaction.effects.find(effect => effect.is(unlockMetadata));
    const focus = transaction.effects.find(effect => effect.is(metadataFocus));
    if (!unlock && !focus && !transaction.docChanged && !transaction.selection && !transaction.reconfigured) return value;
    const focused = focus ? focus.value : value.focused;
    const activeLine = transaction.state.doc.lineAt(transaction.state.selection.main.head).number;
    const unlocked = focus?.value === false ? null : unlock ? unlock.value : value.unlocked === activeLine ? value.unlocked : null;
    return collectMetadata(transaction.state, unlocked, focused);
  },
  provide: field => [
    EditorView.decorations.from(field, value => value.decorations),
    EditorView.decorations.from(field, value => value.todoLines),
  ],
});

export const metadataMarkers: Extension = [
  metadataField,
  EditorView.theme({
    ".cm-line.ob-cm-todo-line": {
      boxShadow: "inset 2px 0 rgb(var(--warn) / .35)",
      backgroundColor: "rgb(var(--warn) / .035)",
      paddingLeft: "10px",
    },
    ".cm-content .ob-cm-anchor-marker": {
      display: "inline-flex", alignItems: "center", gap: "3px", maxWidth: "100%", padding: "1px 2px",
      border: "0", borderRadius: "3px", boxSizing: "border-box",
      backgroundColor: "rgb(var(--accent) / .025)", color: "rgb(var(--ink))",
      font: "12px/1.25 var(--font-sans), sans-serif", verticalAlign: "baseline", whiteSpace: "nowrap", cursor: "pointer",
    },
    ".cm-content .ob-cm-anchor-marker:hover": { backgroundColor: "rgb(var(--accent) / .07)", color: "rgb(var(--ink))" },
    ".cm-content .ob-cm-anchor-marker:focus-visible": { outline: "2px solid rgb(var(--accent) / .6)", outlineOffset: "2px" },
    ".cm-content .ob-cm-anchor-active": { padding: "1px 4px", border: "1px solid rgb(var(--accent) / .12)", backgroundColor: "rgb(var(--accent) / .045)", whiteSpace: "normal" },
    ".cm-content .ob-cm-note-badge": {
      display: "inline-flex", alignItems: "center", marginRight: "4px", padding: "1px 5px", border: "0", borderRadius: "4px",
      font: "600 12px/1.4 var(--font-sans), sans-serif", verticalAlign: "baseline", whiteSpace: "nowrap", cursor: "pointer",
    },
    ".cm-content .ob-cm-note-todo": { backgroundColor: "rgb(var(--warn) / .12)", color: "rgb(var(--warn-text))" },
    ".cm-content .ob-cm-note-comment": { backgroundColor: "rgb(var(--accent) / .1)", color: "rgb(var(--ink))" },
    ".cm-content .ob-cm-kind-wrap": { display: "inline" },
    ".cm-content .ob-cm-kind-select": { appearance: "none", paddingRight: "18px", textOverflow: "ellipsis", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='m3 4.5 3 3 3-3' fill='none' stroke='%234b5563' stroke-width='1.5'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 4px center", backgroundSize: "10px" },
    ".cm-content .ob-cm-kind-select:disabled": { opacity: "0.8", cursor: "default" },
    ".cm-content .ob-cm-kind-select[hidden]": { display: "none" },
    ".cm-content .ob-cm-kind-input": { font: "600 12px/1.4 var(--font-sans), sans-serif", width: "120px", marginRight: "4px", padding: "1px 5px", border: "1px solid rgb(var(--accent) / .5)", borderRadius: "4px", backgroundColor: "rgb(var(--canvas))", color: "rgb(var(--ink))" },
    ".cm-content .ob-cm-kind-error:not(:empty)": { font: "12px/1.4 var(--font-sans), sans-serif", color: "rgb(var(--warn-text))", marginRight: "6px" },
    ".cm-content .ob-cm-note-badge:focus-visible": { outline: "2px solid rgb(var(--accent) / .6)", outlineOffset: "2px" },
    ".ob-cm-metadata-lock": { display: "block", flexShrink: "0", width: "9px", height: "9px" },
    ".ob-cm-metadata-raw": { minWidth: "0", color: "rgb(var(--ink))", font: "12px/1.5 var(--font-mono), monospace", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  }),
  EditorView.focusChangeEffect.of((_state, focusing) => metadataFocus.of(focusing)),
  EditorView.atomicRanges.of(view => view.state.field(metadataField).decorations),
  EditorState.transactionFilter.of(transaction => {
    if (!transaction.docChanged || !(transaction.isUserEvent("delete") || transaction.isUserEvent("input"))) return transaction;
    const { ranges } = transaction.startState.field(metadataField);
    let blocked = false;
    transaction.changes.iterChanges((from, to) => {
      if (ranges.some(range => from === to ? from > range.from && from < range.to : from < range.to && to > range.from)) blocked = true;
    });
    return blocked ? [] : transaction;
  }),
];
