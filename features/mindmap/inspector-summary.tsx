"use client";

import { ChevronRight, Plus } from "lucide-react";
import styles from "./inspector-summary.module.css";

export function InspectorSummary({ label, hasContent }: { label: string; hasContent: boolean }) {
  return <summary className={styles.summary}>
    {hasContent ? <ChevronRight className={styles.triangle} size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
    {label}
  </summary>;
}
