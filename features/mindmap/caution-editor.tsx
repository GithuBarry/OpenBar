"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cardNotesText, type MindmapCaution } from "@/lib/mindmap/caution";
import { NotesTextarea } from "./notes-textarea";
import { NotesContentIndicator, notesContentDescription } from "./notes-content-indicator";
import styles from "./caution-editor.module.css";

export function CautionEditor({ value, caption, onNotesChange }: {
  value?: MindmapCaution;
  caption?: string;
  onNotesChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const notes = cardNotesText(caption, value);
  const description = notesContentDescription(notes);
  return <details data-caution-editor open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className={styles.summary} aria-label={open ? "Hide notes" : "Show notes"} aria-expanded={open} aria-description={description} title={description}>
      <ChevronDown className={styles.chevron} size={14} aria-hidden="true" />Notes
      <NotesContentIndicator text={notes} className={styles.amount} />
    </summary>
    <NotesTextarea className={styles.editor} aria-label="Notes" value={notes} rows={4} onChange={onNotesChange} />
  </details>;
}
