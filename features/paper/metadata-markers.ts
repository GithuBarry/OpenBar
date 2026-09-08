import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

const revealMetadata = StateEffect.define<boolean>();

class MetadataMarker extends WidgetType {
  constructor(readonly label: string) { super(); }
  eq(other: MetadataMarker) { return this.label === other.label; }
  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ob-cm-metadata-marker";
    button.textContent = this.label;
    button.title = "Protected metadata · click to reveal and edit the TeX comment";
    button.setAttribute("aria-label", `Reveal ${this.label.toLowerCase()}`);
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => view.dispatch({ effects: revealMetadata.of(true) }));
    return button;
  }
  ignoreEvent() { return true; }
}

type MetadataState = { revealed: boolean; decorations: DecorationSet; ranges: { from: number; to: number }[] };

function collectMetadata(state: EditorState, revealed: boolean): MetadataState {
  const decorations = [];
  const ranges = [];
  if (!revealed) {
    for (let number = 1; number <= state.doc.lines; number += 1) {
      const line = state.doc.line(number);
      const match = /^%\s*OB-(SECTION\b|EDIT-(?:BEGIN|END)\b)/.exec(line.text);
      if (!match) continue;
      const label = match[1] === "SECTION" ? "Section metadata" : match[1] === "EDIT-BEGIN" ? "Source boundary · start" : "Source boundary · end";
      decorations.push(Decoration.replace({ widget: new MetadataMarker(label) }).range(line.from, line.to));
      ranges.push({ from: line.from, to: Math.min(state.doc.length, line.to + 1) });
    }
  }
  return { revealed, decorations: Decoration.set(decorations), ranges };
}

const metadataField = StateField.define<MetadataState>({
  create: (state) => collectMetadata(state, false),
  update(value, transaction) {
    const reveal = transaction.effects.find((effect) => effect.is(revealMetadata));
    if (reveal || transaction.docChanged) return collectMetadata(transaction.state, reveal ? reveal.value : value.revealed);
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export const metadataMarkers: Extension = [
  metadataField,
  EditorView.atomicRanges.of((view) => view.state.field(metadataField).decorations),
  EditorState.transactionFilter.of((transaction) => {
    if (!transaction.docChanged || !(transaction.isUserEvent("delete") || transaction.isUserEvent("input"))) return transaction;
    const { ranges } = transaction.startState.field(metadataField);
    let blocked = false;
    transaction.changes.iterChanges((from, to) => {
      if (ranges.some((range) => from < range.to && (to > range.from || (from === to && from >= range.from)))) blocked = true;
    });
    return blocked ? [] : transaction;
  }),
];
