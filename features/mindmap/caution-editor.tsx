"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cardNotesText, hasNoteText, type MindmapCaution } from "@/lib/mindmap/caution";
import { NotesTextarea } from "./notes-textarea";
import styles from "./caution-editor.module.css";

export function CautionEditor({ value, caption, onNotesChange }: {
  value?: MindmapCaution;
  caption?: string;
  onNotesChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const notes = cardNotesText(caption, value);
  const hasNotes = hasNoteText(notes);
  return <details data-caution-editor open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className={styles.summary} aria-label={open ? "Hide notes" : "Show notes"} aria-expanded={open}>
      <ChevronDown size={14} aria-hidden="true" />Notes
      <small>{hasNotes ? "Has content" : "Empty"}</small>
    </summary>
    <NotesTextarea className={styles.editor} aria-label="Notes" value={notes} rows={4} onChange={onNotesChange} />
  </details>;
}
