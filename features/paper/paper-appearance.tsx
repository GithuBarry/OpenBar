"use client";

import { RotateCcw } from "lucide-react";
import { useRef, useState } from "react";

import { ChoiceButtons } from "@/components/choice-buttons";
import { FastTooltip } from "@/components/fast-tooltip";
import { AnchoredPop } from "@/components/pop";

export type PaperReaderFont = "serif" | "sans";
export type PaperEditorWidth = "compact" | "wide" | "full";
export type PaperGlass = number;
export type PaperToolbarPosition = "top" | "bottom";

function TextSizeSlider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const size = Number(value.toFixed(1));
  return <label className="flex min-w-0 flex-1 items-center gap-3">
    <input type="range" min={10} max={24} step={1} value={size} aria-label={label} aria-valuetext={`${size} pixels`}
      className="min-w-0 flex-1 cursor-pointer accent-accent" onChange={(event) => onChange(Number(event.target.value))} />
    <output className="w-12 shrink-0 text-right text-xs tabular-nums">{size} px</output>
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
  glass,
  toolbarPosition,
  onReaderFontScaleChange,
  onEditorFontScaleChange,
  onLineHeightChange,
  onFontChange,
  onWidthChange,
  onGlassChange,
  onToolbarPositionChange,
  onReset,
}: {
  readerFontScale: number;
  editorFontScale: number;
  lineHeight: number;
  font: PaperReaderFont;
  width: PaperEditorWidth;
  glass: PaperGlass;
  toolbarPosition: PaperToolbarPosition;
  onReaderFontScaleChange: (value: number) => void;
  onEditorFontScaleChange: (value: number) => void;
  onLineHeightChange: (value: number) => void;
  onFontChange: (value: PaperReaderFont) => void;
  onWidthChange: (value: PaperEditorWidth) => void;
  onGlassChange: (value: PaperGlass) => void;
  onToolbarPositionChange: (value: PaperToolbarPosition) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="relative shrink-0">
      <FastTooltip label="Appearance">
      <button
        ref={anchorRef}
        type="button"
        className="p-button p-button-glass ob-glass-button"
        aria-label="Appearance"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {/* Google Material Symbols Outlined, palette. Apache 2.0: licenses/google-material-symbols-Apache-2.0.txt. */}
        <svg aria-hidden="true" focusable="false" width={15} height={15} viewBox="0 -960 960 960" style={{ fill: "currentColor" }}>
          <path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 32.5-156t88-127Q256-817 330-848.5T488-880q80 0 151 27.5t124.5 76q53.5 48.5 85 115T880-518q0 115-70 176.5T640-280h-74q-9 0-12.5 5t-3.5 11q0 12 15 34.5t15 51.5q0 50-27.5 74T480-80Zm0-400Zm-220 40q26 0 43-17t17-43q0-26-17-43t-43-17q-26 0-43 17t-17 43q0 26 17 43t43 17Zm120-160q26 0 43-17t17-43q0-26-17-43t-43-17q-26 0-43 17t-17 43q0 26 17 43t43 17Zm200 0q26 0 43-17t17-43q0-26-17-43t-43-17q-26 0-43 17t-17 43q0 26 17 43t43 17Zm120 160q26 0 43-17t17-43q0-26-17-43t-43-17q-26 0-43 17t-17 43q0 26 17 43t43 17ZM480-160q9 0 14.5-5t5.5-13q0-14-15-33t-15-57q0-42 29-67t71-25h70q66 0 113-38.5T800-518q0-121-92.5-201.5T488-800q-136 0-232 93t-96 227q0 133 93.5 226.5T480-160Z" />
        </svg>
        <span className="sr-only">Appearance</span>
      </button>
      </FastTooltip>
      <AnchoredPop
        open={open}
        anchorRef={anchorRef}
        origin="br"
        onDismiss={() => setOpen(false)}
        className="ob-paper-appearance-pop"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">Appearance</p>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-ink"
            onClick={onReset}
            title="Reset appearance"
          >
            <RotateCcw size={10} /> Reset
          </button>
        </div>
        <div className="ob-paper-appearance-columns">
        <section aria-label="Reader appearance">
        <h3 className="ob-paper-appearance-section">Reader</h3>
        <div className="ob-paper-appearance-row">
          <span>Font size</span>
          <TextSizeSlider label="Reader text size" value={readerFontScale * 17} onChange={(value) => onReaderFontScaleChange(value / 17)} />
        </div>
        <div className="ob-paper-appearance-row">
          <span>Line spacing</span>
          <ChoiceButtons label="Reader line spacing" value={lineHeight} options={LINE_HEIGHT_OPTIONS} onChange={onLineHeightChange} />
        </div>
        <div className="ob-paper-appearance-row">
          <span>Typeface</span>
          <ChoiceButtons label="Reader typeface" value={font} options={[{value: "serif" as const, label: "Serif"}, {value: "sans" as const, label: "Sans"}]} onChange={onFontChange} />
        </div>
        </section>
        <section aria-label="Editor appearance">
        <h3 className="ob-paper-appearance-section">Editor</h3>
        <div className="ob-paper-appearance-row">
          <span>Font size</span>
          <TextSizeSlider label="Editor text size" value={editorFontScale * 14} onChange={(value) => onEditorFontScaleChange(value / 14)} />
        </div>
        </section>
        </div>
        <section className="ob-paper-appearance-shared" aria-label="Shared appearance">
        <h3 className="ob-paper-appearance-section">Shared layout</h3>
        <div className="ob-paper-appearance-row">
          <span>Workspace width</span>
          <ChoiceButtons label="Workspace width" value={width} options={WIDTH_OPTIONS} onChange={onWidthChange} />
        </div>
        <div className="ob-paper-appearance-row">
          <span>Desktop toolbar position</span>
          <ChoiceButtons label="Desktop toolbar position" value={toolbarPosition} options={[{value: "top" as const, label: "Top"}, {value: "bottom" as const, label: "Bottom"}]} onChange={onToolbarPositionChange} />
        </div>
        <div className="ob-paper-appearance-row">
          <span>Toolbar glass</span>
          <label className="flex min-w-0 items-center gap-3">
            <input type="range" min={0} max={100} step={1} value={glass} aria-label="Toolbar glass strength" aria-valuetext={`${glass}% glass strength`}
              className="min-w-0 flex-1 cursor-pointer accent-accent" onChange={(event) => onGlassChange(Number(event.target.value))} />
            <output className="w-12 shrink-0 text-right text-xs tabular-nums">{glass}%</output>
          </label>
          <div className="flex justify-between text-xs text-muted"><span>Less glass</span><span>More glass</span></div>
        </div>
        </section>
        <p className="ob-paper-appearance-help">Saved across projects on this device.</p>
      </AnchoredPop>
    </div>
  );
}
