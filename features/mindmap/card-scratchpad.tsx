"use client";

import styles from "./card-scratchpad.module.css";
import { ChevronRight } from "lucide-react";

export function CardScratchpad({ text, background }: { text?: string; background?: string }) {
  const notes = [
    { label: "Notes", text },
    { label: "Background notes", text: background },
  ].filter(note => note.text?.trim());
  if (!notes.length) return null;
  return <div className={`${styles.scratchpads} nodrag nopan`}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()}
    onWheel={event => event.stopPropagation()}>
    {notes.map(note => <details className={styles.scratchpad} key={note.label}>
      <summary aria-label={note.label}><span className={styles.tab}><ChevronRight size={12} aria-hidden="true" />{note.label}</span></summary>
      <div className={styles.body}>{note.text}</div>
    </details>)}
  </div>;
}
