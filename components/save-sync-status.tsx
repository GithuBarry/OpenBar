"use client";

import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { FastTooltip } from "./fast-tooltip";
import { cn } from "@/lib/utils";

type RemoteState = "checking" | "pending" | "syncing" | "synced" | "changed" | "blocked" | "unconfigured" | "unavailable" | "failed";

export function SaveSyncStatus({ saved, saving, conflict = false, error, remote, onRetry, compact = false }: {
  saved: boolean;
  saving: boolean;
  conflict?: boolean;
  error?: string | null;
  remote: RemoteState;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const synced = saved && !saving && !conflict && remote === "synced";
  const attention = conflict || remote === "changed" || remote === "blocked" || remote === "unavailable" || remote === "failed";
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
      className={cn("inline-flex min-w-0 items-center gap-1 rounded text-[11px] text-muted", canRetry ? "cursor-pointer hover:text-ink" : "cursor-default")}>
      {conflict ? <CircleAlert size={12} className="shrink-0 text-danger" />
        : saving ? <LoaderCircle size={12} className="shrink-0 animate-spin text-accent" />
          : synced ? <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent" aria-hidden="true">
            <path d="m1 12 5 5L17 6" />
            <path d="m7 12 5 5L23 6" />
          </svg>
            : saved ? <Check size={13} className={cn("shrink-0", attention ? "text-warn" : "text-muted")} />
              : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />}
      {saved && !saving && remote === "syncing" && <LoaderCircle size={11} className="shrink-0 animate-spin text-accent" />}
      <span className={cn("min-w-0 truncate font-medium tabular-nums", compact && "hidden xl:inline")}>{label}</span>
    </button>
  </FastTooltip>;
}
