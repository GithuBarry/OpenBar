"use client";

import { useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { MessageSquare, Sparkles } from "lucide-react";
import { FastTooltip } from "@/components/fast-tooltip";
import { PopoverSurface } from "@/components/pop";
import styles from "./mindmap-editor.module.css";

export function RequestRevision({ nodeId, disabled = false, mode = "draft", onRequest }: {
  nodeId: string;
  disabled?: boolean;
  mode?: "draft" | "card";
  onRequest: (note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [fastTrack, setFastTrack] = useState(false);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const text = comment.trim().replace(/^@(?:agent|stat)\b\s*/i, "").trim();
  const handle = fastTrack ? "@stat" : "@agent";

  async function addMention() {
    if (!text || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      await onRequest(`${handle} ${text}`);
      setComment("");
      setFastTrack(false);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the mention on this card.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return <Popover.Root open={open} onOpenChange={next => {
    if (pending.current || disabled) return;
    setOpen(next);
  }}>
    <FastTooltip label={disabled ? "AI draft" : mode === "draft" ? "Ask AI to revise (@agent)\n⌥-click to fast-track (@stat)" : "Ask AI to revise (@agent)\n⌥-click to fast-track (@stat)"}><Popover.Trigger asChild>
      <button
        type="button"
        className={mode === "draft" ? styles.draftRevise : styles.cardReviseButton}
        aria-label={disabled ? "AI draft" : "Ask AI to revise this card"}
        disabled={disabled}
        onClick={event => { if (event.altKey) setFastTrack(true); else setFastTrack(false); }}
      >
        {mode === "draft" ? (
          <>
            <span className={styles.draftSparkle} aria-hidden="true"><Sparkles size={12} strokeWidth={2.3} /></span>
            {!disabled && <span className={styles.draftBubble} aria-hidden="true"><MessageSquare size={12} strokeWidth={2.2} /><span className={styles.draftStatMark}>!</span></span>}
          </>
        ) : (
          <span className={styles.cardReviseBubble} aria-hidden="true"><MessageSquare size={12} strokeWidth={2.2} /><span className={styles.draftStatMark}>!</span></span>
        )}
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
        <label className="grid gap-2 text-sm font-semibold">Add {handle} revision note
          <textarea className="w-full rounded-[10px] border p-2 text-sm font-normal" rows={3} value={comment}
            placeholder="Tell AI what to adjust…"
            readOnly={saving} onChange={event => setComment(event.target.value)} />
        </label>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={fastTrack} disabled={saving} onChange={event => setFastTrack(event.target.checked)} />
            <span>Fast-track (@stat)</span>
          </label>
          <div className="flex gap-1.5">
            <Popover.Close asChild><button type="button" className="p-button p-button-borderless" disabled={saving}>Cancel</button></Popover.Close>
            <button type="submit" className="p-button p-button-primary" disabled={saving || !text}>{saving ? "Saving…" : "Send"}</button>
          </div>
        </div>
      </form>
    </PopoverSurface>
  </Popover.Root>;
}
