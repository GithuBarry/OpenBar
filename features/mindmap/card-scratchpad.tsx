"use client";

import styles from "./card-scratchpad.module.css";
import { ChevronDown, ChevronRight, Eye, Pencil, SquareArrowOutUpRight, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cardNotesText, hasNoteText, type MindmapCaution } from "@/lib/mindmap/caution";
import { looksLikeMarkdown } from "@/lib/mindmap/markdown-detect";
import { RichText } from "@/components/rich-text";
import { FastTooltip } from "@/components/fast-tooltip";
import { NotesTextarea } from "./notes-textarea";
import { NotesContentIndicator, notesContentDescription } from "./notes-content-indicator";
import { NotesViewerModal } from "./notes-viewer-modal";

function fitEditor(editor: HTMLTextAreaElement | null) {
  if (!editor) return;
  editor.style.height = "auto";
  editor.style.height = `${editor.scrollHeight}px`;
}

export function CardScratchpad({ open, onOpenChange, text, caution, cardTitle, editing = false, readOnly = false, onChange, onCommit, onCancel, onBlockedEdit, footer }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  text?: string;
  caution?: MindmapCaution;
  cardTitle?: string;
  editing?: boolean;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  onBlockedEdit?: () => void;
  footer?: ReactNode;
}) {
  const notes = useMemo(() => cardNotesText(text, caution), [text, caution]);
  const hasNotes = useMemo(() => hasNoteText(notes), [notes]);
  const isMarkdown = useMemo(() => looksLikeMarkdown(notes), [notes]);
  const showNotes = hasNotes || editing || open;
  const description = notesContentDescription(notes);
  const editable = !readOnly && Boolean(onChange);
  const [editingInline, setEditingInline] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) setEditingInline(false);
  }, [open]);

  useEffect(() => {
    if (open && editingInline && editorRef.current) {
      fitEditor(editorRef.current);
      editorRef.current.focus();
    }
  }, [open, editingInline]);

  const showRendered = hasNotes && !editing && !editingInline && (isMarkdown || !editable);

  if (!showNotes && !footer) return null;
  return <div className={`${styles.scratchpads} ${showNotes ? styles.withNotes : ""} nodrag nopan nowheel`}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing) return;
      if (editing) {
        if (event.key === "Escape") { event.preventDefault(); onCancel?.(); }
        if (!readOnly && event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); onCommit?.(); }
      } else if (editingInline && event.key === "Escape") {
        event.preventDefault();
        setEditingInline(false);
      }
    }}
    onWheel={event => event.stopPropagation()}>
    {showNotes && <details className={styles.scratchpad} open={open}
      onToggle={event => { onOpenChange(event.currentTarget.open); if (event.currentTarget.open) fitEditor(event.currentTarget.querySelector("textarea")); }}>
      <summary
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
        <span className={styles.tab}>
          <span className="ob-mod-swap" aria-hidden="true">
            <span className="ob-mod-primary"><ChevronRight className={styles.chevron} size={12} /></span>
            <span className="ob-mod-shift"><SquareArrowOutUpRight size={11} /></span>
            <span className="ob-mod-alt"><SquareArrowOutUpRight size={11} /></span>
          </span>Notes
          <NotesContentIndicator text={notes} className={styles.amount} />
        </span>
      </summary>
      <div className={styles.body}>
        <div className={styles.bodyHeader}>
          <button type="button" className={styles.heading} aria-label="Hide notes" onClick={() => onOpenChange(false)}><ChevronDown className={styles.headingChevron} size={12} aria-hidden="true" />Notes</button>
          <div className={styles.bodyActions}>
            {editable && !editing && isMarkdown && (
              <FastTooltip label={editingInline ? "Preview formatted notes" : "Edit notes"}>
                <button
                  type="button"
                  className={styles.bodyAction}
                  aria-label={editingInline ? "Preview formatted notes" : "Edit notes"}
                  onPointerDown={event => event.preventDefault()}
                  onClick={() => setEditingInline(current => !current)}
                >
                  {editingInline ? <Eye size={12} aria-hidden="true" /> : <Pencil size={11} aria-hidden="true" />}
                </button>
              </FastTooltip>
            )}
            <FastTooltip label="Pop out notes viewer">
              <button
                type="button"
                className={styles.bodyAction}
                aria-label="Pop out notes viewer"
                onClick={() => setViewerOpen(true)}
              >
                <SquareArrowOutUpRight size={11} aria-hidden="true" />
              </button>
            </FastTooltip>
            <FastTooltip label="Close notes">
              <button
                type="button"
                className={styles.bodyAction}
                aria-label="Close notes"
                onClick={() => onOpenChange(false)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </FastTooltip>
          </div>
        </div>
        {showRendered ? (
          <div
            className={isMarkdown ? styles.renderedMarkdown : styles.renderedPlain}
            onDoubleClick={editable ? () => setEditingInline(true) : readOnly ? () => onBlockedEdit?.() : undefined}
          >
            <RichText text={notes} format={isMarkdown ? "markdown" : "plain"} tableLayout="scroll" />
          </div>
        ) : (
          <NotesTextarea
            key={String(editing)}
            ref={editor => { editorRef.current = editor; fitEditor(editor); }}
            className={styles.editor}
            aria-label="Notes"
            value={notes}
            readOnly={!editable}
            rows={2}
            onBlur={() => { if (editingInline && isMarkdown) setEditingInline(false); }}
            onInput={event => fitEditor(event.currentTarget)}
            onChange={value => onChange?.(value)}
          />
        )}
      </div>
    </details>}
    {footer && <div className={styles.footer}>{footer}</div>}
    {viewerOpen && (
      <NotesViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        notes={notes}
        cardTitle={cardTitle}
        readOnly={readOnly}
        onChange={onChange}
      />
    )}
  </div>;
}
