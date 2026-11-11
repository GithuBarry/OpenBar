"use client";

import { useState } from "react";
import { Select } from "@/components/select";
import { commentKindAppearance, commentKindValidationError, DEFAULT_COMMENT_KINDS } from "@/lib/comment-kinds";

export function CommentKindPicker({ value, onChange, kinds }: {
  value: string;
  onChange: (value: string) => void;
  kinds: string[];
}) {
  const [custom, setCustom] = useState(false);
  const [customDraft, setCustomDraft] = useState(value);
  const appearance = commentKindAppearance(value);
  const error = custom ? commentKindValidationError(customDraft) : null;
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
          if (next === "custom") setCustomDraft(value);
          else {
            const nextValue = options[Number(next)].value;
            if (!commentKindValidationError(nextValue)) onChange(nextValue);
          }
        }}
        options={[...options.map((item, index) => ({ value: String(index), label: item.label, disabled: !!commentKindValidationError(item.value) })), { value: "custom", label: "Custom type…" }]}
      />
      {custom && <input
        autoFocus
        aria-label="Custom comment type"
        placeholder="Type name"
        maxLength={80}
        value={customDraft}
        aria-invalid={!!error}
        onChange={(event) => {
          const next = event.target.value;
          setCustomDraft(next);
          if (!commentKindValidationError(next)) onChange(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && customDraft.trim() && !error) {
            event.preventDefault();
            onChange(customDraft.trim());
            setCustom(false);
          }
        }}
      />}
      {error && <span role="alert" className="ob-comment-kind-error" style={{ color: "rgb(var(--warn-text))", fontSize: 12 }}>{error}</span>}
    </div>
  );
}
