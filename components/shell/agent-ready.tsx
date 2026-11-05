"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import { PopoverSurface } from "@/components/pop";
import { Bot } from "lucide-react";

import {
  getWebMcpCatalog,
  listWebMcpDiagnostics,
  type WebMcpCatalogEntry,
  type WebMcpDiagnostic,
  type WebMcpSurface,
} from "@/lib/research/webmcp-register";
import { FastTooltip } from "@/components/fast-tooltip";
import { cn } from "@/lib/utils";

const SURFACE_LABEL: Partial<Record<WebMcpSurface, string>> = {
  workspace: "Workspace",
  shared: "Read project",
  paper: "Paper",
  mindmap: "Mindmap",
  instructions: "Instructions",
  wiki: "Wiki",
  setup: "Setup",
};

const SURFACE_ORDER: WebMcpSurface[] = ["workspace", "shared", "paper", "mindmap", "wiki", "instructions", "setup"];

export function AgentReadyIndicator() {
  const [catalog, setCatalog] = useState<WebMcpCatalogEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<WebMcpDiagnostic[]>([]);
  const [open, setOpen] = useState(false);
  const [hostStatus, setHostStatus] = useState("Checking browser WebMCP support…");

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
    const inspectHost = () => {
      const legacyContext = (navigator as Navigator & {
        modelContext?: { registerTool?: unknown };
      }).modelContext;
      setHostStatus(
        !window.isSecureContext
          ? "WebMCP requires a secure browser context. Open this page over HTTPS or localhost."
          : typeof document.modelContext?.registerTool === "function"
            ? "The browser provides document.modelContext. If no tools appear, registration has not completed; reload this page and check for registration errors below."
            : typeof legacyContext?.registerTool === "function"
              ? "This browser provides navigator.modelContext. OpenBar supports this native API and registers tools automatically. Registration diagnostics appear below."
              : "Browser automation can use window.openbarAgent.listTools() and executeTool(name, args). Native WebMCP integrations can enable their browser support and reload.",
      );
    };
    inspectHost();
    const hostTimer = window.setInterval(inspectHost, 1000);
    return () => {
      window.clearInterval(hostTimer);
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
    ? `Agent ready: ${catalog.length} tools${issueCount ? `, ${issueCount} issues` : ""}`
    : issueCount
      ? `Agent issues: ${issueCount}`
      : "Agent waiting";

  return (
    <>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <FastTooltip label={`${statusText}. Connection details`}>
        <Popover.Trigger
          type="button"
          className={cn("ob-agent-ready", ready && "ob-agent-ready-on", issueCount > 0 && "ob-agent-ready-issue")}
          aria-label={`${statusText}. Agent connection details`}
        >
          <span className="ob-agent-ready-dot" aria-hidden="true" />
          <Bot size={16} aria-hidden="true" />
        </Popover.Trigger>
      </FastTooltip>
      {open && (
        <PopoverSurface className="ob-agent-ready-panel" align="end" sideOffset={8} collisionPadding={12} aria-label="MCP and WebMCP agent tools">
          <p className="ob-agent-ready-heading">Tools and agent access</p>
          <Link href="/agents" className="text-xs text-accent underline">How to connect a browser or headless agent</Link>
          <p className="ob-agent-ready-heading mt-3">{statusText}</p>
          {ready ? (
            grouped.map(({ surface, tools }) => (
              <div key={surface} className="ob-agent-ready-group">
                <p>{SURFACE_LABEL[surface] || surface}</p>
                <ul>
                  {tools.map((tool) => (
                    <li key={tool.name} title={tool.description}><code>{tool.name}</code> — {tool.title}</li>
                  ))}
                </ul>
              </div>
            ))
          ) : issueCount === 0 ? (
            <p className="ob-agent-ready-empty">{hostStatus}</p>
          ) : null}
          {ready && (
            <p className="ob-agent-ready-empty">Tools are registered in this page. Agent discovery must be provided by your browser integration; registration does not confirm that an agent is attached.</p>
          )}
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
          <p className="ob-agent-ready-empty">Headless clients connect to <code>/api/mcp</code> with the configured authentication, then call <code>tools/list</code>. Start with <code>get_project_state</code>.</p>
        </PopoverSurface>
      )}
    </Popover.Root>
    </>
  );
}
