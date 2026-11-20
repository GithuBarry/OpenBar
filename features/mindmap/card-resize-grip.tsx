"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { MIN_CARD_WIDTH, MAX_CARD_WIDTH, normalizeCardWidth } from "@/lib/mindmap/card-width";
import styles from "./card-resize-grip.module.css";

type Drag = { pointerId: number; startX: number; startWidth: number; scale: number; width: number };

export function CardResizeGrip({ width, onPreview, onCommit }: {
  width: number;
  onPreview: (width: number | undefined) => void;
  onCommit: (width: number | undefined) => void;
}) {
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const latest = useRef({ onPreview, onCommit });
  latest.current = { onPreview, onCommit };
  const [resizing, setResizing] = useState(false);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  function finish(button: HTMLButtonElement, commit: boolean) {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    if (button.hasPointerCapture(current.pointerId)) button.releasePointerCapture(current.pointerId);
    setResizing(false);
    if (commit && current.width !== current.startWidth) latest.current.onCommit(current.width);
    else latest.current.onPreview(undefined);
  }

  function begin(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    const card = event.currentTarget.closest<HTMLElement>("[data-mind-node]");
    if (!card) return;
    const bounds = card.getBoundingClientRect();
    const startWidth = Math.round(card.offsetWidth);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth, width: startWidth, scale: bounds.width / startWidth || 1 };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    setResizing(true);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    current.width = normalizeCardWidth(current.startWidth + (event.clientX - current.startX) / current.scale)!;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (drag.current) latest.current.onPreview(drag.current.width);
    });
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (event.key === "Escape" && drag.current) { event.preventDefault(); finish(event.currentTarget, false); return; }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      latest.current.onCommit(undefined);
      return;
    }
    const step = event.shiftKey ? 64 : 16;
    const next = event.key === "ArrowLeft" ? width - step : event.key === "ArrowRight" ? width + step
      : event.key === "Home" ? MIN_CARD_WIDTH : event.key === "End" ? MAX_CARD_WIDTH : undefined;
    if (next === undefined) return;
    event.preventDefault();
    latest.current.onCommit(normalizeCardWidth(next));
  }

  return <button type="button" className={`${styles.grip} nodrag nopan`} role="slider"
    aria-label="Card width" aria-orientation="horizontal" aria-valuemin={MIN_CARD_WIDTH} aria-valuemax={MAX_CARD_WIDTH}
    aria-valuenow={Math.round(width)} aria-valuetext={`${Math.round(width)} pixels wide. Height follows the content.`}
    aria-keyshortcuts="ArrowLeft ArrowRight Home End Delete Backspace"
    title="Drag to resize card width. Double-click or press Delete for automatic width."
    data-resizing={resizing || undefined}
    onPointerDown={begin} onPointerMove={move}
    onPointerUp={event => { event.stopPropagation(); finish(event.currentTarget, true); }}
    onPointerCancel={event => finish(event.currentTarget, false)}
    onLostPointerCapture={event => finish(event.currentTarget, false)}
    onKeyDown={keyDown} onClick={event => event.stopPropagation()}
    onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); latest.current.onCommit(undefined); }}>
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M16.33 7A11.5 11.5 0 0 1 7 16.33" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
  </button>;
}
