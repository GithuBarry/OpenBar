import type { InboxEventTarget } from "@/lib/research/agent-inbox-events";

type Listener = { target: InboxEventTarget; scope?: readonly string[]; signal: AbortSignal };

// The MCP and status routes may be bundled separately by Next.js.
const key = Symbol.for("openbar.mcp-event-listeners");
const runtime = globalThis as typeof globalThis & { [key]?: Set<Listener> };
const listeners = runtime[key] ??= new Set<Listener>();

export function trackMcpListener(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function countMcpListeners(project?: string): number {
  let count = 0;
  for (const { target, scope, signal } of listeners) {
    if (signal.aborted) continue;
    if (project !== undefined) {
      if (scope && !scope.includes(project)) continue;
      if (typeof target === "string" ? target !== project
        : target.kind === "single" ? target.project !== project
        : target.kind === "subset" && !target.projects.includes(project)) continue;
    }
    count++;
  }
  return count;
}
