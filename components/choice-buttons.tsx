"use client";

import { useId } from "react";
import styles from "./choice-buttons.module.css";

export function ChoiceButtons<T extends string | number>({ label, value, options, onChange, onClear, disabled = false }: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  onClear?: () => void;
  disabled?: boolean;
}) {
  const name = useId();
  return <div className={`p-segmented ${styles.group}`} role="radiogroup" aria-label={label}>
    {options.map((option) => <label key={option.value} className="p-segment">
      <input type="radio" name={name} checked={value === option.value} disabled={disabled}
        onClick={() => { if (value === option.value) onClear?.(); }}
        onChange={() => onChange(option.value)}
        onKeyDown={event => {
          if (event.key !== " " || !onClear) return;
          event.preventDefault();
          if (event.repeat) return;
          if (value === option.value) onClear();
          else onChange(option.value);
        }} />
      <span>{option.label}</span>
    </label>)}
  </div>;
}
