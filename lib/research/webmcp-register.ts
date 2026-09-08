import { failResult } from "./operation-result";

export type WebMcpRegistration = {
  name: string;
  ok: boolean;
  error?: string;
};

export type WebMcpSurface = "workspace" | "shared" | "paper" | "mindmap" | "wiki" | "instructions" | "setup";

export type WebMcpDiagnostic = WebMcpRegistration & {
  surface: WebMcpSurface;
};

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
  registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal; exposedTo?: string[] }) => Promise<void>;
  getTools?: () => Promise<readonly NativeWebMcpTool[]>;
};

declare global {
  interface Document {
    readonly modelContext?: WebMcpModelContext;
  }
}

let navigatorHost: WebMcpModelContext | undefined;
let navigatorAdapter: WebMcpModelContext | undefined;

/** Normalize the native registration API exposed by the current browser. */
export function getBrowserModelContext(): WebMcpModelContext | undefined {
  if (typeof document === "undefined") return undefined;
  if (document.modelContext?.registerTool) return document.modelContext;
  const native = (navigator as Navigator & { modelContext?: WebMcpModelContext }).modelContext;
  if (!native?.registerTool) return undefined;
  if (native === navigatorHost && navigatorAdapter) return navigatorAdapter;
  navigatorHost = native;
  navigatorAdapter = {
    async registerTool(tool, options) {
      await native.registerTool({
        ...tool,
        execute: async (args, executionOptions) => {
          const result = await tool.execute(args, executionOptions);
          return typeof result === "string" ? result : JSON.stringify(result);
        },
      }, options);
    },
    ...(native.getTools ? { getTools: () => native.getTools!() } : {}),
  };
  return navigatorAdapter;
}

type RegistrationOwner = {
  id: symbol;
  active: boolean;
  surface: WebMcpSurface;
};

type LocalCatalogEntry = WebMcpCatalogEntry & { owner: symbol };

const localCatalog = new Map<string, LocalCatalogEntry>();
const localDiagnostics = new Map<symbol, WebMcpDiagnostic[]>();

function unavailableToolResult(name: string) {
  return failResult(
    "capability_unavailable",
    `The ${name} tool belongs to a page that is no longer open. Navigate to that page and retry.`,
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

export function listWebMcpCatalog(): WebMcpCatalogEntry[] {
  return [...localCatalog.values()].map(({ owner: _owner, ...entry }) => entry);
}

export function listWebMcpDiagnostics(): WebMcpDiagnostic[] {
  return [...localDiagnostics.values()].flat();
}

export async function getWebMcpCatalog(): Promise<WebMcpCatalogEntry[]> {
  if (typeof document === "undefined") return [];
  const modelContext = getBrowserModelContext();
  if (!modelContext?.getTools) return listWebMcpCatalog();
  try {
    const tools = await modelContext.getTools();
    const nativeByName = new Map(tools.map((tool) => [tool.name, tool]));
    return listWebMcpCatalog().map((entry) => {
      const native = nativeByName.get(entry.name);
      return {
        ...entry,
        title: native?.title || entry.title,
        description: native?.description || entry.description,
      };
    });
  } catch {
    return listWebMcpCatalog();
  }
}

export function emitWebMcpCatalog(extra?: {
  surface?: WebMcpSurface;
}): void {
  if (typeof window === "undefined") return;
  const catalog = listWebMcpCatalog();
  window.dispatchEvent(new CustomEvent("webmcp-ready", {
    detail: {
      tools: catalog.map((item) => item.name),
      catalog,
      diagnostics: listWebMcpDiagnostics(),
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
  const owner: RegistrationOwner = {
    id: Symbol("webmcp-page"),
    active: true,
    surface,
  };
  const dedupedTools = uniqueTools(tools);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    owner.active = false;
    for (const tool of dedupedTools) {
      if (localCatalog.get(tool.name)?.owner === owner.id) localCatalog.delete(tool.name);
    }
    localDiagnostics.delete(owner.id);
    emitWebMcpCatalog({ surface });
  };
  if (signal.aborted) release();
  else signal.addEventListener("abort", release, { once: true });

  const exposedTo: string[] = JSON.parse(document.querySelector<HTMLMetaElement>('meta[name="openbar-agent-origins"]')?.content || "[]");
  const diagnostics = await Promise.all(
    dedupedTools.map(async (tool): Promise<WebMcpRegistration> => {
      if (signal.aborted) return { name: tool.name, ok: false, error: "aborted" };
      try {
        await modelContext.registerTool({
          ...tool,
          execute: (args, options) => {
            if (!owner.active || signal.aborted) return unavailableToolResult(tool.name);
            return tool.execute(args, options);
          },
        }, { signal, ...(exposedTo.length ? { exposedTo } : {}) });
        if (!owner.active || signal.aborted) return { name: tool.name, ok: false, error: "aborted" };
        localCatalog.set(tool.name, {
          name: tool.name,
          title: tool.title,
          description: tool.description,
          surface,
          owner: owner.id,
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
  if (owner.active) {
    localDiagnostics.set(owner.id, diagnostics
      .filter((item) => !item.ok)
      .map((item) => ({ ...item, surface: owner.surface })));
    emitWebMcpCatalog({ surface });
  }
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
  const available = getBrowserModelContext();
  if (available) return Promise.resolve(available);
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
      const available = getBrowserModelContext();
      if (available) {
        finish(available);
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
