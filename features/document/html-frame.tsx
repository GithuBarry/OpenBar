"use client";

import { useMemo } from "react";

import { htmlFrameCapabilities, htmlFrameCsp, htmlFrameSandbox, stripScripts, type HtmlMode } from "@/lib/html-policy";

export function HtmlDocumentFrame({
  html,
  mode,
  capabilities,
  compact = false,
}: {
  html: string;
  mode: HtmlMode;
  capabilities?: string[];
  compact?: boolean;
}) {
  const sandbox = htmlFrameSandbox(mode);
  const csp = htmlFrameCsp(mode);
  const granted = capabilities ?? htmlFrameCapabilities(mode);
  const body = mode === "static" ? stripScripts(html) : html;
  const srcDoc = useMemo(
    () => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${body}</body></html>`,
    [body, csp],
  );
  return (
    <div className={compact ? "space-y-1" : "space-y-2"}>
      <div className={compact ? "flex flex-wrap items-center gap-1 text-[10px] text-muted" : "flex flex-wrap items-center gap-2 text-[11px] text-muted"}>
        <span className="rounded-full border border-line px-2 py-0.5">HTML · {mode}</span>
        {!compact && <span>{mode === "interactive" ? "Scripts allowed (opaque origin)" : "Scripts omitted"}</span>}
        {granted.map((item) => (
          <span key={item} className="rounded-full border border-line px-2 py-0.5">{item}</span>
        ))}
      </div>
      <iframe
        title="HTML document"
        sandbox={sandbox}
        srcDoc={srcDoc}
        referrerPolicy="no-referrer"
        className={compact
          ? "h-24 min-h-[5rem] w-full rounded border border-line bg-surface"
          : "min-h-[24rem] w-full rounded-lg border border-line bg-surface"}
      />
    </div>
  );
}
