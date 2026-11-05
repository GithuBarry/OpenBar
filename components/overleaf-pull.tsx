"use client";

import { useState } from "react";
import { Modal } from "./modal";
import { GitMergeEditor } from "./git-merge-editor";
import { OverleafForce } from "./overleaf-force";
import { Download, LoaderCircle, X } from "lucide-react";
import { prepareProjectPullAction, finishProjectPullAction } from "@/app/actions";
import type { OverleafConflictChoice, OverleafPullReview } from "@/lib/tex-project/overleaf-git";
import styles from "./overleaf-pull.module.css";

export function OverleafPull({ project, beforeReview, onApplied, onClosed, disabled = false }: {
  project: string;
  beforeReview?: () => Promise<boolean>;
  onApplied: () => Promise<void>;
  onClosed?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<OverleafPullReview | null>(null);
  const [choices, setChoices] = useState<Record<string, OverleafConflictChoice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function prepare() {
    if (busy) return;
    setBusy(true); setError(""); setNotice(""); setChoices({}); setReview(null);
    setOpen(true);
    try {
      if (beforeReview && !await beforeReview()) throw new Error("Save the current editor changes before reviewing Git updates.");
      const result = await prepareProjectPullAction(project);
      if (!result.ok) throw new Error(result.message);
      setReview(result.review);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not prepare Git updates."); }
    finally { setBusy(false); }
  }

  async function close() {
    if (busy) return;
    setBusy(true);
    try {
      if (review) {
        const result = await finishProjectPullAction(project, review.token, [], true);
        if (!result.ok) throw new Error(result.message);
      }
      setReview(null); setOpen(false); onClosed?.();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not close review."); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!review || busy) return;
    setBusy(true); setError("");
    try {
      const result = await finishProjectPullAction(project, review.token, Object.values(choices));
      if (!result.ok) throw new Error(result.message);
      setReview(null);
      await onApplied();
      setNotice(result.message); setOpen(false); onClosed?.();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not apply Git updates."); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" className={styles.trigger} disabled={disabled || busy} onClick={() => void prepare()}><Download size={14} />Pull from Git</button>
    <OverleafForce project={project} beforeReview={beforeReview} onApplied={onApplied} onClosed={onClosed} disabled={disabled || busy} />
    {notice && <span className={styles.notice} role="status">{notice}</span>}
    <Modal open={open} onClose={() => void close()} title="Review Git updates" busy={busy} className={styles.dialog}>
      <div className={styles.header}><h2 id="overleaf-pull-title">Review Git updates</h2><button type="button" aria-label="Close Git review" disabled={busy} onClick={() => void close()}><X size={18} /></button></div>
      <div className={styles.body}>
        <p>Local changes are checkpointed in Git. Review the combined version, then apply it to this project.</p>
        {busy && <p role="status"><LoaderCircle size={15} className={styles.spinner} /> Preparing or applying updates…</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
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
      <div className={styles.footer}><button type="button" disabled={busy} onClick={() => void close()}>Cancel review</button><button type="button" disabled={busy || !review || review.conflicts.some((conflict) => !choices[conflict.path] || (choices[conflict.path].choice === "merged" && /^(<<<<<<< |=======\s*$|>>>>>>> )/m.test(choices[conflict.path].text || "")))} onClick={() => void apply()}>Apply updates</button></div>
    </Modal>
  </>;
}
