"use client";

import { useState } from "react";
import { Select } from "@/components/select";
import { commentKindAppearance, DEFAULT_COMMENT_KINDS } from "@/lib/comment-kinds";

export function CommentKindPicker({ value, onChange, kinds }: {
  value: string;
  onChange: (value: string) => void;
  kinds: string[];
}) {
  const [custom, setCustom] = useState(false);
  const appearance = commentKindAppearance(value);
  const options = [...DEFAULT_COMMENT_KINDS.map((item) => ({ value: item.value as string, label: item.label as string }))];
  for (const kind of [...kinds, value]) {
    const trimmed = kind.trim();
    if (trimmed && !options.some((item) => item.value.toLowerCase() === trimmed.toLowerCase())) {
      options.push({ value: trimmed, label: trimmed });
    }
  }
  const selected = Math.max(0, options.findIndex((item) => item.value.toLowerCase() === value.trim().toLowerCase()));
  return (
    <div className={`ob-comment-kind-picker ob-comment-tone-${appearance.tone}`}>
      <span aria-hidden="true" className="ob-comment-kind-dot" />
      <Select
        label="Comment type"
        value={custom ? "custom" : String(selected)}
        onValueChange={(next) => {
          setCustom(next === "custom");
          if (next !== "custom") onChange(options[Number(next)].value);
        }}
        options={[...options.map((item, index) => ({ value: String(index), label: item.label })), { value: "custom", label: "Custom type…" }]}
      />
      {custom && <input
        autoFocus
        aria-label="Custom comment type"
        placeholder="Type name"
        maxLength={80}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && value.trim()) {
            event.preventDefault();
            onChange(value.trim());
            setCustom(false);
          }
        }}
      />}
    </div>
  );
}
