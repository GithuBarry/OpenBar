"use client";

import { useLayoutEffect, useRef, useState, type ComponentProps } from "react";

/** Keep the active input stable while saved Notes are combined for display. */
export function NotesTextarea({ value, onChange, ...props }: Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const composing = useRef(false);
  useLayoutEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  return <textarea {...props} value={draft}
    onFocus={event => { focused.current = true; setDraft(value); props.onFocus?.(event); }}
    onBlur={event => { focused.current = false; setDraft(value); props.onBlur?.(event); }}
    onCompositionStart={event => { composing.current = true; props.onCompositionStart?.(event); }}
    onCompositionEnd={event => { composing.current = false; props.onCompositionEnd?.(event); }}
    onKeyDown={event => { if (composing.current) event.stopPropagation(); props.onKeyDown?.(event); }}
    onChange={event => { const text = event.currentTarget.value; setDraft(text); onChange(text); }} />;
}
