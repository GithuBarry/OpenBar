"use client";

import { useState } from "react";
import { ChevronRight, Maximize2 } from "lucide-react";
import { cardNotesText, hasNoteText, type MindmapCaution } from "@/lib/mindmap/caution";
import { FastTooltip } from "@/components/fast-tooltip";
import { NotesTextarea } from "./notes-textarea";
import { NotesContentIndicator, notesContentDescription } from "./notes-content-indicator";
import { NotesViewerModal } from "./notes-viewer-modal";
import styles from "./caution-editor.module.css";

export function CautionEditor({ value, caption, cardTitle, readOnly = false, onNotesChange }: {
  value?: MindmapCaution;
  caption?: string;
  cardTitle?: string;
  readOnly?: boolean;
  onNotesChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const notes = cardNotesText(caption, value);
  const hasNotes = hasNoteText(notes);
  const description = notesContentDescription(notes);
  return <div className={styles.wrap}>
    <details data-caution-editor open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary
        className={styles.summary}
        aria-label={open ? "Hide notes" : "Show notes"}
        aria-expanded={open}
        aria-description={description}
        title={hasNotes ? `${description} (⇧-click to open viewer)` : description}
        onClick={event => {
          if (event.shiftKey || event.altKey) {
            event.preventDefault();
            setViewerOpen(true);
          }
        }}>
        <span className="ob-mod-swap" aria-hidden="true">
          <span className="ob-mod-primary"><ChevronRight className={styles.chevron} size={14} /></span>
          <span className="ob-mod-shift"><Maximize2 size={12} /></span>
          <span className="ob-mod-alt"><Maximize2 size={12} /></span>
        </span>Notes
        <NotesContentIndicator text={notes} className={styles.amount} />
      </summary>
      <NotesTextarea className={styles.editor} aria-label="Notes" value={notes} rows={4} readOnly={readOnly} onChange={onNotesChange} />
    </details>
    {(hasNotes || open) && (
      <FastTooltip label="Open notes in viewer">
        <button type="button" className={styles.expand} aria-label="Open notes in viewer" onClick={() => setViewerOpen(true)}>
          <Maximize2 size={13} aria-hidden="true" />
        </button>
      </FastTooltip>
    )}
    {viewerOpen && (
      <NotesViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        notes={notes}
        cardTitle={cardTitle}
        readOnly={readOnly}
        onChange={onNotesChange}
      />
    )}
  </div>;
}
