"use client";

import { useEffect, useRef, useState } from "react";
import { useProjectWriteSession } from "@/components/project-session/project-write-session";
import { Modal } from "./modal";
import { GitMergeEditor } from "./git-merge-editor";
import { OverleafForce } from "./overleaf-force";
import { Check, Copy, Download, LoaderCircle, X } from "lucide-react";
import { copyText } from "@/lib/copy-text";
import { requestGitReview } from "@/lib/git-review-client";
import type { OverleafConflictChoice, OverleafPullReview } from "@/lib/tex-project/overleaf-git";
import type { ForcePullReconciliation, PendingForcePull } from "@/lib/research/force-sync-client";
import styles from "./overleaf-pull.module.css";

export function OverleafPull({ project, beforeReview, onApplied, onPullUncertain, onClosed, disabled = false }: {
  project: string;
  beforeReview?: () => Promise<boolean>;
  onApplied: (pending?: PendingForcePull) => Promise<void>;
  onPullUncertain?: (reconcile: ForcePullReconciliation, pending: PendingForcePull) => void;
  onClosed?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<OverleafPullReview | null>(null);
  const [choices, setChoices] = useState<Record<string, OverleafConflictChoice>>({});
  const [phase, setPhase] = useState<"idle" | "saving" | "preparing" | "applying" | "closing">("idle");
  const busy = phase !== "idle";
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [notice, setNotice] = useState("");
  const [logLines, setLogLines] = useState<{ id: number; text: string }[]>([]);
  const nextLogId = useRef(0);
  const { setPendingWork, connectionState } = useProjectWriteSession();
  const reconnecting = connectionState === "reconnecting";

  useEffect(() => {
    setPendingWork("git-review", open || busy);
    return () => setPendingWork("git-review", false);
  }, [open, busy, setPendingWork]);

  async function prepare() {
    if (busy) return;
    setPhase(beforeReview ? "saving" : "preparing"); setError(""); setCopied(false); setCopyError(false); setNotice(""); setChoices({}); setReview(null); setLogLines([]);
    setOpen(true);
    let savingEditor = true;
    try {
      if (beforeReview && !await beforeReview()) throw new Error("Save the current editor changes before reviewing Git updates.");
      savingEditor = false;
      setPhase("preparing");
      const result = await requestGitReview(project, { action: "prepare" }, text => {
        const id = nextLogId.current++;
        setLogLines(current => [...current, { id, text }].slice(-5));
      });
      if (!result.ok) throw new Error(result.message);
      setReview(result.review);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not prepare Git updates.";
      setError(savingEditor && message === "An unexpected response was received from the server."
        ? "The current editor save received an unexpected server response. Keep this tab open to preserve your draft, then check your connection and sign-in before trying again."
        : message);
    }
    finally { setPhase("idle"); }
  }

  async function close() {
    if (busy) return;
    setPhase("closing");
    try {
      if (review) {
        const result = await requestGitReview(project, { action: "finish", token: review.token, choices: [], cancel: true });
        if (!result.ok) throw new Error(result.message);
        if (result.applied) await onApplied();
      }
      setReview(null); setOpen(false); onClosed?.();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not close review."); }
    finally { setPhase("idle"); }
  }

  async function apply() {
    if (!review || busy) return;
    setPhase("applying"); setError(""); setCopied(false); setCopyError(false);
    try {
      const result = await requestGitReview(project, { action: "finish", token: review.token, choices: Object.values(choices) });
      if (!result.ok) throw new Error(result.message);
      await onApplied();
      setReview(null);
      setNotice(result.message); setOpen(false); onClosed?.();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not apply Git updates."); }
    finally { setPhase("idle"); }
  }

  const diagnosticReport = [
    "OpenBar Git review",
    `Project: ${project}`,
    `Error: ${error}`,
    logLines.length ? `Recent Git output:\n${logLines.map(line => line.text).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");

  async function copyDiagnostics() {
    try { await copyText(diagnosticReport); setCopied(true); setCopyError(false); }
    catch { setCopied(false); setCopyError(true); }
  }

  return <>
    <button type="button" className={styles.trigger} disabled={disabled || busy || reconnecting} onClick={() => void prepare()}><Download size={14} />Pull from Git</button>
    <OverleafForce project={project} beforeReview={beforeReview} onApplied={onApplied} onPullUncertain={onPullUncertain} onClosed={onClosed} disabled={disabled || busy || reconnecting} />
    {notice && <span className={styles.notice} role="status">{notice}</span>}
    <Modal open={open} onClose={() => void close()} title="Review Git updates" busy={busy} className={styles.dialog}>
      <div className={styles.header}><h2 id="overleaf-pull-title">Review Git updates</h2><button type="button" aria-label="Close Git review" disabled={busy} onClick={() => void close()}><X size={18} /></button></div>
      <div className={styles.body}>
        <p>{review ? "Local changes are checkpointed in Git. Review the combined version, then apply it to this project." : "Prepare the incoming Git updates for review."}</p>
        {reconnecting && <p role="status">Reconnecting…</p>}
        {!reconnecting && busy && <p role="status"><LoaderCircle size={15} className={styles.spinner} /> {phase === "saving" ? "Saving current editor changes…" : phase === "preparing" ? "Preparing Git review, including fetching incoming updates…" : phase === "applying" ? "Applying reviewed updates and refreshing the editor…" : "Closing Git review…"}</p>}
        {(busy || error) && logLines.length > 0 && <ol className={styles.progressLog} role="log" aria-label="Git review progress" aria-live="polite" aria-relevant="additions">{logLines.map(line => <li key={line.id}>{line.text}</li>)}</ol>}
        {!reconnecting && error && <>
          <p className={`${styles.error} ${styles.errorDetails}`} role="alert">{error}</p>
          <div className={styles.errorActions}>
            <button type="button" onClick={() => void copyDiagnostics()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied details" : "Copy error details"}</button>
          </div>
          {copyError && <label className={styles.diagnosticFallback}>Select and copy these details<textarea readOnly value={diagnosticReport} /></label>}
        </>}
        {review && <>
          <p>{review.files.length} changed files, {review.conflicts.length} conflicts requiring your choice</p>
          <details><summary>Changed files</summary><ul>{review.files.map((file) => <li key={file}><code>{file}</code></li>)}</ul></details>
          {review.conflicts.map((conflict) => {
            const selected = choices[conflict.path];
            return <section key={conflict.path} className={styles.conflict}>
              <h3>{conflict.path}</h3>
              <div className={styles.versions}>
                <div><strong>Local checkpoint</strong><pre>{conflict.local ?? (conflict.editable ? "File deleted locally" : "Binary, linked, or large file. Choose a saved version.")}</pre></div>
                <div><strong>Git</strong><pre>{conflict.remote ?? (conflict.editable ? "File deleted on Git" : "Binary, linked, or large file. Choose a saved version.")}</pre></div>
              </div>
              {conflict.editable && <details><summary>Common ancestor</summary><pre>{conflict.base ?? "New file"}</pre></details>}
              <div className={styles.choices} role="group" aria-label={`Resolve ${conflict.path}`}>
                {(["local", "remote", ...(conflict.editable ? ["merged"] : [])] as const).map((choice) => <button key={choice} type="button" disabled={busy} aria-pressed={selected?.choice === choice} onClick={() => setChoices((current) => ({ ...current, [conflict.path]: { path: conflict.path, choice: choice as OverleafConflictChoice["choice"], ...(choice === "merged" ? { text: selected?.text ?? conflict.merged ?? conflict.local ?? conflict.remote ?? "" } : {}) } }))}>{choice === "local" ? "Use local file" : choice === "remote" ? "Use Git file" : "Edit combined text"}</button>)}
              </div>
              {selected?.choice === "merged" && <>
                <p>Git version → combined result. Use the arrows to copy individual changes, then resolve the marked conflicts in the result.</p>
                <GitMergeEditor original={conflict.remote || ""} value={selected.text || ""} disabled={busy} onChange={(text) => setChoices(current => ({ ...current, [conflict.path]: { ...selected, text } }))} />
                {/^(<<<<<<< |=======\s*$|>>>>>>> )/m.test(selected.text || "") && <p className={styles.error}>Resolve the conflict markers in the combined result to continue.</p>}
              </>}
            </section>;
          })}
          <p>Each choice applies to the entire file. Git combines changes in other files automatically. The combined result stays local until you save to Git.</p>
        </>}
      </div>
      <div className={styles.footer}>
        <button type="button" disabled={busy} onClick={() => void close()}>{review ? "Cancel review" : "Close"}</button>
        {review ? <button type="button" disabled={reconnecting || busy || review.conflicts.some((conflict) => !choices[conflict.path] || (choices[conflict.path].choice === "merged" && /^(<<<<<<< |=======\s*$|>>>>>>> )/m.test(choices[conflict.path].text || "")))} onClick={() => void apply()}>Apply updates</button>
          : error && <button type="button" disabled={reconnecting || busy || disabled} onClick={() => void prepare()}>Retry review</button>}
      </div>
    </Modal>
  </>;
}
