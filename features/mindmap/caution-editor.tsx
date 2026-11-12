"use client";

import { useId } from "react";

import { CAUTION_LEVEL_LABELS, hasNoteText, type MindmapCaution } from "@/lib/mindmap/caution";
import { InspectorSummary } from "./inspector-summary";

export function CautionEditor({ value, caption, onChange, onCaptionChange }: {
  value?: MindmapCaution;
  caption?: string;
  onChange: (value: MindmapCaution) => void;
  onCaptionChange: (value: string) => void;
}) {
  const descriptionId = useId();
  const hasNotes = [caption, ...Object.values(value || {})].some(hasNoteText);
  return <details data-caution-editor>
    <InspectorSummary label="Notes" hasContent={hasNotes} />
    <div className="mt-3 space-y-3">
      <label className="mindmap-field">
        <span>Collapsed notes</span>
        <textarea value={caption || ""} aria-label="Collapsed notes" aria-describedby={`${descriptionId}-caption`}
          onChange={event => onCaptionChange(event.target.value)} />
        <small id={`${descriptionId}-caption`}>Opens through the card’s collapsed disclosure.</small>
      </label>
      <label className="mindmap-field">
        <span>{CAUTION_LEVEL_LABELS.background}</span>
        <textarea value={value?.background || ""} aria-label={CAUTION_LEVEL_LABELS.background} aria-describedby={`${descriptionId}-background`}
          onChange={event => onChange({ ...value, background: event.target.value })} />
        <small id={`${descriptionId}-background`}>Defensive explanations and scope notes. Collapsed in their own card section.</small>
      </label>
      <details>
        <summary className="cursor-pointer text-xs font-medium text-muted">Visible annotations</summary>
        {(["critical", "important"] as const).map(level => <div key={level} data-caution-level={level}>
        <label className="mindmap-field mt-2">
          <span className={level === "critical" ? "text-danger" : "text-warn"}>{CAUTION_LEVEL_LABELS[level]}</span>
          <textarea
            value={value?.[level] || ""}
            aria-label={`${CAUTION_LEVEL_LABELS[level]} caution notes`}
            aria-describedby={`${descriptionId}-${level}`}
            onChange={(event) => onChange({ ...value, [level]: event.target.value })}
          />
          <small id={`${descriptionId}-${level}`}>Displayed in the main card.</small>
        </label>
      </div>)}
      </details>
    </div>
  </details>;
}
