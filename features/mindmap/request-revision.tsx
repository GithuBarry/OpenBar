"use client";

import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { MessageSquare } from "lucide-react";
import { PopoverSurface } from "@/components/pop";

export function RequestRevision({ nodeId, onRequest }: {
  nodeId: string;
  onRequest: (note: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const pending = useRef(false);
  const request = useRef<{ comment: string; note: string } | null>(null);

  useEffect(() => {
    if (!sent) return;
    const timer = window.setTimeout(() => setSent(false), 2000);
    return () => window.clearTimeout(timer);
  }, [sent]);

  async function send() {
    const text = comment.trim();
    if (!text || pending.current) return;
    if (request.current?.comment !== text) {
      request.current = { comment: text, note: `@agent Revise this draft: ${text}\nRequested ${new Date().toISOString()}` };
    }
    pending.current = true;
    setSending(true);
    setError("");
    try {
      await onRequest(request.current.note);
      request.current = null;
      setComment("");
      setOpen(false);
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the revision request.");
    } finally {
      pending.current = false;
      setSending(false);
    }
  }

  return <Popover.Root open={open} onOpenChange={next => {
    if (pending.current) return;
    setOpen(next);
    if (next) setSent(false);
  }}>
    <Popover.Trigger asChild>
      <button type="button" aria-label="Revise draft" title="Request a revision with a comment" style={{ width: "auto", paddingInline: 5, gap: 4, fontSize: 11 }}>
        <MessageSquare size={13} aria-hidden="true" />{sent ? "Sent" : "Revise"}
      </button>
    </Popover.Trigger>
    <span role="status" className="sr-only">{sent && "Revision request sent"}</span>
    <PopoverSurface side="bottom" align="end" aria-label="Request a draft revision" data-mind-editor={nodeId}
      className="w-72 max-w-[calc(100vw-24px)] p-3 nodrag nopan nowheel"
      onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void send(); }}
        onKeyDown={event => {
          if (event.key === "Escape") return;
          event.stopPropagation();
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}>
        <label className="grid gap-2 text-sm font-semibold">What should the agent change?
          <textarea className="w-full rounded-md border p-2 text-sm font-normal" rows={3} value={comment}
            readOnly={sending} onChange={event => setComment(event.target.value)} />
        </label>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Popover.Close asChild><button type="button" className="p-button p-button-borderless" disabled={sending}>Cancel</button></Popover.Close>
          <button type="submit" className="p-button p-button-primary" disabled={sending || !comment.trim()}>{sending ? "Sending…" : "Request revision"}</button>
        </div>
      </form>
    </PopoverSurface>
  </Popover.Root>;
}
