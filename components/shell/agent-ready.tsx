"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { getWebMcpCatalog, type WebMcpCatalogEntry, type WebMcpSurface } from "@/lib/research/webmcp-register";
import { cn } from "@/lib/utils";

const SURFACE_LABEL: Record<WebMcpSurface, string> = {
  shared: "Read project",
  paper: "Paper",
  mindmap: "Mindmap",
  wiki: "Wiki",
  instructions: "Instructions",
  setup: "Setup",
};

const SURFACE_ORDER: WebMcpSurface[] = ["shared", "paper", "mindmap", "wiki", "instructions", "setup"];

export function AgentReadyIndicator() {
  const [catalog, setCatalog] = useState<WebMcpCatalogEntry[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    const sync = () => {
      void getWebMcpCatalog().then((next) => {
        if (!disposed) setCatalog(next);
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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={cn("ob-agent-ready", ready && "ob-agent-ready-on")}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={ready ? "WebMCP tools on this page" : "Waiting for WebMCP"}
      >
        <span className="ob-agent-ready-dot" aria-hidden="true" />
        {ready ? `Agent ready · ${catalog.length} tools` : "Agent waiting"}
      </button>
      {open && (
        <div className="ob-agent-ready-panel" role="dialog" aria-label="Available WebMCP tools">
          <p className="ob-agent-ready-heading">{ready ? "Available here" : "No tools registered yet"}</p>
          {ready ? (
            grouped.map(({ surface, tools }) => (
              <div key={surface} className="ob-agent-ready-group">
                <p>{SURFACE_LABEL[surface]}</p>
                <ul>
                  {tools.map((tool) => (
                    <li key={tool.name} title={tool.description}>{tool.title}</li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <p className="ob-agent-ready-empty">No WebMCP host is attached. That is normal in Cursor preview.</p>
          )}
        </div>
      )}
    </div>
  );
}
