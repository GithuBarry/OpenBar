"use client";

import { useEffect, useRef, useState } from "react";
import { AlarmClock, CircleAlert, CloudOff, Gauge, History, LoaderCircle, LockKeyhole, LockKeyholeOpen, RefreshCw } from "lucide-react";
import { FastTooltip } from "./fast-tooltip";
import { cn } from "@/lib/utils";
import { useProjectWriteSession } from "./project-session/project-write-session";
import { hostBusyDetail } from "@/lib/editor-issue-priority";

export type SaveRemoteState = "checking" | "local" | "pending" | "syncing" | "synced" | "changed" | "blocked" | "unconfigured" | "unavailable" | "failed";
export type StatusPillTone = "danger" | "warn" | "accent";

export function SleepZzz({ size = 16, animated = true }: { size?: number; animated?: boolean }) {
  const zSvg = <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0", animated && "ob-sleep-zzz")} aria-hidden="true">
    <path className="ob-sleep-z1" d="M3 12h8l-8 8h8" />
    <path className="ob-sleep-z2" d="M14 4h6l-6 6h6" />
  </svg>;
  if (!animated) return zSvg;
  return <span className="ob-sleep-wake" aria-hidden="true">
    <span className="ob-sleep-wake-zzz">{zSvg}</span>
    <span className="ob-sleep-wake-alarm"><AlarmClock size={size} strokeWidth={2} /></span>
  </span>;
}

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

export function SaveSyncStatus({ saved, saving, conflict = false, error, remote, onRetry, onForceSync, compact = false, iconOnly = false, className, onConnectionIssue, hasRecoveryDraft = false, onRecoveryDraft, attentionRequest = 0 }: {
  saved: boolean;
  saving: boolean;
  conflict?: boolean;
  error?: string | null;
  remote: SaveRemoteState;
  onRetry?: () => void;
  onForceSync?: () => void;
  compact?: boolean;
  iconOnly?: boolean;
  className?: string;
  onConnectionIssue?: () => void;
  hasRecoveryDraft?: boolean;
  onRecoveryDraft?: () => void;
  attentionRequest?: number;
}) {
  const session = useProjectWriteSession();
  const reconnecting = session.connectionState === "reconnecting";
  const host = !reconnecting && !conflict && !error && !["changed", "blocked", "unavailable", "failed"].includes(remote)
    ? hostBusyDetail(session.hostResources) : null;
  const synced = saved && !saving && !conflict && remote === "synced";
  const review = remote === "changed" || remote === "blocked";
  const remoteError = remote === "unavailable" || remote === "failed";
  const readOnlyRestorable = !reconnecting && !session.writable && session.canRestore;
  const readOnlyLocked = !reconnecting && !session.writable && !session.canRestore;

  // Morph into an unmistakable tinted glass pill on attention states; stay compact 34x34 when calm.
  let pillCue: string | null = null;
  let pillTone: StatusPillTone | undefined;
  let customIcon: React.ReactNode = null;
  if (reconnecting) {
    pillCue = "Offline";
    pillTone = "warn";
  } else if (hasRecoveryDraft) {
    pillCue = "Draft";
    pillTone = "accent";
    customIcon = <History size={15} className="shrink-0" />;
  } else if (conflict) {
    pillCue = "Conflict";
    pillTone = "danger";
  } else if (review || remoteError) {
    pillCue = review ? "Sync Git" : "Git error";
    pillTone = remoteError ? "danger" : "warn";
  } else if (readOnlyRestorable) {
    pillCue = "Resume";
    pillTone = "accent";
    customIcon = session.sleeping ? <SleepZzz size={16} /> : <LockKeyholeOpen size={15} className="shrink-0" />;
  } else if (readOnlyLocked) {
    pillCue = "View only";
    pillTone = "warn";
    customIcon = <LockKeyhole size={15} className="shrink-0" />;
  } else if (error) {
    pillCue = "Save error";
    pillTone = "danger";
  }

  const label = pillCue || (host ? "Host busy"
    : saving ? "Saving…"
      : !saved ? "Unsaved changes"
        : synced ? "Synced to Git"
          : remote === "checking" ? "Checking Git…"
            : remote === "syncing" ? "Syncing to Git…"
              : remote === "pending" ? "Waiting for Git sync"
                : "Saved locally");
  const detail = [
    reconnecting ? "Reconnecting to OpenBar. Your edits remain in this tab." : host,
    readOnlyRestorable ? "Click Resume to continue editing in this tab." : readOnlyLocked ? "Viewing read-only." : null,
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
  const [retainedCue, setRetainedCue] = useState<string>("");
  const [complaint, setComplaint] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const bounceRef = useRef<Animation | null>(null);
  const complaintTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (pillCue) setRetainedCue(pillCue);
  }, [pillCue]);
  useEffect(() => {
    if (session.writable || !attentionRequest) {
      setComplaint(null);
      if (complaintTimerRef.current) {
        window.clearTimeout(complaintTimerRef.current);
        complaintTimerRef.current = null;
      }
    }
  }, [session.writable, attentionRequest]);
  useEffect(() => () => {
    bounceRef.current?.cancel();
    if (complaintTimerRef.current) window.clearTimeout(complaintTimerRef.current);
  }, []);
  useEffect(() => {
    const button = buttonRef.current;
    if (!attentionRequest || !button) return;
    bounceRef.current?.cancel();
    bounceRef.current = null;

    if (typeof button.animate === "function") {
      const style = getComputedStyle(button);
      const accent = style.getPropertyValue("--accent").trim() || "120 94 240";
      const accentText = style.getPropertyValue("--accent-text").trim() || accent;
      const warn = style.getPropertyValue("--warn").trim() || "254 97 0";
      const baseBg = style.backgroundColor;
      const baseColor = style.color;
      const baseShadow = style.boxShadow === "none" ? "0 0 0 0 transparent" : style.boxShadow;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const base = { backgroundColor: baseBg, color: baseColor, boxShadow: baseShadow };

      if (reduced) {
        const tone = attentionRequest >= 2 ? warn : accent;
        bounceRef.current = button.animate([
          base,
          { backgroundColor: `rgb(${tone} / ${attentionRequest >= 3 ? 0.55 : 0.32})`, color: attentionRequest >= 3 ? "#fff" : `rgb(${tone})`, boxShadow: `0 0 0 4px rgb(${tone} / 0.5)`, offset: 0.25 },
          base,
        ], { duration: 900, easing: "ease-out" });
      } else if (attentionRequest === 1) {
        bounceRef.current = button.animate([
          base,
          { backgroundColor: `rgb(${accent} / 0.42)`, color: `rgb(${accentText})`, boxShadow: `0 0 0 4px rgb(${accent} / 0.46), 0 0 22px rgb(${accent} / 0.36)`, offset: 0.28 },
          base,
        ], { duration: 760, easing: "ease-out" });
      } else if (attentionRequest === 2) {
        const peak = { backgroundColor: `rgb(${warn} / 0.5)`, color: `rgb(${warn})`, boxShadow: `0 0 0 5px rgb(${warn} / 0.58), 0 0 28px rgb(${warn} / 0.44)` };
        const dip = { backgroundColor: `rgb(${warn} / 0.16)`, color: `rgb(${warn})`, boxShadow: `0 0 0 2px rgb(${warn} / 0.22)` };
        bounceRef.current = button.animate([
          base,
          { ...peak, offset: 0.22 },
          { ...dip, offset: 0.46 },
          { ...peak, boxShadow: `0 0 0 6px rgb(${warn} / 0.64), 0 0 32px rgb(${warn} / 0.5)`, offset: 0.7 },
          base,
        ], { duration: 1050, easing: "ease-in-out" });
      } else {
        const strong = { backgroundColor: `rgb(${warn})`, color: "#fff", boxShadow: `0 0 0 8px rgb(${warn} / 0.68), 0 0 38px rgb(${warn} / 0.58)` };
        const mid = { backgroundColor: `rgb(${warn} / 0.24)`, color: `rgb(${warn})`, boxShadow: `0 0 0 2px rgb(${warn} / 0.28)` };
        bounceRef.current = button.animate([
          base,
          { ...strong, offset: 0.14 },
          { ...mid, offset: 0.32 },
          { ...strong, offset: 0.5 },
          { ...mid, offset: 0.68 },
          { ...strong, offset: 0.82 },
          base,
        ], { duration: 1350, easing: "ease-in-out" });
      }
    }

    if (attentionRequest >= 3) {
      const message = session.sleeping
        ? attentionRequest === 3
          ? "Still napping — click to wake me up"
          : attentionRequest === 4
            ? "Hey, I’m asleep over here — wake me up first"
            : "Five more minutes… or click me to edit"
        : readOnlyRestorable
          ? "Editing in another tab — click to take over"
          : "Read-only right now";
      setComplaint(message);
      if (complaintTimerRef.current) window.clearTimeout(complaintTimerRef.current);
      complaintTimerRef.current = window.setTimeout(() => {
        setComplaint(null);
        complaintTimerRef.current = null;
      }, 4500);
    }
  }, [attentionRequest, session.sleeping, readOnlyRestorable]);
  const displayCue = pillCue || retainedCue;

  const canRetry = !reconnecting && !host && saved && !saving && !conflict && ["pending", "blocked", "unavailable", "failed"].includes(remote) && !!onRetry;
  const canOpenConnection = reconnecting && Boolean(onConnectionIssue);
  const handleClick = canOpenConnection
    ? onConnectionIssue
    : hasRecoveryDraft && onRecoveryDraft
      ? onRecoveryDraft
      : readOnlyRestorable
        ? () => void session.restore()
        : canRetry
          ? onRetry
          : undefined;
  const interactive = Boolean(handleClick || onForceSync || session.canRelease);
  const altHint = onForceSync ? "\n⌥-click: Sync Git now" : "";
  const shiftHint = session.canRelease ? "\n⇧-click: Release edit access" : "";
  return <span className="ob-status-anchor">
    {complaint && (
      <button
        type="button"
        className="ob-sleep-bubble"
        role="status"
        onClick={() => {
          setComplaint(null);
          handleClick?.();
        }}
      >
        {complaint}
      </button>
    )}
    <FastTooltip label={`${detail}${canRetry ? "\nClick to retry Git sync." : ""}${altHint}${shiftHint}`}>
    <button ref={buttonRef} type="button" onClick={(event) => {
      setComplaint(null);
      if (event.shiftKey && session.canRelease) { event.preventDefault(); void session.release(); return; }
      if (event.altKey && onForceSync) { event.preventDefault(); onForceSync(); return; }
      handleClick?.();
    }}
      aria-label={label} aria-disabled={!interactive}
      data-editor-notice={reconnecting || undefined}
      data-status-tone={pillTone}
      data-attention={attentionRequest > 0 ? attentionRequest : undefined}
      data-save-stage={synced ? "remote" : saved ? remote === "pending" || remote === "syncing" ? "queued" : "local" : "unsaved"}
      className={cn("inline-flex min-w-0 items-center text-[11px] text-muted", !iconOnly && "gap-1.5", interactive ? "cursor-pointer hover:text-ink" : "cursor-default", className)}>
      <span className="ob-mod-swap" aria-hidden="true">
        <span className="ob-mod-primary">{customIcon || <SaveStatusIcon saved={saved} saving={saving} conflict={conflict} attention={Boolean(error)} remote={remote} connectionUnavailable={reconnecting} hostBusy={Boolean(host)} />}</span>
        {onForceSync && <span className="ob-mod-alt"><RefreshCw size={15} /></span>}
        {session.canRelease && <span className="ob-mod-shift"><SleepZzz size={16} animated={false} /></span>}
      </span>
      {iconOnly ? (
        <span className="ob-status-label-track" data-open={pillCue ? "true" : "false"} aria-hidden={!pillCue}>
          <span className="ob-status-label-inner">{displayCue}</span>
        </span>
      ) : (
        <span className={cn("min-w-0 truncate font-semibold tabular-nums", pillCue ? "inline" : compact && "hidden xl:inline")}>{label}</span>
      )}
    </button>
  </FastTooltip>
  </span>;
}
