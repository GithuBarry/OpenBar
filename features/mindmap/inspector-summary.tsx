"use client";

import { Plus } from "lucide-react";
import styles from "./inspector-summary.module.css";

export function InspectorSummary({ label, hasContent }: { label: string; hasContent: boolean }) {
  return <summary className={styles.summary}>
    {hasContent ? <svg className={styles.triangle} width={14} height={14} viewBox="0 0 14 14" aria-hidden="true"><path d="m4.5 2.5 4.5 4.5-4.5 4.5Z" fill="currentColor" /></svg> : <Plus size={14} aria-hidden="true" />}
    {label}
  </summary>;
}
