import { StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet, keymap } from "@codemirror/view";
import { inlineFormattingSpans, type InlineSyntax } from "@/lib/mindmap/text-formatting";

/** Keep authored formatting in the document while showing its styled contents. */
export function inlineFormattingExtensions(syntax: InlineSyntax): Extension {
  const decorate = (source: string): { content: DecorationSet; markers: DecorationSet } => {
    const content = [];
    const markers = [];
    for (const kind of ["bold", "italic"] as const) {
      for (const span of inlineFormattingSpans(source, syntax, kind)) {
        const open = Decoration.replace({}).range(span.from, span.innerFrom);
        const close = Decoration.replace({}).range(span.innerTo, span.to);
        markers.push(open, close);
        content.push(open, close);
        if (span.innerTo > span.innerFrom) content.push(Decoration.mark({
          tagName: kind === "bold" ? "strong" : "em",
          class: `ob-cm-inline-${kind}`,
        }).range(span.innerFrom, span.innerTo));
      }
    }
    return { content: Decoration.set(content, true), markers: Decoration.set(markers, true) };
  };
  const field = StateField.define({
    create: state => decorate(state.doc.toString()),
    update: (value, transaction) => transaction.docChanged ? decorate(transaction.newDoc.toString()) : value,
    provide: field => EditorView.decorations.from(field, value => value.content),
  });
  const unwrapBoundary = (view: EditorView, backward: boolean): boolean => {
    const selection = view.state.selection.main;
    if (view.state.readOnly || !selection.empty) return false;
    const source = view.state.doc.toString();
    const span = (["bold", "italic"] as const).flatMap(kind => inlineFormattingSpans(source, syntax, kind))
      .filter(span => backward
        ? selection.head === span.innerFrom || selection.head === span.to
        : selection.head === span.innerTo || selection.head === span.from)
      .sort((left, right) => left.to - left.from - (right.to - right.from))[0];
    if (!span) return false;
    view.dispatch({
      changes: [
        { from: span.from, to: span.innerFrom, insert: "" },
        { from: span.innerTo, to: span.to, insert: "" },
      ],
      selection: { anchor: selection.head <= span.innerFrom ? span.from : span.innerTo - (span.innerFrom - span.from) },
      userEvent: "delete.format",
    });
    return true;
  };
  return [
    field,
    keymap.of([
      { key: "Backspace", run: view => unwrapBoundary(view, true) },
      { key: "Delete", run: view => unwrapBoundary(view, false) },
    ]),
    EditorView.atomicRanges.of(view => view.state.field(field).markers),
    EditorView.theme({
      ".ob-cm-inline-bold": { fontWeight: "700" },
      ".ob-cm-inline-italic": { fontStyle: "italic" },
    }),
  ];
}
