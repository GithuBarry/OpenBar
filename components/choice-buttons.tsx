"use client";

import styles from "./choice-buttons.module.css";

export function ChoiceButtons<T extends string | number>({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return <div className={styles.group} role="group" aria-label={label}>
    {options.map((option) => <button key={option.value} type="button" disabled={disabled} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}
