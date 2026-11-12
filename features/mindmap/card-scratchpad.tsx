"use client";

import styles from "./card-scratchpad.module.css";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export type CardNoteField = "caption" | "background";

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
  const notes = [
    { field: "caption" as const, label: "Notes", text },
    { field: "background" as const, label: "Background notes", text: background },
  ].filter(note => editing || note.text?.trim());
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
    {notes.map(note => <details className={styles.scratchpad} key={note.label}>
      <summary aria-label={note.label}><span className={styles.tab}><ChevronRight size={12} aria-hidden="true" />{note.label}</span></summary>
      <div className={styles.body}>
        <strong className={styles.heading}>{note.label}</strong>
        {editing ? <textarea className={styles.editor} aria-label={note.label} value={note.text || ""} readOnly={readOnly} rows={3}
          onChange={event => onChange?.(note.field, event.target.value)} /> : <div>{note.text}</div>}
      </div>
    </details>)}
    {footer && <div className={styles.footer}>{footer}</div>}
  </div>;
}
