"use client";

import styles from "./card-scratchpad.module.css";
import { ChevronRight } from "lucide-react";

export function CardScratchpad({ text, label, atCardEdge = false }: { text?: string; label?: string; atCardEdge?: boolean }) {
  if (!text?.trim()) return null;
  return <details className={`${styles.scratchpad} ${atCardEdge ? styles.edge : ""} nodrag nopan`}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()}
    onWheel={event => event.stopPropagation()}>
    <summary className={label ? styles.labeled : undefined} aria-label={label || "Additional notes"}><ChevronRight size={12} aria-hidden="true" />{label}</summary>
    <div className={styles.body}>{text}</div>
  </details>;
}
