"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useRef, useState } from "react";

import { ChoiceButtons } from "@/components/choice-buttons";
import { AnchoredPop } from "@/components/pop";

export type PaperReaderFont = "serif" | "sans";
export type PaperEditorWidth = "compact" | "wide" | "full";

function TextSizeSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const percent = Math.round(value * 100);
  return <label className="flex min-w-0 flex-1 items-center gap-3">
    <input type="range" min={80} max={150} step={1} value={percent} aria-label={label} aria-valuetext={`${percent}%`}
      className="min-w-0 flex-1 cursor-pointer accent-accent" onChange={(event) => onChange(Number(event.target.value) / 100)} />
    <output className="w-10 shrink-0 text-right text-[11px] tabular-nums">{percent}%</output>
  </label>;
}

const LINE_HEIGHT_OPTIONS = [
  { value: 1.45, label: "Compact" },
  { value: 1.75, label: "Comfortable" },
  { value: 1.85, label: "Relaxed" },
] as const;

const WIDTH_OPTIONS = [
  { value: "compact", label: "Compact" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full" },
] as const satisfies ReadonlyArray<{ value: PaperEditorWidth; label: string }>;

export function PaperAppearance({
  readerFontScale,
  editorFontScale,
  lineHeight,
  font,
  width,
  onReaderFontScaleChange,
  onEditorFontScaleChange,
  onLineHeightChange,
  onFontChange,
  onWidthChange,
  onReset,
}: {
  readerFontScale: number;
  editorFontScale: number;
  lineHeight: number;
  font: PaperReaderFont;
  width: PaperEditorWidth;
  onReaderFontScaleChange: (value: number) => void;
  onEditorFontScaleChange: (value: number) => void;
  onLineHeightChange: (value: number) => void;
  onFontChange: (value: PaperReaderFont) => void;
  onWidthChange: (value: PaperEditorWidth) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative shrink-0">
      <button
        ref={anchorRef}
        type="button"
        className="ob-press inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted hover:bg-surface-2 hover:text-ink"
        title="Appearance"
        aria-label="Appearance"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <SlidersHorizontal size={12} />
        <span className="hidden sm:inline">Appearance</span>
      </button>
      <AnchoredPop
        open={open}
        anchorRef={anchorRef}
        origin="br"
        onDismiss={() => setOpen(false)}
        className="ob-paper-appearance-pop"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-ink">Appearance</p>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted hover:bg-surface-2 hover:text-ink"
            onClick={onReset}
            title="Reset appearance"
          >
            <RotateCcw size={10} /> Reset
          </button>
        </div>
        <p className="ob-paper-appearance-section">Reader</p>
        <div className="ob-paper-appearance-row">
          <span>Text size</span>
          <TextSizeSlider label="Reader text size" value={readerFontScale / 0.9} onChange={(value) => onReaderFontScaleChange(Number((value * 0.9).toFixed(3)))} />
        </div>
        <div className="ob-paper-appearance-row">
          <span>Line spacing</span>
          <ChoiceButtons label="Reader line spacing" value={lineHeight} options={LINE_HEIGHT_OPTIONS} onChange={onLineHeightChange} />
        </div>
        <div className="ob-paper-appearance-row">
          <span>Typeface</span>
          <ChoiceButtons label="Reader typeface" value={font} options={[{value: "serif" as const, label: "Serif"}, {value: "sans" as const, label: "Sans"}]} onChange={onFontChange} />
        </div>
        <p className="ob-paper-appearance-section">Editor</p>
        <div className="ob-paper-appearance-row">
          <span>Text size</span>
          <TextSizeSlider label="Editor text size" value={editorFontScale} onChange={onEditorFontScaleChange} />
        </div>
        <p className="ob-paper-appearance-section">Layout</p>
        <div className="ob-paper-appearance-row">
          <span>Workspace width</span>
          <ChoiceButtons label="Workspace width" value={width} options={WIDTH_OPTIONS} onChange={onWidthChange} />
        </div>
        <p className="ob-paper-appearance-help">Saved for this project on this device.</p>
      </AnchoredPop>
    </div>
  );
}
