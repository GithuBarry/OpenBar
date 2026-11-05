"use client";

import type { MindmapCaution } from "@/lib/mindmap/caution";

import styles from "./card-caution.module.css";

export function CardCaution({ caution }: { caution?: MindmapCaution }) {
  const visibleLevels = (["critical", "important"] as const).filter(level => caution?.[level]?.trim());
  return <>
    {visibleLevels.length > 0 && <div className={styles.visibleNotes}>
      {visibleLevels.map(level => <div key={level} role="note" className={styles.level} data-severity={level} aria-label={`${level === "critical" ? "Critical" : "Important"} note`}>
        {caution![level]}
      </div>)}
    </div>}
  </>;
}
