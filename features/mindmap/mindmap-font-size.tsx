"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AArrowDown, AArrowUp, RotateCcw, SlidersHorizontal } from "lucide-react";

import { ChoiceButtons } from "@/components/choice-buttons";
import { FastTooltip } from "@/components/fast-tooltip";
import { AnchoredPop } from "@/components/pop";
import { DEFAULT_MINDMAP_FONT_SIZE } from "@/lib/mindmap/mindmap";
import type { MindmapCardWidthMode } from "@/lib/types";
import styles from "./mindmap-font-size.module.css";

const MIN_SIZE = 10;
const MAX_SIZE = 20;
const DEFAULT_SIZE = DEFAULT_MINDMAP_FONT_SIZE;
const PRESETS = [
  { value: 10, label: "Compact" },
  { value: DEFAULT_SIZE, label: "Standard" },
  { value: 16, label: "Large" },
] as const;

const WIDTH_OPTIONS = [
  { value: "individual", label: "Individual" },
  { value: "siblings", label: "Siblings" },
  { value: "depth", label: "Same depth" },
] as const;

type SizeControlProps = {
  widthMode: MindmapCardWidthMode;
  onWidthModeChange: (mode: MindmapCardWidthMode) => void;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onPreview?: (value: number | null) => void;
  children?: ReactNode;
};
const clampSize = (value: number) => Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(value)));

export function MindmapFontSize(props: SizeControlProps) {
  const { value, onPreview } = props;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return <div className={styles.control}>
    <FastTooltip label="Mindmap appearance">
      <button ref={anchor} type="button" className={`p-button p-button-glass ob-glass-button ${styles.trigger}`} aria-label="Mindmap appearance" aria-expanded={open} onClick={() => setOpen(current => !current)}>
        <SlidersHorizontal size={15} /><span>{value} px</span>
      </button>
    </FastTooltip>
    <AnchoredPop open={open} anchorRef={anchor} onDismiss={() => { onPreview?.(null); setOpen(false); }} className={styles.popover}>
      <MindmapFontSizeSlider {...props} />
    </AnchoredPop>
  </div>;
}

export function MindmapFontSizeSlider({ value, disabled = false, onChange, onPreview, widthMode, onWidthModeChange, children }: SizeControlProps) {
  const [draft, setDraft] = useState(String(value));
  const currentValue = useRef(value);
  useEffect(() => {
    currentValue.current = value;
    setDraft(String(value));
  }, [value]);

  const update = (next: number) => {
    if (disabled || !Number.isFinite(next)) return;
    const size = clampSize(next);
    setDraft(String(size));
    onPreview?.(null);
    if (size !== currentValue.current) {
      currentValue.current = size;
      onChange(size);
    }
  };
  const parsed = draft.trim() ? Number(draft) : NaN;
  const size = Number.isFinite(parsed) ? clampSize(parsed) : value;
  const step = (direction: number) => update(size + direction);

  return <section className={styles.appearance} aria-label="Mindmap appearance settings">
    <div className={styles.heading}>
      <h3>Card text</h3>
      <button type="button" disabled={disabled || size === DEFAULT_SIZE} onClick={() => update(DEFAULT_SIZE)} aria-label="Reset card text size"><RotateCcw size={12} />Reset</button>
    </div>
    <div className={styles.sizeRow} role="group" aria-label="Mindmap card text size">
      <button type="button" disabled={disabled || size <= MIN_SIZE} aria-label="Decrease card text size" onClick={() => step(-1)}><AArrowDown size={17} /></button>
      <label className={styles.value}>
        <input type="text" inputMode="numeric" role="spinbutton" aria-label="Card text size in pixels" aria-valuemin={MIN_SIZE} aria-valuemax={MAX_SIZE} aria-valuenow={size} aria-valuetext={`${size} pixels`}
          disabled={disabled} value={draft} onFocus={event => event.currentTarget.select()}
          onChange={event => {
            const text = event.currentTarget.value;
            setDraft(text);
            if (/^\d+$/.test(text) && Number(text) >= MIN_SIZE && Number(text) <= MAX_SIZE) update(Number(text));
          }}
          onBlur={event => {
            const text = event.currentTarget.value.trim();
            if (text && Number.isFinite(Number(text))) update(Number(text));
            else setDraft(String(currentValue.current));
          }}
          onKeyDown={event => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              step(event.key === "ArrowUp" ? 1 : -1);
            } else if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.currentTarget.value = String(currentValue.current);
              setDraft(String(currentValue.current));
            }
          }} />
        <span aria-hidden="true">px</span>
      </label>
      <button type="button" disabled={disabled || size >= MAX_SIZE} aria-label="Increase card text size" onClick={() => step(1)}><AArrowUp size={17} /></button>
      <input className={styles.slider} type="range" min={MIN_SIZE} max={MAX_SIZE} step={1} value={size} disabled={disabled} aria-label="Card text size" aria-valuetext={`${size} pixels`}
        onChange={event => {
          const next = clampSize(Number(event.currentTarget.value));
          setDraft(String(next));
          onPreview?.(next);
        }}
        onPointerUp={event => update(Number(event.currentTarget.value))}
        onPointerCancel={event => { event.currentTarget.value = String(currentValue.current); setDraft(String(currentValue.current)); onPreview?.(null); }}
        onBlur={event => update(Number(event.currentTarget.value))}
        onKeyUp={event => { if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) update(Number(event.currentTarget.value)); }} />
    </div>
    <ChoiceButtons label="Card text size presets" value={size} options={PRESETS} onChange={update} disabled={disabled} />
    <div className={styles.heading}><h3>Card width</h3></div>
    <ChoiceButtons label="Card width" value={widthMode} options={WIDTH_OPTIONS} onChange={onWidthModeChange} disabled={disabled} />
    {children && <div className={styles.extras}>{children}</div>}
  </section>;
}
