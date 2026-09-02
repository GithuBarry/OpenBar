export type WebMcpRegistration = {
  name: string;
  ok: boolean;
  error?: string;
};

export type WebMcpSurface = "shared" | "paper" | "mindmap" | "wiki" | "instructions" | "setup";

export type WebMcpCatalogEntry = {
  name: string;
  title: string;
  description: string;
  surface: WebMcpSurface;
};

export type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: unknown;
  annotations: { readOnlyHint: boolean; untrustedContentHint?: boolean };
  execute: (args?: unknown, options?: { signal?: AbortSignal }) => Promise<unknown> | unknown;
};

type NativeWebMcpTool = {
  name: string;
  title?: string;
  description: string;
};

export type WebMcpModelContext = {
  registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => Promise<void>;
  getTools?: () => Promise<readonly NativeWebMcpTool[]>;
};

declare global {
  interface Document {
    readonly modelContext?: WebMcpModelContext;
  }
}

type LocalCatalogEntry = WebMcpCatalogEntry & { signal: AbortSignal };

const localCatalog = new Map<string, LocalCatalogEntry>();

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

export function listWebMcpCatalog(): WebMcpCatalogEntry[] {
  return [...localCatalog.values()].map(({ signal: _signal, ...entry }) => entry);
}

export async function getWebMcpCatalog(): Promise<WebMcpCatalogEntry[]> {
  if (typeof document === "undefined") return [];
  const modelContext = document.modelContext;
  if (!modelContext?.getTools) return listWebMcpCatalog();
  try {
    const tools = await modelContext.getTools();
    return tools.map((tool) => ({
      name: tool.name,
      title: tool.title || tool.name,
      description: tool.description,
      surface: localCatalog.get(tool.name)?.surface || "shared",
    }));
  } catch {
    return listWebMcpCatalog();
  }
}

export function emitWebMcpCatalog(extra?: {
  diagnostics?: WebMcpRegistration[];
  surface?: WebMcpSurface;
}): void {
  if (typeof window === "undefined") return;
  const catalog = listWebMcpCatalog();
  window.dispatchEvent(new CustomEvent("webmcp-ready", {
    detail: {
      tools: catalog.map((item) => item.name),
      catalog,
      diagnostics: extra?.diagnostics || [],
      surface: extra?.surface,
    },
  }));
}

export async function registerWebMcpToolsIndependent(
  modelContext: WebMcpModelContext,
  tools: WebMcpTool[],
  signal: AbortSignal,
  surface: WebMcpSurface = "shared",
): Promise<{ registered: string[]; diagnostics: WebMcpRegistration[]; release: () => void }> {
  const dedupedTools = uniqueTools(tools);
  const diagnostics = await Promise.all(
    dedupedTools.map(async (tool): Promise<WebMcpRegistration> => {
      if (signal.aborted) return { name: tool.name, ok: false, error: "aborted" };
      try {
        await modelContext.registerTool(tool, { signal });
        if (signal.aborted) return { name: tool.name, ok: false, error: "aborted" };
        localCatalog.set(tool.name, {
          name: tool.name,
          title: tool.title,
          description: tool.description,
          surface,
          signal,
        });
        return { name: tool.name, ok: true };
      } catch (error) {
        return {
          name: tool.name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  emitWebMcpCatalog({ diagnostics, surface });

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const tool of dedupedTools) {
      if (localCatalog.get(tool.name)?.signal === signal) localCatalog.delete(tool.name);
    }
    emitWebMcpCatalog({ surface });
  };
  signal.addEventListener("abort", release, { once: true });
  return {
    registered: diagnostics.filter((item) => item.ok).map((item) => item.name),
    diagnostics,
    release,
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
