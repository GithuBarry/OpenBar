"use client";

import { useId } from "react";
import { X } from "lucide-react";
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
    {options.map((option) => {
      const choice = <label className="p-segment">
      <input type="radio" name={name} checked={value === option.value} disabled={disabled} onChange={() => onChange(option.value)} />
      <span>{option.label}</span>
      </label>;
      return <span key={option.value} className={styles.choice}>
        {choice}
        {onClear && value === option.value && <button type="button" className={styles.clear} disabled={disabled} aria-label={`Clear ${label.toLowerCase()}`} onClick={onClear}><X size={10} aria-hidden="true" /></button>}
      </span>;
    })}
  </div>;
}
