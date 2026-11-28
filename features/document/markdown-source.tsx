"use client";

import { useEffect, useRef } from "react";
import { EditorView, keymap, lineNumbers, drawSelection } from "@codemirror/view";
import { EditorState, Compartment, Transaction, Annotation } from "@codemirror/state";
import { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { applyMarkdownChanges } from "@/lib/markdown-manuscript";

const sync = Annotation.define<boolean>();
export function MarkdownSource({ source, readOnly, onChange, onSelection, onSave, jump }: {
  source: string; readOnly: boolean; onChange: (s: string) => void; onSelection: (at: number) => void; onSave: () => void;
  jump?: { at: number };
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const props = useRef({ source, onChange, onSelection, onSave, readOnly });
  props.current = { source, onChange, onSelection, onSave, readOnly };
  const access = useRef(new Compartment());
  useEffect(() => {
    const v = new EditorView({
      parent: host.current!, doc: props.current.source,
      extensions: [
        markdown(), syntaxHighlighting(defaultHighlightStyle), drawSelection(), lineNumbers(), history(), search(), EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "Markdown manuscript source", spellcheck: "true" }),
        access.current.of([EditorState.readOnly.of(props.current.readOnly), EditorView.editable.of(!props.current.readOnly)]),
        keymap.of([{ key: "Mod-s", run: () => { props.current.onSave(); return true; } }, indentWithTab, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
        EditorView.updateListener.of(u => {
          if (u.transactions.some(t => t.annotation(sync))) return;
          const p = props.current;
          if (u.docChanged) {
            const changes: { from: number; to: number; insert: string }[] = [];
            u.changes.iterChanges((from, to, _a, _b, insert) => changes.push({ from, to, insert: insert.toString() }));
            p.source = applyMarkdownChanges(p.source, changes);
            p.onChange(p.source);
          }
          if (u.selectionSet || u.docChanged) {
            const at = u.state.selection.main.to;
            const line = u.state.doc.lineAt(at);
            // Map the logical CodeMirror offset back to exact source units.
            const preceding = p.source.matchAll(/\r\n|\r|\n/g);
            let rawStart = 0;
            for (let i = 1; i < line.number; i++) { const m = preceding.next().value; if (m) rawStart = m.index! + m[0].length; }
            p.onSelection(rawStart + at - line.from);
          }
        }),
      ],
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
  }, []);
  useEffect(() => {
    view.current?.dispatch({ effects: access.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);
  useEffect(() => {
    const v = view.current;
    const normalized = source.replace(/\r\n?/g, "\n");
    if (v && v.state.doc.toString() !== normalized) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: normalized },
      annotations: [sync.of(true), Transaction.addToHistory.of(false)] });
  }, [source]);
  useEffect(() => {
    const v = view.current;
    if (!v || !jump) return;
    const at = props.current.source.slice(0, jump.at).replace(/\r\n?/g, "\n").length;
    v.dispatch({ selection: { anchor: Math.min(v.state.doc.length, at) }, scrollIntoView: true });
    v.focus();
  }, [jump]);
  return <div ref={host} className="min-h-40 font-mono text-sm" />;
}
