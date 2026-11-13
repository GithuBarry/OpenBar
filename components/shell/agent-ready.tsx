"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { requestInbox, useInboxProject } from "@/features/use-inbox-webmcp";
import { useAgentInbox } from "@/features/use-agent-inbox";
import type { InboxNotification } from "@/lib/research/agent-inbox-contract";

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
  const project = useInboxProject();
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
      setHostStatus(
        !window.isSecureContext
          ? "WebMCP requires a secure browser context. Open this page over HTTPS or localhost."
          : typeof document.modelContext?.registerTool === "function"
            ? "The browser provides document.modelContext. If no tools appear, registration has not completed; reload this page and check for registration errors below."
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
          <AgentInboxPanel project={project} />
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

function AgentInboxPanel({ project }: { project?: string }) {
  const [includeAcknowledged, setIncludeAcknowledged] = useState(false);
  const query = useAgentInbox(project, includeAcknowledged);
  const acknowledgement = useMutation({
    mutationFn: async (notification: InboxNotification) => {
      const result = await requestInbox("POST", notification.project, {
        ids: [notification.id], acknowledged: !notification.acknowledged,
      });
      if (!result.ok) throw new Error(result.message);
      return result.value;
    },
    onSuccess: () => window.dispatchEvent(new Event("openbar-inbox-updated")),
  });
  useEffect(() => acknowledgement.reset(), [project, includeAcknowledged, acknowledgement.reset]);
  const inbox = query.data;
  const busy = query.isFetching || acknowledgement.isPending;
  const error = acknowledgement.error?.message || query.error?.message;
  const refresh = () => {
    acknowledgement.reset();
    void query.refetch();
  };

  return <section className="mt-3 border-b border-line pb-3" aria-label="Agent inbox" data-agent-inbox>
    <div className="flex items-center justify-between gap-2">
      <p className="ob-agent-ready-heading">Agent inbox</p>
      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => { void refresh(); }} disabled={busy}>Refresh</button>
    </div>
    <p className="ob-agent-ready-empty">Ask your agent “check updates” to read your mindmap mentions.</p>
    <label className="my-2 flex items-center gap-2 text-xs text-muted">
      <input type="checkbox" checked={includeAcknowledged} disabled={busy} onChange={(event) => setIncludeAcknowledged(event.target.checked)} />
      Include handled messages
    </label>
    {error && <p className="text-xs text-danger" role="alert">{error}</p>}
    {busy && <p className="ob-agent-ready-empty" role="status">Checking updates…</p>}
    {inbox && <>
      {inbox.notifications.length === 0 && <p className="ob-agent-ready-empty">Your inbox is clear.</p>}
      <ul className="max-h-60 space-y-2 overflow-y-auto" aria-label="Mindmap messages">
        {inbox.notifications.map((notification) => <li key={notification.id} className="rounded-md border border-line p-2" data-inbox-notification={notification.id} data-acknowledged={notification.acknowledged}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted">
            <span>{notification.project}</span><span>{notification.acknowledged ? "Handled" : "Pending"}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-xs leading-snug">{notification.text}</p>
          <div className="mt-2 flex items-center justify-between gap-2 text-xs">
            <Link href={notification.href} className="text-accent underline">Open card</Link>
            <button type="button" className="btn-ghost px-2 py-1" disabled={busy} onClick={() => acknowledgement.mutate(notification)}>{notification.acknowledged ? "Reopen" : "Mark handled"}</button>
          </div>
        </li>)}
      </ul>
      {inbox.hasMore && <p className="ob-agent-ready-empty mt-2">More messages are available. Handle the pending messages and refresh.</p>}
    </>}
  </section>;
}
