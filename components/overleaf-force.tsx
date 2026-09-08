"use client";

import { useRef, useState } from "react";
import { prepareForceProjectSyncAction, confirmForceProjectSyncAction, finishForceProjectSyncAction } from "@/app/actions";
import type { ForceSyncDirection, ForceSyncReview } from "@/lib/tex-project/overleaf-git";
import styles from "./overleaf-pull.module.css";

export function OverleafForce({ project, beforeReview, onApplied, onClosed, disabled }: {
  project: string;
  beforeReview?: () => Promise<boolean>;
  onApplied: () => Promise<void>;
  onClosed?: () => void;
  disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [review, setReview] = useState<ForceSyncReview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [direction, setDirection] = useState<ForceSyncDirection>("pull");
  async function prepare(next: ForceSyncDirection) {
    setDirection(next); setBusy(true); setError(""); setConfirmation(""); setPhrase(""); setNotice(""); dialog.current?.showModal();
    try {
      if (beforeReview && !await beforeReview()) throw new Error("Save the current editor changes before continuing.");
      const result = await prepareForceProjectSyncAction(project, next);
      if (!result.ok) throw new Error(result.message);
      setReview(result.review);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not prepare force synchronization."); }
    finally { setBusy(false); }
  }
  async function close() {
    if (busy) return;
    setBusy(true);
    try {
      if (review) {
        const result = await finishForceProjectSyncAction(project, review.token, "", "", true);
        if (!result.ok) throw new Error(result.message);
      }
      setReview(null); dialog.current?.close(); onClosed?.();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not cancel."); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!review || busy) return;
    setBusy(true); setError("");
    try {
      const result = await confirmForceProjectSyncAction(project, review.token);
      if (!result.ok) throw new Error(result.message);
      setConfirmation(result.confirmation);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not record confirmation."); }
    finally { setBusy(false); }
  }
  async function finish() {
    if (!review || busy) return;
    setBusy(true); setError("");
    try {
      const result = await finishForceProjectSyncAction(project, review.token, confirmation, phrase);
      if (!result.ok) throw new Error(result.message);
      setReview(null); await onApplied();
      setNotice(`${result.message} Both versions have Git recovery points.`); dialog.current?.close(); onClosed?.();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not complete synchronization."); }
    finally { setBusy(false); }
  }
  const expectedPhrase = `FORCE ${direction.toUpperCase()}`;
  return <>
    <button type="button" className={styles.trigger} disabled={disabled || busy} onClick={() => void prepare("pull")}>Force pull</button>
    <button type="button" className={styles.trigger} disabled={disabled || busy} onClick={() => void prepare("push")}>Force push</button>
    {notice && <span className={styles.notice} role="status">{notice}</span>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="force-sync-title" onCancel={(event) => { event.preventDefault(); void close(); }}>
      <div className={styles.header}><h2 id="force-sync-title">Force {direction} · confirmation {confirmation ? "2" : "1"} of 2</h2></div>
      <div className={styles.body}>
        <p>{direction === "pull" ? "Replace the local project with the reviewed Git version. Local-only commits will move out of the active branch." : "Replace the Git branch with the reviewed local version. Remote-only commits will move out of the active branch."}</p>
        <p>Both versions receive local Git recovery points before replacement.</p>
        {busy && <p role="status">Working…</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {review && <>
          <p><strong>{review.branch}</strong> · {review.ahead} local-only commits · {review.behind} Git-only commits</p>
          <p>Local <code>{review.localCommit.slice(0,12)}</code> · Git <code>{review.remoteCommit.slice(0,12)}</code></p>
          <details><summary>{review.files.length} differing files</summary><ul>{review.files.map(file => <li key={file}><code>{file}</code></li>)}</ul></details>
        </>}
        {confirmation && <label className={styles.confirmPhrase}>Type <strong>{expectedPhrase}</strong> to confirm replacement.<input aria-label="Force synchronization confirmation" value={phrase} autoComplete="off" spellCheck={false} onChange={(event) => setPhrase(event.target.value)} /></label>}
      </div>
      <div className={styles.footer}><button type="button" disabled={busy} onClick={() => void close()}>Cancel</button>{confirmation ? <button type="button" disabled={busy || phrase !== expectedPhrase} onClick={() => void finish()}>Confirm force {direction}</button> : <button type="button" disabled={busy || !review} onClick={() => void confirm()}>I understand · continue</button>}</div>
    </dialog>
  </>;
}
