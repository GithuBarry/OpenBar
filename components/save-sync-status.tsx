"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import { FastTooltip } from "./fast-tooltip";
import { cn } from "@/lib/utils";

type RemoteState = "checking" | "pending" | "syncing" | "synced" | "changed" | "blocked" | "unconfigured" | "unavailable" | "failed";

/** Each check reports its own save destination. */
export function SaveChecks({ saved, synced, size = 14 }: { saved: boolean; synced: boolean; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
    <path d="m1 12 5 5L17 6" stroke={`rgb(var(--${saved ? "accent" : "muted"}))`} />
    <path d="m7 12 5 5L23 6" stroke={`rgb(var(--${saved ? synced ? "accent" : "ink" : "muted"}))`} />
  </svg>;
}

export function SaveSyncStatus({ saved, saving, conflict = false, error, remote, onRetry, compact = false, iconOnly = false, className }: {
  saved: boolean;
  saving: boolean;
  conflict?: boolean;
  error?: string | null;
  remote: RemoteState;
  onRetry?: () => void;
  compact?: boolean;
  iconOnly?: boolean;
  className?: string;
}) {
  const synced = saved && !saving && !conflict && remote === "synced";
  const review = remote === "changed" || remote === "blocked";
  const remoteError = remote === "unavailable" || remote === "failed";
  const label = conflict ? "Save conflict"
    : saving ? "Saving…"
      : !saved ? "Unsaved changes"
        : synced ? "Synced to Git"
          : remote === "checking" ? "Checking Git…"
            : remote === "syncing" ? "Syncing to Git…"
              : remote === "changed" || remote === "blocked" ? "Git needs review"
                : remote === "unavailable" ? "Git unavailable"
                  : remote === "failed" ? "Git sync failed"
                    : "Saved locally";
  const detail = [
    saved ? "Saved to project files." : "Saving your latest edits to project files.",
    synced ? "The saved changes are confirmed on the Git remote."
      : remote === "unconfigured" ? "Connect an Overleaf repository to enable Git synchronization."
      : remote === "checking" ? "Checking the latest Git status."
        : remote === "syncing" ? "Uploading the saved changes to Git."
          : "The saved changes are waiting for Git synchronization.",
    error,
  ].filter(Boolean).join("\n");
  const canRetry = saved && !saving && !conflict && ["pending", "blocked", "unavailable", "failed"].includes(remote) && !!onRetry;
  return <FastTooltip label={`${detail}${canRetry ? "\nClick to retry Git sync." : ""}`}>
    <button type="button" onClick={canRetry ? onRetry : undefined}
      aria-label={label} aria-disabled={!canRetry} data-save-stage={synced ? "remote" : saved ? "local" : "unsaved"}
      className={cn("inline-flex min-w-0 items-center gap-1 rounded text-[11px] text-muted", canRetry ? "cursor-pointer hover:text-ink" : "cursor-default", className)}>
      {conflict ? <CircleAlert size={12} className="shrink-0 text-[rgb(var(--danger))]" />
        : saving ? <LoaderCircle size={12} className="shrink-0 animate-spin text-accent" />
          : !saved ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
          : remote === "checking" || remote === "syncing" ? <LoaderCircle size={12} className="shrink-0 animate-spin text-accent" />
              : review || remoteError ? <CircleAlert size={12} className={cn("shrink-0", remoteError ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--warn))]")} />
                : <SaveChecks saved={saved} synced={synced} />}
      <span className={cn("min-w-0 truncate font-medium tabular-nums", iconOnly ? "sr-only" : compact && "hidden xl:inline")}>{label}</span>
    </button>
  </FastTooltip>;
}
