"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useRef, useState } from "react";

import { AnchoredPop } from "@/components/pop";

export type PaperReaderFont = "serif" | "sans";
export type PaperEditorWidth = "compact" | "wide" | "full";

const FONT_SCALE_OPTIONS = [
  { value: 0.8, label: "80%" },
  { value: 0.9, label: "90%" },
  { value: 1, label: "100%" },
  { value: 1.1, label: "110%" },
  { value: 1.2, label: "120%" },
] as const;

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
        <label className="ob-paper-appearance-row">
          <span>Text size</span>
          <select
            value={String(readerFontScale)}
            aria-label="Reader text size"
            onChange={(event) => onReaderFontScaleChange(Number(event.target.value))}
          >
            {FONT_SCALE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="ob-paper-appearance-row">
          <span>Line spacing</span>
          <select
            value={String(lineHeight)}
            aria-label="Reader line spacing"
            onChange={(event) => onLineHeightChange(Number(event.target.value))}
          >
            {LINE_HEIGHT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className="ob-paper-appearance-row">
          <span>Typeface</span>
          <select value={font} aria-label="Reader typeface" onChange={(event) => onFontChange(event.target.value as PaperReaderFont)}>
            <option value="serif">Serif</option>
            <option value="sans">Sans</option>
          </select>
        </label>
        <p className="ob-paper-appearance-section">Editor</p>
        <label className="ob-paper-appearance-row">
          <span>Text size</span>
          <select
            value={String(editorFontScale)}
            aria-label="Editor text size"
            onChange={(event) => onEditorFontScaleChange(Number(event.target.value))}
          >
            {FONT_SCALE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <p className="ob-paper-appearance-section">Layout</p>
        <label className="ob-paper-appearance-row">
          <span>Workspace width</span>
          <select
            value={width}
            aria-label="Workspace width"
            onChange={(event) => onWidthChange(event.target.value as PaperEditorWidth)}
          >
            {WIDTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <p className="ob-paper-appearance-help">Saved for this project on this device.</p>
      </AnchoredPop>
    </div>
  );
}
