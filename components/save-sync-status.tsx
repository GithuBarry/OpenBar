"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import { AlarmClock, CircleAlert, CloudOff, Gauge, History, LoaderCircle, LockKeyhole, LockKeyholeOpen, RefreshCw } from "lucide-react";
import { FastTooltip } from "./fast-tooltip";
import { cn } from "@/lib/utils";
import { useProjectWriteSession } from "./project-session/project-write-session";
import { hostBusyDetail } from "@/lib/editor-issue-priority";

export type SaveRemoteState = "checking" | "local" | "pending" | "syncing" | "synced" | "changed" | "blocked" | "unconfigured" | "unavailable" | "failed";
export type StatusPillTone = "danger" | "warn" | "accent";

type FallingZ = {
  id: number;
  x: number;
  y: number;
  dx: number;
  drop: number;
  rot: number;
  size: number;
  delay: number;
  duration: number;
  glyph: "Z" | "z";
  warm: boolean;
};

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
  const [fallingZs, setFallingZs] = useState<FallingZ[]>([]);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const bounceRef = useRef<Animation | null>(null);
  const complaintTimerRef = useRef<number | null>(null);
  const zBurstIdRef = useRef(0);
  const zCleanupTimersRef = useRef<number[]>([]);
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
    for (const timer of zCleanupTimersRef.current) window.clearTimeout(timer);
    zCleanupTimersRef.current = [];
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
      const baseBg = style.backgroundColor;
      const baseColor = style.color;
      const baseShadow = style.boxShadow === "none" ? "0 0 0 0 transparent" : style.boxShadow;
      const base = { backgroundColor: baseBg, color: baseColor, boxShadow: baseShadow };
      const level = Math.min(attentionRequest, 3);
      const peak = level === 1
        ? { backgroundColor: `rgb(${accent} / 0.36)`, color: `rgb(${accentText})`, boxShadow: `inset 0 0 0 1.5px rgb(${accent} / 0.45)` }
        : level === 2
          ? { backgroundColor: `rgb(${accent} / 0.74)`, color: "#fff", boxShadow: `inset 0 0 0 1.5px rgb(${accent} / 0.85)` }
          : { backgroundColor: `rgb(${accent})`, color: "#fff", boxShadow: `inset 0 0 0 1.5px rgb(${accent})` };
      bounceRef.current = button.animate([
        base,
        { ...peak, offset: 0.3 },
        base,
      ], { duration: level === 1 ? 1240 : level === 2 ? 1440 : 1640, easing: "ease-in-out" });
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

      if (session.sleeping && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const rect = button.getBoundingClientRect();
        const burst = ++zBurstIdRef.current;
        const specs = [
          { frac: 0.18, dx: -10, drop: 78, rot: -18, size: 14, delay: 0, duration: 960, glyph: "Z" as const, warm: false },
          { frac: 0.42, dx: 6, drop: 92, rot: 14, size: 11, delay: 95, duration: 1060, glyph: "z" as const, warm: true },
          { frac: 0.68, dx: -6, drop: 84, rot: -12, size: 15, delay: 185, duration: 1020, glyph: "Z" as const, warm: false },
          { frac: 0.3, dx: 9, drop: 72, rot: 20, size: 12, delay: 270, duration: 920, glyph: "z" as const, warm: true },
          { frac: 0.82, dx: 4, drop: 88, rot: -16, size: 13, delay: 340, duration: 1040, glyph: "Z" as const, warm: false },
        ];
        const batch: FallingZ[] = specs.map((spec, index) => ({
          id: burst * 100 + index,
          x: rect.left + rect.width * spec.frac,
          y: rect.bottom - 4,
          dx: spec.dx,
          drop: spec.drop,
          rot: spec.rot,
          size: spec.size,
          delay: spec.delay,
          duration: spec.duration,
          glyph: spec.glyph,
          warm: spec.warm,
        }));
        const ids = new Set(batch.map(item => item.id));
        setFallingZs(current => [...current.slice(-15), ...batch]);
        const timer = window.setTimeout(() => {
          setFallingZs(current => current.filter(item => !ids.has(item.id)));
          zCleanupTimersRef.current = zCleanupTimersRef.current.filter(id => id !== timer);
        }, 1550);
        zCleanupTimersRef.current.push(timer);
      }
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
  return <Popover.Root open={Boolean(complaint)} onOpenChange={open => { if (!open) setComplaint(null); }}>
    <FastTooltip label={`${detail}${canRetry ? "\nClick to retry Git sync." : ""}${altHint}${shiftHint}`}>
    <Popover.Anchor asChild>
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
    </Popover.Anchor>
  </FastTooltip>
    <Popover.Portal>
      <Popover.Content
        side="top"
        align="end"
        sideOffset={10}
        collisionPadding={12}
        className="ob-sleep-bubble"
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}
      >
        <button
          type="button"
          className="ob-sleep-bubble-button"
          role="status"
          onClick={() => {
            setComplaint(null);
            handleClick?.();
          }}
        >
          {complaint}
        </button>
        <Popover.Arrow className="ob-sleep-bubble-arrow" width={12} height={6} />
      </Popover.Content>
    </Popover.Portal>
    {fallingZs.length > 0 && typeof document !== "undefined" && createPortal(
      <div className="ob-falling-z-layer" aria-hidden="true">
        {fallingZs.map(item => (
          <span
            key={item.id}
            className="ob-falling-z"
            data-warm={item.warm || undefined}
            style={{
              left: `${item.x}px`,
              top: `${item.y}px`,
              fontSize: `${item.size}px`,
              animationDelay: `${item.delay}ms`,
              animationDuration: `${item.duration}ms`,
              "--ob-z-dx": `${item.dx}px`,
              "--ob-z-drop": `${item.drop}px`,
              "--ob-z-rot": `${item.rot}deg`,
            } as CSSProperties}
          >
            {item.glyph}
          </span>
        ))}
      </div>,
      document.body,
    )}
  </Popover.Root>;
}
