"use client";

import { useRef, useState } from "react";
import { ArrowUp, Check, ClipboardPaste, Copy } from "lucide-react";
import { copyText } from "@/lib/copy-text";
import { MAX_HTML_CARD_LENGTH } from "@/lib/mindmap/html-card";
import styles from "./html-card-tools.module.css";

export function HtmlCardTools({ html, onComment, onPaste, onDone }: {
  html: string;
  onComment: (comment: string) => Promise<void>;
  onPaste: (html: string) => Promise<void>;
  onDone: () => void;
}) {
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const pasteButton = useRef<HTMLButtonElement>(null);
  const message = comment.trim().replace(/^@agent\b\s*/i, "").trim();

  async function perform(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setStatus("");
    try { await action(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Please try again."); }
    finally { pending.current = false; setBusy(false); }
  }

  async function replaceBody(source: string) {
    if (!source.trim()) throw new Error("Copy some HTML first.");
    if (source.length > MAX_HTML_CARD_LENGTH) throw new Error(`The pasted HTML exceeds the ${MAX_HTML_CARD_LENGTH.toLocaleString("en-US")}-character limit.`);
    await onPaste(source);
    setStatus("HTML pasted");
  }

  return <div className={styles.tools} onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" && !pending.current) { event.preventDefault(); onDone(); }
    }}>
    <form className={styles.row} onSubmit={event => {
      event.preventDefault();
      if (message) void perform(async () => {
        await onComment(message);
        setComment("");
        setStatus("Comment added to card");
      });
    }}>
      <input className={styles.comment} aria-label="Comment for @agent" placeholder="Comment for @agent…"
        value={comment} readOnly={busy} onChange={event => setComment(event.target.value)} />
      <button type="submit" disabled={busy || !message} aria-label="Add @agent comment" title="Add @agent comment"><ArrowUp size={15} /></button>
      <span className={styles.divider} aria-hidden="true" />
      <button type="button" aria-label="Copy HTML" title="Copy HTML" disabled={busy || !html}
        onClick={() => void perform(async () => { await copyText(html); setStatus("HTML copied"); })}><Copy size={15} /></button>
      <button ref={pasteButton} type="button" aria-label="Paste HTML" title="Paste HTML" aria-busy={busy}
        onPaste={event => {
          event.preventDefault();
          event.stopPropagation();
          const source = event.clipboardData.getData("text/plain") || event.clipboardData.getData("text/html");
          void perform(() => replaceBody(source));
        }}
        onClick={() => void perform(async () => {
          let source: string;
          try {
            source = await navigator.clipboard.readText();
            if (!source && navigator.clipboard.read) {
              const items = await navigator.clipboard.read();
              const item = items.find(entry => entry.types.includes("text/html"));
              if (item) source = await (await item.getType("text/html")).text();
            }
          }
          catch {
            pasteButton.current?.focus();
            setStatus("Press ⌘V or Ctrl+V to paste HTML.");
            return;
          }
          await replaceBody(source);
        })}><ClipboardPaste size={15} /></button>
      <button type="button" aria-label="Finish editing card" title="Done" disabled={busy} onClick={onDone}><Check size={16} /></button>
    </form>
    <div className={styles.status} role="status">{status}</div>
  </div>;
}
