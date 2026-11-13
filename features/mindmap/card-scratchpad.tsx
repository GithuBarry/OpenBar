"use client";

import styles from "./card-scratchpad.module.css";
import { ChevronDown } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { cardNotesText, hasNoteText, type MindmapCaution } from "@/lib/mindmap/caution";
import { NotesTextarea } from "./notes-textarea";

const CONTENT_THRESHOLDS = [128, 512, 2048, 4096];

function fitEditor(editor: HTMLTextAreaElement | null) {
  if (!editor) return;
  editor.style.height = "auto";
  editor.style.height = `${editor.scrollHeight}px`;
}

export function CardScratchpad({ text, caution, editing = false, readOnly = false, onChange, onCommit, onCancel, footer }: {
  text?: string;
  caution?: MindmapCaution;
  editing?: boolean;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const notes = useMemo(() => cardNotesText(text, caution), [text, caution]);
  const hasNotes = useMemo(() => hasNoteText(notes), [notes]);
  const count = notes.length;
  const bars = CONTENT_THRESHOLDS.reduce((total, threshold) => total + Number(count > threshold), 0);
  const description = `${hasNotes ? "Has content" : "Empty"} · ${count} characters · ${bars} of 4 bars`;
  return <div className={`${styles.scratchpads} ${styles.withNotes} nodrag nopan`}
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
    <details className={styles.scratchpad} open={open}
      onToggle={event => { setOpen(event.currentTarget.open); if (event.currentTarget.open) fitEditor(event.currentTarget.querySelector("textarea")); }}>
      <summary aria-label={open ? "Hide notes" : "Show notes"} aria-expanded={open} aria-description={description} title={description}>
        <span className={styles.tab}>
          <ChevronDown className={styles.chevron} size={12} aria-hidden="true" />Notes
          <span className={styles.status}>{hasNotes ? "Has content" : "Empty"}</span>
          <svg className={styles.amount} width={15} height={12} viewBox="0 0 15 12" fill="currentColor" aria-hidden="true">
            {CONTENT_THRESHOLDS.map((threshold, index) => <rect key={threshold} x={index * 4} y={9 - index * 3} width={2.5} height={3 + index * 3} rx={0.7} opacity={count > threshold ? 1 : 0.2} />)}
          </svg>
        </span>
      </summary>
      <div className={styles.body}>
        <button type="button" className={styles.heading} aria-label="Hide notes" onClick={() => setOpen(false)}>Notes<ChevronDown className={styles.headingChevron} size={12} aria-hidden="true" /></button>
        <NotesTextarea key={String(editing)} ref={editor => fitEditor(editor)} className={styles.editor} aria-label="Notes" value={notes} readOnly={readOnly || !onChange} rows={2}
          onInput={event => fitEditor(event.currentTarget)}
          onChange={value => onChange?.(value)} />
      </div>
    </details>
    {footer && <div className={styles.footer}>{footer}</div>}
  </div>;
}
