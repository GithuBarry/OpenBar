"use client";

import { useEffect, useRef, useState } from "react";

export function AgentConnectionAddress() {
  const [address, setAddress] = useState("/api/mcp");
  const [status, setStatus] = useState("Copy URL");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setAddress(new URL("/api/mcp", window.location.href).href), []);
  return <div className="flex min-w-0 items-center gap-2">
    <input ref={input} className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-1 text-xs" aria-label="MCP connection URL" value={address} readOnly onFocus={event => event.currentTarget.select()} />
    <button type="button" className="btn-ghost shrink-0 px-2 py-1 text-xs" aria-label="Copy MCP connection URL" onClick={() => { void (async () => {
      try { await navigator.clipboard.writeText(new URL("/api/mcp", window.location.href).href); setStatus("Copied"); }
      catch { input.current?.focus(); input.current?.select(); setStatus("Select and copy"); }
    })(); }}>{status}</button>
  </div>;
}
