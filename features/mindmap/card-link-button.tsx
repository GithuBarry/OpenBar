"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, Link2 } from "lucide-react";
import { FastTooltip } from "@/components/fast-tooltip";
import { copyText } from "@/lib/copy-text";
import { artifactHref } from "@/lib/research/artifact-link";

export function CardLinkButton({ project, mapId, nodeId, className }: { project: string; mapId: string; nodeId: string; className?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);
  const label = status === "copied" ? "Card link copied" : status === "error" ? "Copy failed. Click to retry" : "Copy card link";
  const Icon = status === "copied" ? Check : status === "error" ? AlertCircle : Link2;
  const copy = async () => {
    try {
      await copyText(new URL(artifactHref(project, { kind: "mindmap-node", id: nodeId, mapId }), window.location.origin).href);
      setStatus("copied");
    } catch { setStatus("error"); }
  };
  return <>
    <FastTooltip label={label}><button type="button" className={className} aria-label="Copy card link" onPointerDown={event => event.preventDefault()} onClick={() => { void copy(); }}><Icon size={13} aria-hidden="true" /></button></FastTooltip>
    <span className="sr-only" role="status">{status === "idle" ? "" : label}</span>
  </>;
}
