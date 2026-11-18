"use client";

import styles from "./card-scratchpad.module.css";
import { ChevronDown } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { cardNotesText, hasNoteText, type MindmapCaution } from "@/lib/mindmap/caution";
import { NotesTextarea } from "./notes-textarea";
import { NotesContentIndicator, notesContentDescription } from "./notes-content-indicator";

function fitEditor(editor: HTMLTextAreaElement | null) {
  if (!editor) return;
  editor.style.height = "auto";
  editor.style.height = `${editor.scrollHeight}px`;
}

export function CardScratchpad({ open, onOpenChange, text, caution, editing = false, readOnly = false, onChange, onCommit, onCancel, footer }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text?: string;
  caution?: MindmapCaution;
  editing?: boolean;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  footer?: ReactNode;
}) {
  const notes = useMemo(() => cardNotesText(text, caution), [text, caution]);
  const hasNotes = useMemo(() => hasNoteText(notes), [notes]);
  const showNotes = hasNotes || editing || open;
  const description = notesContentDescription(notes);
  if (!showNotes && !footer) return null;
  return <div className={`${styles.scratchpads} ${showNotes ? styles.withNotes : ""} nodrag nopan nowheel`}
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
    {showNotes && <details className={styles.scratchpad} open={open}
      onToggle={event => { onOpenChange(event.currentTarget.open); if (event.currentTarget.open) fitEditor(event.currentTarget.querySelector("textarea")); }}>
      <summary aria-label={open ? "Hide notes" : "Show notes"} aria-expanded={open} aria-description={description} title={description}>
        <span className={styles.tab}>
          <ChevronDown className={styles.chevron} size={12} aria-hidden="true" />Notes
          <NotesContentIndicator text={notes} className={styles.amount} />
        </span>
      </summary>
      <div className={styles.body}>
        <button type="button" className={styles.heading} aria-label="Hide notes" onClick={() => onOpenChange(false)}>Notes<ChevronDown className={styles.headingChevron} size={12} aria-hidden="true" /></button>
        <NotesTextarea key={String(editing)} ref={editor => fitEditor(editor)} className={styles.editor} aria-label="Notes" value={notes} readOnly={readOnly || !onChange} rows={2}
          onInput={event => fitEditor(event.currentTarget)}
          onChange={value => onChange?.(value)} />
      </div>
    </details>}
    {footer && <div className={styles.footer}>{footer}</div>}
  </div>;
}
