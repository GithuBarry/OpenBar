"use client";

import { useId } from "react";

import { CAUTION_LEVELS, CAUTION_LEVEL_LABELS, type CautionLevel, type MindmapCaution } from "@/lib/mindmap/caution";

const descriptions: Record<CautionLevel, string> = {
  critical: "Could change the central conclusion or require a different action.",
  important: "Affects interpretation or the next step.",
  minor: "Applies to a narrow edge case.",
  background: "Generic qualifications or precautionary commentary.",
};

export function CautionEditor({ value, onChange }: {
  value?: MindmapCaution;
  onChange: (value: MindmapCaution) => void;
}) {
  const descriptionId = useId();
  return <details data-caution-editor>
    <summary className="cursor-pointer text-xs font-medium text-muted">Caution notes</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted">Critical and important notes use a colored hover icon. Minor and background notes stay in these settings.</p>
      {CAUTION_LEVELS.map((level) => <details key={level} data-caution-level={level}>
        <summary className={`cursor-pointer text-xs font-medium ${level === "critical" ? "text-danger" : level === "important" ? "text-warn" : "text-muted"}`}>{CAUTION_LEVEL_LABELS[level]}</summary>
        <label className="mindmap-field mt-2">
          <textarea
            value={value?.[level] || ""}
            aria-label={`${CAUTION_LEVEL_LABELS[level]} caution notes`}
            aria-describedby={`${descriptionId}-${level}`}
            onChange={(event) => onChange({ ...value, [level]: event.target.value })}
          />
          <small id={`${descriptionId}-${level}`}>{descriptions[level]}</small>
        </label>
      </details>)}
    </div>
  </details>;
}
