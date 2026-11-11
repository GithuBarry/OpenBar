"use client";

import { useEffect, useRef, useState } from "react";
import { useProjectWriteSession } from "@/components/project-session/project-write-session";
import { Modal } from "./modal";
import { prepareForceProjectSyncAction, confirmForceProjectSyncAction, finishForceProjectSyncAction } from "@/app/actions";
import { finishForceRequest, persistPendingForcePull, readPendingForcePull, type ForcePullReconciliation, type PendingForcePull } from "@/lib/research/force-sync-client";
import type { ForceSyncDirection, ForceSyncReview } from "@/lib/tex-project/overleaf-git";
import styles from "./overleaf-pull.module.css";

export function OverleafForce({ project, beforeReview, onApplied, onPullUncertain, onClosed, disabled }: {
  project: string;
  beforeReview?: () => Promise<boolean>;
  onApplied: (pending?: PendingForcePull) => Promise<void>;
  onPullUncertain?: (reconcile: ForcePullReconciliation, pending: PendingForcePull) => void;
  onClosed?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<ForceSyncReview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [direction, setDirection] = useState<ForceSyncDirection>("pull");
  const finishAttempted = useRef(false);
  const pendingPull = useRef<PendingForcePull | null>(null);
  const { setPendingWork } = useProjectWriteSession();
  useEffect(() => {
    setPendingWork("git-force-review", open || busy);
    return () => setPendingWork("git-force-review", false);
  }, [open, busy, setPendingWork]);
  const reportPullUncertain = (pending: PendingForcePull) => onPullUncertain?.(
    () => finishForceRequest("pull", () => finishForceProjectSyncAction(project, pending.token, "", "", true)), pending,
  );
  async function prepare(next: ForceSyncDirection) {
    finishAttempted.current = false;
    pendingPull.current = null;
    setDirection(next); setBusy(true); setError(""); setConfirmation(""); setPhrase(""); setNotice(""); setOpen(true);
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
    let uncertain = false;
    try {
      if (review) {
        const result = await finishForceRequest(direction, () => finishForceProjectSyncAction(project, review.token, "", "", true), finishAttempted.current && pendingPull.current ? () => { uncertain = true; reportPullUncertain(pendingPull.current!); } : undefined);
        if (uncertain) { setReview(null); setOpen(false); onClosed?.(); return; }
        if (!result.ok) throw new Error(result.message);
        if (direction === "pull" && (result.applied || finishAttempted.current)) await onApplied(pendingPull.current || undefined);
      }
      setReview(null); setOpen(false); onClosed?.();
    } catch (err) {
      if (uncertain) { setReview(null); setOpen(false); onClosed?.(); }
      else setError(err instanceof Error ? err.message : "Could not cancel.");
    }
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
    let uncertain = false;
    try {
      if (direction === "pull") {
        const existing = readPendingForcePull(project);
        if (existing && existing !== review.token) {
          reportPullUncertain({ token: existing, persisted: true });
          throw new Error("Check the previous force pull before starting another.");
        }
        pendingPull.current = persistPendingForcePull(project, review.token);
        if (!pendingPull.current.persisted) reportPullUncertain(pendingPull.current);
      }
      finishAttempted.current = true;
      const result = await finishForceRequest(direction, () => finishForceProjectSyncAction(project, review.token, confirmation, phrase), () => { uncertain = true; if (pendingPull.current) reportPullUncertain(pendingPull.current); });
      if (!result.ok) throw new Error(result.message);
      await onApplied(pendingPull.current || undefined); setReview(null);
      setNotice(`${result.message} Both versions have Git recovery points.`); setOpen(false); onClosed?.();
    } catch (err) { const message = err instanceof Error ? err.message : "Could not complete synchronization."; setError(uncertain ? `Git may have updated the project. Reload the editor to check. ${message}` : message); }
    finally { setBusy(false); }
  }
  const expectedPhrase = `FORCE ${direction.toUpperCase()}`;
  return <>
    <button type="button" className={styles.trigger} disabled={disabled || busy} onClick={() => void prepare("pull")}>Force pull</button>
    <button type="button" className={styles.trigger} disabled={disabled || busy} onClick={() => void prepare("push")}>Force push</button>
    {notice && <span className={styles.notice} role="status">{notice}</span>}
    <Modal open={open} onClose={() => void close()} title="Force Git synchronization" busy={busy} className={styles.dialog}>
      <div className={styles.header}><h2 id="force-sync-title">Force {direction} (confirmation {confirmation ? "2" : "1"} of 2)</h2></div>
      <div className={styles.body}>
        <p>{direction === "pull" ? "Replace the local project with the reviewed Git version. Local-only commits will move out of the active branch." : "Replace the Git branch with the reviewed local version. Remote-only commits will move out of the active branch."}</p>
        <p>Both versions receive local Git recovery points before replacement.</p>
        {busy && <p role="status">Working…</p>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {review && <>
          <p><strong>{review.branch}</strong>: {review.ahead} local-only commits, {review.behind} Git-only commits</p>
          <p>Local <code>{review.localCommit.slice(0,12)}</code>, Git <code>{review.remoteCommit.slice(0,12)}</code></p>
          <details><summary>{review.files.length} differing files</summary><ul>{review.files.map(file => <li key={file}><code>{file}</code></li>)}</ul></details>
        </>}
        {confirmation && <label className={styles.confirmPhrase}>Type <strong>{expectedPhrase}</strong> to confirm replacement.<input aria-label="Force synchronization confirmation" value={phrase} autoComplete="off" spellCheck={false} onChange={(event) => setPhrase(event.target.value)} /></label>}
      </div>
      <div className={styles.footer}><button type="button" disabled={busy} onClick={() => void close()}>Cancel</button>{confirmation ? <button type="button" disabled={busy || phrase !== expectedPhrase} onClick={() => void finish()}>Confirm force {direction}</button> : <button type="button" disabled={busy || !review} onClick={() => void confirm()}>I understand, continue</button>}</div>
    </Modal>
  </>;
}
