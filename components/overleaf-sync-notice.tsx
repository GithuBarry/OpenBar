"use client"

import { useState } from "react"
import { Download, GitBranch, LoaderCircle, Upload } from "lucide-react"
import { getProjectSyncDetailsAction } from "@/app/actions"
import { EditorNotice } from "./editor-notice"
import { OverleafPull } from "./overleaf-pull"
import type { ForcePullReconciliation, PendingForcePull } from "@/lib/research/force-sync-client"
import type { EditorIssue } from "@/lib/editor-issue-priority"
import styles from "./overleaf-sync-notice.module.css"

type Props = {
  project: string
  message: string
  editingPaused?: boolean
  activeReview?: boolean
  inline?: boolean
  floating?: boolean
  attention?: boolean
  openRequest?: number
  pulling?: boolean
  disabled?: boolean
  checking?: boolean
  suppressed?: boolean
  relatedIssues?: readonly EditorIssue[]
  beforeReview?: () => Promise<boolean>
  quickPullAvailable?: boolean
  onQuickPull?: () => void
  hydrationPending?: boolean
  reconciliationPending?: boolean
  onReload?: () => void
  onApplied: (pending?: PendingForcePull) => Promise<void>
  onPullUncertain?: (reconcile: ForcePullReconciliation, pending: PendingForcePull) => void
  onClosed?: () => void
  onCheck: () => void | Promise<void>
  onPush?: () => void
}

export function OverleafSyncNotice({ project, message, editingPaused, activeReview, inline, floating, attention, openRequest, pulling, disabled, checking, suppressed, relatedIssues, beforeReview, quickPullAvailable, onQuickPull, hydrationPending, reconciliationPending, onReload, onApplied, onPullUncertain, onClosed, onCheck, onPush }: Props) {
  const [details, setDetails] = useState<Awaited<ReturnType<typeof getProjectSyncDetailsAction>> | null>(null)
  const [detailsError, setDetailsError] = useState("")
  const readDetails = async () => {
    try { setDetails(await getProjectSyncDetailsAction(project)); setDetailsError("") }
    catch { setDetailsError("Change details are unavailable. Check updates to try again.") }
  }
  const status = details?.status
  const fileGroups = details && "incomingFiles" in details ? [
    { label: "Incoming files", files: details.incomingFiles || [] },
    { label: "Changed on both sides", files: details.overlappingFiles || [] },
    { label: "Confirmed conflicts", files: details.conflictedFiles || [] },
  ] : []
  const report = [message, editingPaused ? "Editing is paused." : "", status ? `${status.behind || 0} incoming commits, ${status.ahead || 0} local commits` : "", ...fileGroups.map(group => `${group.label}:\n${group.files.join("\n") || "None in the last checked state"}`), status?.changedFiles?.length ? `Unsaved repository files:\n${status.changedFiles.join("\n")}` : "", detailsError].filter(Boolean).join("\n\n")
  if (!editingPaused && !inline && !floating && !activeReview) return null
  return <EditorNotice project={project} title="Git synchronization" label={editingPaused ? inline || floating ? "Git needs review" : "Editing paused, sync Git" : "Git sync needs attention"} message={message} report={report} paused={editingPaused} inline={inline} floating={floating} attention={attention} openRequest={openRequest} suppressed={suppressed} preserveContent={activeReview} relatedIssues={relatedIssues} triggerLabel="Git sync details" onOpen={() => void readDetails()} primaryAction={editingPaused && !activeReview && ((hydrationPending && onReload) || (quickPullAvailable && onQuickPull)) ? <button type="button" className={styles.quickPull} disabled={disabled || (checking && !hydrationPending) || pulling} onClick={hydrationPending ? onReload : onQuickPull} aria-live="polite">{pulling ? <LoaderCircle size={13} className="animate-spin" /> : <Download size={13} />}{reconciliationPending ? pulling ? "Checking Git update…" : "Check Git update" : hydrationPending ? pulling ? "Reloading…" : "Reload editor" : pulling ? "Pulling updates…" : "Pull updates"}</button> : undefined}>
    {status?.isOverleafRemote && <div className={styles.changeSummary}>
      <span>{status.behind || 0} incoming commits, {status.ahead || 0} local commits</span>
      {fileGroups.filter(group => group.files.length > 0).map(group => <details key={group.label} open={group.files.length <= 5}>
        <summary>{group.label} ({group.files.length})</summary>
        <ul>{group.files.map(file => <li key={file}>{file}</li>)}</ul>
      </details>)}
      {(status.changedFiles?.length || 0) > 0 && <small>{status.changedFiles!.length} locally modified files</small>}
      {!!details && "overlappingFiles" in details && (details.overlappingFiles?.length || 0) > 0 && <small>Pull review checks the exact conflicts in files changed on both sides.</small>}
    </div>}
    {detailsError && <p>{detailsError}</p>}
    <div className={styles.actions}>
      <OverleafPull project={project} disabled={disabled || hydrationPending} beforeReview={beforeReview} onApplied={onApplied} onPullUncertain={onPullUncertain} onClosed={onClosed} />
      <button type="button" disabled={disabled || checking} onClick={() => void (async () => { await onCheck(); await readDetails() })()}><GitBranch size={13} />{checking ? "Checking…" : "Check updates"}</button>
      {onPush && <button type="button" disabled={disabled || editingPaused || checking} onClick={onPush}><Upload size={13} />Save to Git</button>}
    </div>
  </EditorNotice>
}
