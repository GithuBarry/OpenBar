"use client";

import { useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { MessageSquare } from "lucide-react";
import { FastTooltip } from "@/components/fast-tooltip";
import { PopoverSurface } from "@/components/pop";

export function RequestRevision({ nodeId, onRequest }: {
  nodeId: string;
  onRequest: (note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const text = comment.trim().replace(/^@agent\b\s*/i, "").trim();

  async function addMention() {
    if (!text || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      await onRequest(`@agent ${text}`);
      setComment("");
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the mention on this card.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return <Popover.Root open={open} onOpenChange={next => {
    if (pending.current) return;
    setOpen(next);
  }}>
    <FastTooltip label="Revise"><Popover.Trigger asChild>
      <button type="button" aria-label="Revise draft" className="[@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:min-h-11">
        <MessageSquare size={13} aria-hidden="true" />
      </button>
    </Popover.Trigger></FastTooltip>
    <PopoverSurface side="bottom" align="end" aria-label="Request a draft revision" data-mind-editor={nodeId}
      className="w-72 max-w-[calc(100vw-24px)] p-3 nodrag nopan nowheel"
      onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void addMention(); }}
        onKeyDown={event => {
          if (event.key === "Escape") return;
          event.stopPropagation();
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void addMention();
          }
        }}>
        <label className="grid gap-2 text-sm font-semibold">Add an @agent comment to this card
          <textarea className="w-full rounded-md border p-2 text-sm font-normal" rows={3} value={comment}
            readOnly={saving} onChange={event => setComment(event.target.value)} />
        </label>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Popover.Close asChild><button type="button" className="p-button p-button-borderless" disabled={saving}>Cancel</button></Popover.Close>
          <button type="submit" className="p-button p-button-primary" disabled={saving || !text}>{saving ? "Saving…" : "Add to card"}</button>
        </div>
      </form>
    </PopoverSurface>
  </Popover.Root>;
}
