import { EditorState, StateEffect, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { findMacroMatches } from "@/lib/marker-codec";

const unlockMetadata = StateEffect.define<number>();
const metadataFocus = StateEffect.define<boolean>();
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

type MetadataState = { focused: boolean; unlocked: number | null; decorations: DecorationSet; ranges: { from: number; to: number }[] };

function collectMetadata(state: EditorState, unlocked: number | null, focused: boolean): MetadataState {
  const decorations: Range<Decoration>[] = [];
  const ranges: MetadataState["ranges"] = [];
  const activeLine = focused ? state.doc.lineAt(state.selection.main.head).number : null;
  const add = (from: number, to: number, boundary = false) => {
    const line = state.doc.lineAt(from).number;
    if (boundary && line === unlocked) return;
    // Inline IDs and interior metadata stay hidden, including on the cursor line.
    const widget = boundary ? new BoundaryAnchor(state.sliceDoc(from, to), from, line === activeLine) : undefined;
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
  for (const macro of findMacroMatches(source, ["obtodo", "obcomment"])) {
    if (!macro.attrs) continue;
    let from = macro.index + macro.name.length + 1;
    while (/\s/.test(source[from] || "")) from += 1;
    if (source[from] === "[") add(from, from + macro.attrs.length + 2);
  }
  return { focused, unlocked, decorations: Decoration.set(decorations, true), ranges };
}

const metadataField = StateField.define<MetadataState>({
  create: state => collectMetadata(state, null, false),
  update(value, transaction) {
    const unlock = transaction.effects.find(effect => effect.is(unlockMetadata));
    const focus = transaction.effects.find(effect => effect.is(metadataFocus));
    if (!unlock && !focus && !transaction.docChanged && !transaction.selection) return value;
    const focused = focus ? focus.value : value.focused;
    const activeLine = transaction.state.doc.lineAt(transaction.state.selection.main.head).number;
    const unlocked = focus?.value === false ? null : unlock ? unlock.value : value.unlocked === activeLine ? value.unlocked : null;
    return collectMetadata(transaction.state, unlocked, focused);
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
});

export const metadataMarkers: Extension = [
  metadataField,
  EditorView.theme({
    ".cm-content .ob-cm-anchor-marker": {
      display: "inline-flex", alignItems: "center", gap: "3px", maxWidth: "100%", padding: "1px 2px",
      border: "0", borderRadius: "3px", boxSizing: "border-box",
      backgroundColor: "rgb(var(--accent) / .025)", color: "rgb(var(--accent) / .45)",
      font: "9px/1 var(--font-sans), sans-serif", verticalAlign: "baseline", whiteSpace: "nowrap", cursor: "pointer",
    },
    ".cm-content .ob-cm-anchor-marker:hover": { backgroundColor: "rgb(var(--accent) / .07)", color: "rgb(var(--accent) / .8)" },
    ".cm-content .ob-cm-anchor-marker:focus-visible": { outline: "2px solid rgb(var(--accent) / .6)", outlineOffset: "2px" },
    ".cm-content .ob-cm-anchor-active": { padding: "1px 4px", border: "1px solid rgb(var(--accent) / .12)", backgroundColor: "rgb(var(--accent) / .045)", whiteSpace: "normal" },
    ".ob-cm-metadata-lock": { display: "block", flexShrink: "0", width: "9px", height: "9px" },
    ".ob-cm-metadata-raw": { minWidth: "0", color: "rgb(var(--ink))", font: "10px/1.5 var(--font-mono), monospace", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
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
