import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, ViewPlugin, gutterLineClass, type ViewUpdate } from "@codemirror/view";

const nearbyBoundary = StateEffect.define<number | null>();

class BoundaryNumber extends GutterMarker {
  constructor(current: boolean, near: boolean) {
    super();
    this.elementClass = `ob-edge-number${current ? " ob-edge-current" : ""}${near ? " ob-edge-near" : ""}`;
  }
  eq(other: BoundaryNumber) { return this.elementClass === other.elementClass; }
}

function emptyEdges(state: EditorState) {
  return [...new Set([1, state.doc.lines])].map(number => state.doc.line(number)).filter(line => !line.text.trim());
}

function numberMarks(state: EditorState, near: number | null) {
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const line of emptyEdges(state)) {
    const current = state.selection.ranges.some(range => range.head >= line.from && range.head <= line.to);
    builder.add(line.from, line.from, new BoundaryNumber(current, near === line.from));
  }
  return { near, marks: builder.finish() };
}

const numberField = StateField.define({
  create: state => numberMarks(state, null),
  update(value, transaction) {
    const effect = transaction.effects.find(effect => effect.is(nearbyBoundary));
    if (transaction.docChanged || transaction.selection || effect) {
      return numberMarks(transaction.state, transaction.docChanged ? null : effect ? effect.value : value.near);
    }
    return value;
  },
  provide: field => gutterLineClass.from(field, value => value.marks),
});

function edgeRows(view: EditorView) {
  return Decoration.set(emptyEdges(view.state).filter(line => !(view.hasFocus && view.state.selection.ranges.some(range => range.head >= line.from && range.head <= line.to)))
    .map(line => Decoration.line({ class: "ob-edge-row" }).range(line.from)));
}

const edgePlugin = ViewPlugin.fromClass(class {
  decorations;
  constructor(readonly view: EditorView) {
    this.decorations = edgeRows(view);
    view.dom.addEventListener("pointermove", this.move, { passive: true });
    view.dom.addEventListener("pointerleave", this.leave, { passive: true });
  }
  move = (event: PointerEvent) => {
    let near: number | null = null;
    let distance = 12;
    for (const line of emptyEdges(this.view.state)) {
      const block = this.view.lineBlockAt(line.from);
      const delta = Math.abs(event.clientY - (this.view.documentTop + block.top + block.height / 2));
      if (delta <= distance) { distance = delta; near = line.from; }
    }
    this.setNear(near);
  };
  leave = () => this.setNear(null);
  setNear(near: number | null) {
    if (this.view.state.field(numberField).near !== near) this.view.dispatch({ effects: nearbyBoundary.of(near) });
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.focusChanged) this.decorations = edgeRows(update.view);
  }
  destroy() {
    this.view.dom.removeEventListener("pointermove", this.move);
    this.view.dom.removeEventListener("pointerleave", this.leave);
  }
}, { decorations: plugin => plugin.decorations });

export const boundaryLineNumbers = [numberField, edgePlugin, EditorView.theme({
  ".cm-line.ob-edge-row": { height: "6px", lineHeight: "6px", minHeight: "0", fontSize: "0" },
  ".cm-gutterElement.ob-edge-number": { fontSize: "6px", lineHeight: "6px", overflow: "hidden", opacity: "0" },
  ".cm-gutterElement.ob-edge-near": { opacity: "1" },
  "&.cm-focused .cm-gutterElement.ob-edge-current": { fontSize: "inherit", lineHeight: "inherit", opacity: "1" },
})];
