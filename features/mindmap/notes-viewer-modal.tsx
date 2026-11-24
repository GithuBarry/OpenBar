"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Eye, Pencil, X } from "lucide-react";
import { Modal } from "@/components/modal";
import { RichText } from "@/components/rich-text";
import { FastTooltip } from "@/components/fast-tooltip";
import { looksLikeMarkdown } from "@/lib/mindmap/markdown-detect";
import { hasNoteText } from "@/lib/mindmap/caution";
import { NotesTextarea } from "./notes-textarea";
import styles from "./notes-viewer-modal.module.css";

export function NotesViewerModal({ open, onClose, notes, workingMentionAt, cardTitle, readOnly = false, onChange }: {
  open: boolean;
  onClose: () => void;
  notes: string;
  workingMentionAt?: number;
  cardTitle?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}) {
  const editable = !readOnly && Boolean(onChange);
  const hasNotes = hasNoteText(notes);
  const isMarkdown = useMemo(() => looksLikeMarkdown(notes), [notes]);
  const [editing, setEditing] = useState(() => !hasNotes && editable);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) {
      setEditing(false);
      setCopied(false);
    }
  }, [open]);

  useEffect(() => {
    if (open && editing) textareaRef.current?.focus();
  }, [open, editing]);

  useEffect(() => () => {
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
  }, []);

  async function copyNotes() {
    if (!notes) return;
    try {
      await navigator.clipboard.writeText(notes);
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard failures in restricted contexts.
    }
  }

  return (
    <Modal open={open} onClose={onClose} closeOnBackdropClick title={cardTitle ? `Notes for ${cardTitle}` : "Notes"} className={styles.viewer}>
      <div
        className={styles.shell}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()}
        onKeyDown={event => {
          event.stopPropagation();
          if (editing && (event.metaKey || event.ctrlKey) && event.key === "Enter" && hasNotes) {
            event.preventDefault();
            setEditing(false);
          }
        }}
        onWheel={event => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.heading}>
            <span className={styles.kicker}>Notes</span>
            {cardTitle && <span className={styles.title} title={cardTitle}>{cardTitle}</span>}
          </div>
          <div className={styles.actions}>
            {editable && (
              <FastTooltip label={editing ? "View notes (⌘Enter / Ctrl+Enter)" : "Edit notes"}>
                <button
                  type="button"
                  className={styles.modeButton}
                  aria-label={editing ? "View notes" : "Edit notes"}
                  onClick={() => setEditing(current => !current)}
                >
                  {editing ? <><Eye size={14} aria-hidden="true" /><span>Preview</span></> : <><Pencil size={13} aria-hidden="true" /><span>Edit</span></>}
                </button>
              </FastTooltip>
            )}
            {hasNotes && (
              <FastTooltip label={copied ? "Copied" : "Copy notes"}>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={copied ? "Copied notes" : "Copy notes"}
                  onClick={() => { void copyNotes(); }}
                >
                  {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
                </button>
              </FastTooltip>
            )}
            <FastTooltip label="Close notes viewer">
              <button type="button" className={styles.iconButton} aria-label="Close notes viewer" onClick={onClose}>
                <X size={17} aria-hidden="true" />
              </button>
            </FastTooltip>
          </div>
        </header>
        <div className={styles.body}>
          {editing && editable ? (
            <NotesTextarea
              ref={textareaRef}
              className={styles.editor}
              aria-label="Notes"
              value={notes}
              placeholder="Write notes… Markdown is rendered automatically in view mode."
              onChange={value => onChange?.(value)}
            />
          ) : hasNotes ? (
            <div
              className={isMarkdown ? styles.markdownBody : styles.plainBody}
              onDoubleClick={editable ? () => setEditing(true) : undefined}
            >
              <RichText text={notes} format={isMarkdown ? "markdown" : "plain"} tableLayout="scroll" workingMentionAt={workingMentionAt} />
            </div>
          ) : (
            <p className={styles.empty}>No notes yet.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
