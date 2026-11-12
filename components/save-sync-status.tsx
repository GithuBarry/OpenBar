"use client";

import { CircleAlert, CloudOff, Gauge, LoaderCircle } from "lucide-react";
import { FastTooltip } from "./fast-tooltip";
import { cn } from "@/lib/utils";
import { useProjectWriteSession } from "./project-session/project-write-session";
import { hostBusyDetail } from "@/lib/editor-issue-priority";

export type SaveRemoteState = "checking" | "local" | "pending" | "syncing" | "synced" | "changed" | "blocked" | "unconfigured" | "unavailable" | "failed";

export function SaveChecks({ stage, size = 14 }: { stage: "local" | "queued" | "remote"; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={`rgb(var(--${stage === "remote" ? "accent" : "ink"}))`} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
    <path d={stage === "local" ? "m4 12 5 5L20 6" : "m1 12 5 5L17 6"} />
    {stage !== "local" && <path d="m7 12 5 5L23 6" />}
  </svg>;
}

export function SaveStatusIcon({ saved, saving, conflict = false, attention = false, remote, size = 14, connectionUnavailable = false, hostBusy = false }: {
  saved: boolean;
  saving: boolean;
  conflict?: boolean;
  attention?: boolean;
  remote: SaveRemoteState;
  size?: number;
  connectionUnavailable?: boolean;
  hostBusy?: boolean;
}) {
  if (connectionUnavailable) return <CloudOff size={size} className="shrink-0 text-[rgb(var(--warn))]" />;
  const remoteError = remote === "unavailable" || remote === "failed";
  if (conflict || attention || remoteError || remote === "changed" || remote === "blocked") {
    return <CircleAlert size={size} className={cn("shrink-0", conflict || remoteError ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--warn))]")} />;
  }
  if (hostBusy) return <Gauge size={size} className="shrink-0 text-[rgb(var(--warn))]" />;
  if (saving || (saved && (remote === "checking" || remote === "syncing"))) {
    return <LoaderCircle size={size} className="shrink-0 animate-spin text-accent" />;
  }
  if (!saved) return <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />;
  return <SaveChecks stage={remote === "synced" ? "remote" : remote === "pending" ? "queued" : "local"} size={size} />;
}

export function SaveSyncStatus({ saved, saving, conflict = false, error, remote, onRetry, compact = false, iconOnly = false, className, onConnectionIssue }: {
  saved: boolean;
  saving: boolean;
  conflict?: boolean;
  error?: string | null;
  remote: SaveRemoteState;
  onRetry?: () => void;
  compact?: boolean;
  iconOnly?: boolean;
  className?: string;
  onConnectionIssue?: () => void;
}) {
  const session = useProjectWriteSession();
  const reconnecting = session.connectionState === "reconnecting";
  const host = !reconnecting && !conflict && !error && !["changed", "blocked", "unavailable", "failed"].includes(remote)
    ? hostBusyDetail(session.hostResources) : null;
  const synced = saved && !saving && !conflict && remote === "synced";
  const review = remote === "changed" || remote === "blocked";
  const remoteError = remote === "unavailable" || remote === "failed";
  const label = reconnecting ? "Reconnecting…" : host ? "Host busy" : conflict ? "Save conflict"
    : review ? "Git needs review"
      : remoteError ? remote === "unavailable" ? "Git unavailable" : "Git sync failed"
        : error ? "Saving needs attention"
          : saving ? "Saving…"
            : !saved ? "Unsaved changes"
              : synced ? "Synced to Git"
                : remote === "checking" ? "Checking Git…"
                  : remote === "syncing" ? "Syncing to Git…"
                    : remote === "pending" ? "Waiting for Git sync"
                      : "Saved locally";
  const detail = [
    reconnecting ? "Reconnecting to OpenBar. Your edits remain in this tab." : host,
    saved ? "Saved to project files." : saving ? "Saving your latest edits to project files." : "Your latest edits are waiting to be saved.",
    synced ? "The saved changes are confirmed on the Git remote."
      : remote === "unconfigured" ? "Connect an Overleaf repository to enable Git synchronization."
      : remote === "local" ? "Check Git to confirm remote synchronization."
      : remote === "checking" ? "Checking the latest Git status."
        : remote === "syncing" ? "Uploading the saved changes to Git."
          : review ? "Review Git updates before synchronization can continue."
            : remoteError ? "Git synchronization needs attention."
              : "The saved changes are waiting for Git synchronization.",
    error,
  ].filter(Boolean).join("\n");
  const canRetry = !reconnecting && !host && saved && !saving && !conflict && ["pending", "blocked", "unavailable", "failed"].includes(remote) && !!onRetry;
  const canOpenConnection = reconnecting && Boolean(onConnectionIssue);
  return <FastTooltip label={`${detail}${canRetry ? "\nClick to retry Git sync." : ""}`}>
    <button type="button" onClick={canOpenConnection ? onConnectionIssue : canRetry ? onRetry : undefined}
      aria-label={label} aria-disabled={!canRetry && !canOpenConnection} data-editor-notice={reconnecting || undefined} data-save-stage={synced ? "remote" : saved ? remote === "pending" || remote === "syncing" ? "queued" : "local" : "unsaved"}
      className={cn("inline-flex min-w-0 items-center gap-1 rounded text-[11px] text-muted", canRetry ? "cursor-pointer hover:text-ink" : "cursor-default", className)}>
      <SaveStatusIcon saved={saved} saving={saving} conflict={conflict} attention={Boolean(error)} remote={remote} connectionUnavailable={reconnecting} hostBusy={Boolean(host)} />
      <span className={cn("min-w-0 truncate font-medium tabular-nums", iconOnly ? "sr-only" : compact && "hidden xl:inline")}>{label}</span>
    </button>
  </FastTooltip>;
}
