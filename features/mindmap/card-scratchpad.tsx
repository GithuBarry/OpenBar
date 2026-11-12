"use client";

import styles from "./card-scratchpad.module.css";
import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CAUTION_LEVEL_LABELS, hasNoteText } from "@/lib/mindmap/caution";

export type CardNoteField = "caption" | "background";

function fitEditor(editor: HTMLTextAreaElement | null) {
  if (!editor) return;
  editor.style.height = "auto";
  editor.style.height = `${editor.scrollHeight}px`;
}

export function CardScratchpad({ text, background, editing = false, readOnly = false, onChange, onCommit, onCancel, footer }: {
  text?: string;
  background?: string;
  editing?: boolean;
  readOnly?: boolean;
  onChange?: (field: CardNoteField, value: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  footer?: ReactNode;
}) {
  const [focusedNote, setFocusedNote] = useState<CardNoteField | null>(null);
  const notes = [
    { field: "caption" as const, label: "Notes", text },
    { field: "background" as const, label: CAUTION_LEVEL_LABELS.background, text: background },
  ].filter(note => note.field === focusedNote || hasNoteText(note.text));
  if (!notes.length && !footer) return null;
  return <div className={`${styles.scratchpads} ${notes.length ? styles.withNotes : ""} nodrag nopan`}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (!editing || event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); onCancel?.(); }
      if (!readOnly && event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onCommit?.(); }
    }}
    onWheel={event => event.stopPropagation()}>
    {notes.map(note => <details className={styles.scratchpad} key={note.label}
      onToggle={event => { if (event.currentTarget.open) fitEditor(event.currentTarget.querySelector("textarea")); }}>
      <summary aria-label={note.label}><span className={styles.tab}><ChevronRight size={12} aria-hidden="true" />{note.label}</span></summary>
      <div className={styles.body}>
        <strong className={styles.heading}>{note.label}</strong>
        <textarea ref={editor => fitEditor(editor)} className={styles.editor} aria-label={note.label} value={note.text || ""} readOnly={readOnly || !onChange} rows={2}
          onFocus={() => setFocusedNote(note.field)} onBlur={() => setFocusedNote(null)}
          onInput={event => fitEditor(event.currentTarget)}
          onChange={event => onChange?.(note.field, event.target.value)} />
      </div>
    </details>)}
    {footer && <div className={styles.footer}>{footer}</div>}
  </div>;
}
