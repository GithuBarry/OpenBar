"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  getWebMcpCatalog,
  listWebMcpDiagnostics,
  type WebMcpCatalogEntry,
  type WebMcpDiagnostic,
  type WebMcpSurface,
} from "@/lib/research/webmcp-register";
import { cn } from "@/lib/utils";

const SURFACE_LABEL: Partial<Record<WebMcpSurface, string>> = {
  workspace: "Workspace",
  shared: "Read project",
  paper: "Paper",
  mindmap: "Mindmap",
  instructions: "Instructions",
  setup: "Setup",
};

const SURFACE_ORDER: WebMcpSurface[] = ["workspace", "shared", "paper", "mindmap", "instructions", "setup"];

export function AgentReadyIndicator() {
  const [catalog, setCatalog] = useState<WebMcpCatalogEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<WebMcpDiagnostic[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let revision = 0;
    const sync = () => {
      const requestRevision = ++revision;
      void getWebMcpCatalog().then((next) => {
        if (disposed || requestRevision !== revision) return;
        setCatalog(next);
        setDiagnostics(listWebMcpDiagnostics());
      });
    };
    sync();
    window.addEventListener("webmcp-ready", sync);
    return () => {
      disposed = true;
      window.removeEventListener("webmcp-ready", sync);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const grouped = useMemo(() => {
    const groups = new Map<WebMcpSurface, WebMcpCatalogEntry[]>();
    for (const entry of catalog) {
      const list = groups.get(entry.surface) || [];
      list.push(entry);
      groups.set(entry.surface, list);
    }
    return SURFACE_ORDER.filter((surface) => groups.has(surface)).map((surface) => ({
      surface,
      tools: groups.get(surface) || [],
    }));
  }, [catalog]);

  const ready = catalog.length > 0;
  const issueCount = diagnostics.length;
  const statusText = ready
    ? `Agent ready · ${catalog.length} tools${issueCount ? ` · ${issueCount} issues` : ""}`
    : issueCount
      ? `Agent issue · ${issueCount}`
      : "Agent waiting";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={cn("ob-agent-ready", ready && "ob-agent-ready-on")}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={issueCount ? "WebMCP registration issues" : ready ? "WebMCP tools on this page" : "Waiting for WebMCP"}
      >
        <span className="ob-agent-ready-dot" aria-hidden="true" />
        {statusText}
      </button>
      {open && (
        <div className="ob-agent-ready-panel" role="dialog" aria-label="Available WebMCP tools">
          <p className="ob-agent-ready-heading">{ready ? "Available here" : "No tools registered yet"}</p>
          {ready ? (
            grouped.map(({ surface, tools }) => (
              <div key={surface} className="ob-agent-ready-group">
                <p>{SURFACE_LABEL[surface] || surface}</p>
                <ul>
                  {tools.map((tool) => (
                    <li key={tool.name} title={tool.description}>{tool.title}</li>
                  ))}
                </ul>
              </div>
            ))
          ) : issueCount === 0 ? (
            <p className="ob-agent-ready-empty">No WebMCP host is attached. That is normal in Cursor preview.</p>
          ) : null}
          {issueCount > 0 && (
            <div className="ob-agent-ready-group">
              <p>Registration issues</p>
              <ul>
                {diagnostics.map((item) => (
                  <li key={`${item.surface}:${item.name}`} title={item.error}>
                    {item.name}: {item.error || "Registration failed"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
