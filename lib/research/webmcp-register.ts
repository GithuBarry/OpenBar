import { failResult } from "./operation-result";

export type WebMcpRegistration = {
  name: string;
  ok: boolean;
  error?: string;
};

type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: unknown;
  annotations: { readOnlyHint: boolean; untrustedContentHint?: boolean };
  execute: (args?: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>;
};

type RegisteredTool = {
  owner: symbol;
  tool: WebMcpTool;
};

type WebMcpRegistry = {
  active: Map<string, RegisteredTool>;
  registered: Set<string>;
  pending: Map<string, Promise<void>>;
};

type GlobalWebMcp = typeof globalThis & {
  __openBarryWebMcpRegistry?: WebMcpRegistry;
};

function registry(): WebMcpRegistry {
  const root = globalThis as GlobalWebMcp;
  if (!root.__openBarryWebMcpRegistry) {
    root.__openBarryWebMcpRegistry = {
      active: new Map(),
      registered: new Set(),
      pending: new Map(),
    };
  }
  return root.__openBarryWebMcpRegistry;
}

function unavailableToolResult(name: string) {
  return failResult(
    "capability_unavailable",
    `The ${name} tool belongs to a page that is no longer open. Call get_project_state, then navigate_project to the relevant location, then retry.`,
    { retryable: true },
  );
}

function uniqueTools(tools: WebMcpTool[]): WebMcpTool[] {
  const seen = new Set<string>();
  const result: WebMcpTool[] = [];
  for (const tool of tools) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    result.push(tool);
  }
  return result;
}

export async function registerWebMcpToolsIndependent(
  registerTool: (tool: {
    name: string;
    title?: string;
    description: string;
    inputSchema?: unknown;
    annotations?: { readOnlyHint?: boolean };
    execute: (args?: unknown, options?: { signal?: AbortSignal }) => Promise<unknown> | unknown;
  }, options?: { signal?: AbortSignal }) => Promise<void>,
  tools: WebMcpTool[],
  signal: AbortSignal,
): Promise<{ registered: string[]; diagnostics: WebMcpRegistration[]; release: () => void }> {
  const owner = Symbol("webmcp-page");
  const current = registry();
  // Page-owned builders come before generic shared fallbacks. Keep their first
  // definition so one browser tool name has one live handler and one diagnostic.
  const dedupedTools = uniqueTools(tools);
  const diagnostics = await Promise.all(
    dedupedTools.map(async (tool): Promise<WebMcpRegistration> => {
      if (signal.aborted) return { name: tool.name, ok: false, error: "aborted" };
      current.active.set(tool.name, { owner, tool });
      if (current.registered.has(tool.name)) return { name: tool.name, ok: true };
      try {
        let pending = current.pending.get(tool.name);
        if (!pending) {
          pending = registerTool(
            {
              name: tool.name,
              title: tool.title,
              description: tool.description,
              inputSchema: tool.inputSchema,
              annotations: tool.annotations,
              execute: (args, options) => {
                const active = registry().active.get(tool.name);
                return active ? active.tool.execute(args, options) : unavailableToolResult(tool.name);
              },
          });
          current.pending.set(tool.name, pending);
        }
        await pending;
        current.registered.add(tool.name);
        return { name: tool.name, ok: true };
      } catch (error) {
        current.registered.delete(tool.name);
        return {
          name: tool.name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        current.pending.delete(tool.name);
      }
    }),
  );
  return {
    registered: diagnostics.filter((item) => item.ok).map((item) => item.name),
    diagnostics,
    release: () => {
      for (const tool of dedupedTools) {
        if (current.active.get(tool.name)?.owner === owner) current.active.delete(tool.name);
      }
    },
  };
}

export function waitForModelContext(
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<NonNullable<Document["modelContext"]> | null> {
  if (typeof document === "undefined") return Promise.resolve(null);
  if (document.modelContext?.registerTool) return Promise.resolve(document.modelContext);
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const events = ["load", "model-context", "modelcontextavailable"];
    const finish = (value: NonNullable<Document["modelContext"]> | null) => {
      if (settled) return;
      settled = true;
      window.clearInterval(timer);
      for (const event of events) document.removeEventListener(event, check);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const check = () => {
      if (document.modelContext?.registerTool) {
        finish(document.modelContext);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        finish(null);
      }
    };
    const abort = () => finish(null);
    const timer = window.setInterval(check, 250);
    for (const event of events) document.addEventListener(event, check);
    signal?.addEventListener("abort", abort, { once: true });
    check();
  });
}
