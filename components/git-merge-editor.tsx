"use client";

import { useEffect, useRef } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";

export function GitMergeEditor({ original, value, disabled, onChange }: {
  original: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const current = useRef({ value, onChange });
  current.current = { value, onChange };
  useEffect(() => {
    if (!host.current) return;
    const common = [lineNumbers(), EditorView.lineWrapping, EditorView.theme({
      "&": { color: "rgb(var(--ink))", backgroundColor: "rgb(var(--surface))", fontSize: "12px" },
      ".cm-content": { fontFamily: "var(--font-mono)", padding: "8px 0" },
      ".cm-gutters": { backgroundColor: "rgb(var(--surface))", color: "rgb(var(--muted))" },
      ".cm-scroller": { overflow: "auto" },
    })];
    const view = new MergeView({
      parent: host.current,
      a: { doc: original, extensions: [...common, EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.contentAttributes.of({ "aria-label": "Git version" })] },
      b: { doc: current.current.value, extensions: [...common, history(), keymap.of([...historyKeymap, ...defaultKeymap]), EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled), EditorView.contentAttributes.of({ "aria-label": "Combined result" }), EditorView.updateListener.of(update => { if (update.docChanged) current.current.onChange(update.state.doc.toString()); })] },
      revertControls: disabled ? undefined : "a-to-b",
      renderRevertControl: () => { const button = document.createElement("button"); button.textContent = "→"; button.title = "Use this Git change in the combined result"; button.setAttribute("aria-label", button.title); return button; },
    });
    return () => view.destroy();
  }, [original, disabled]);
  return <div className="ob-git-merge-editor" ref={host} />;
}
