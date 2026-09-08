/**
 * Wiki WebMCP tools.
 */

import { failResult, okResult, type OperationResult } from "./operation-result";
import { DOCUMENT_WEBMCP_SCHEMAS, DOCUMENT_WEBMCP_TOOL_NAMES } from "./mcp-tool-schemas";
import { parseWebMcpArgs, unknownWebMcpArgument, type JsonSchemaObject, type PaperWebMcpTool } from "./webmcp-paper-contract";
import type { SharedWebMcpActions, CurrentLocation } from "./webmcp-shared-contract";

export { DOCUMENT_WEBMCP_TOOL_NAMES };

export type DocumentWebMcpActions = {
  readDocument: (project: string, kind: "wiki", id: string) => Promise<{ hash: string } | null>;
  patchDocument: (project: string, kind: "wiki", id: string, baseHash: string, body: string) => Promise<{ hash: string }>;
  patchWikiPage: (
    project: string,
    id: string,
    baseHash: string,
    body: string,
    metadata: unknown,
  ) => Promise<{ hash: string } | { page: unknown; hash: string }>;
  renderPreview: (project: string, kind: "wiki", id: string) => Promise<unknown>;
  createWikiPage?: (project: string, slug: string, title: string, body?: string) => Promise<unknown>;
  deleteWikiPage?: (project: string, slug: string, stateHash: string) => Promise<unknown>;
  renameWikiPage?: (project: string, from: string, to: string, stateHash: string) => Promise<{ slug: string }>;
};

export type DocumentWebMcpHost = {
  project: string;
  kind: "wiki";
  documentId: string;
  actions: DocumentWebMcpActions;
  sharedActions: SharedWebMcpActions;
  refresh?: () => void;
  navigate?: (href: string) => void;
  current?: () => CurrentLocation | undefined;
};

const WIKI_PAGE_TOOLS = ["update_wiki_page", "delete_wiki_page", "rename_wiki_page"] as const;
const WIKI_INDEX_TOOLS = ["create_wiki_page"] as const;
type DocumentWebMcpToolName =
  | (typeof DOCUMENT_WEBMCP_TOOL_NAMES)[number]
  | (typeof WIKI_PAGE_TOOLS)[number]
  | (typeof WIKI_INDEX_TOOLS)[number];

const WIKI_UPDATE_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    id: { type: "string" },
    baseHash: { type: "string" },
    body: { type: "string" },
    title: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["id", "baseHash", "body"],
  additionalProperties: false,
};

const WIKI_CREATE_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    title: { type: "string" },
    slug: { type: "string" },
    body: { type: "string" },
  },
  required: ["title"],
  additionalProperties: false,
};

const WIKI_DELETE_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: { id: { type: "string" }, baseHash: { type: "string" } },
  required: ["id", "baseHash"],
  additionalProperties: false,
};

const WIKI_RENAME_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: { id: { type: "string" }, to: { type: "string" }, baseHash: { type: "string" } },
  required: ["id", "to", "baseHash"],
  additionalProperties: false,
};

function schemaFor(name: DocumentWebMcpToolName): JsonSchemaObject {
  if (name === "update_wiki_page") return WIKI_UPDATE_SCHEMA;
  if (name === "create_wiki_page") return WIKI_CREATE_SCHEMA;
  if (name === "delete_wiki_page") return WIKI_DELETE_SCHEMA;
  if (name === "rename_wiki_page") return WIKI_RENAME_SCHEMA;
  return DOCUMENT_WEBMCP_SCHEMAS[name]!;
}

function wikiSlug(title: string, slug?: string): string {
  const raw = (slug || title).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return raw || "page";
}

export function buildDocumentWebMcpTools(host: DocumentWebMcpHost): PaperWebMcpTool[] {
  const wiki = host.kind === "wiki";
  const names: DocumentWebMcpToolName[] = wiki
    ? host.documentId
      ? [...DOCUMENT_WEBMCP_TOOL_NAMES, ...WIKI_PAGE_TOOLS, ...WIKI_INDEX_TOOLS]
      : [...WIKI_INDEX_TOOLS]
    : [...DOCUMENT_WEBMCP_TOOL_NAMES];
  return names.map((name) => ({
    name,
    title: name.replaceAll("_", " "),
    description: name === "create_wiki_page"
      ? "Create a Markdown wiki page. Actionable work still belongs in paper TODOs."
      : name === "delete_wiki_page"
        ? "Delete the open wiki page."
        : name === "rename_wiki_page"
          ? "Rename the open wiki page slug."
          : `Primary ${host.kind} document operation ${name}. Project and document are fixed by the open page.`,
    inputSchema: schemaFor(name),
    annotations: {
      readOnlyHint: name === "read_document" || name === "render_preview",
      untrustedContentHint: true,
    },
    execute: (args) => executeDocumentWebMcpTool(host, name, args),
  }));
}

async function executeDocumentWebMcpTool(
  host: DocumentWebMcpHost,
  name: DocumentWebMcpToolName,
  rawArgs: unknown,
): Promise<OperationResult<unknown>> {
  const parsedArgs = parseWebMcpArgs(rawArgs);
  if (!parsedArgs.ok) return failResult("invalid_arguments", parsedArgs.message, { retryable: false });
  const args = parsedArgs.value;
  const schema = schemaFor(name);
  const unknown = unknownWebMcpArgument(args, schema);
  if (unknown) return failResult("invalid_arguments", `Unknown argument "${unknown}".`, { retryable: false });
  if (args.kind !== undefined && (typeof args.kind !== "string" || args.kind !== host.kind)) {
    return failResult("invalid_arguments", `kind must match the open ${host.kind} page.`, { retryable: false });
  }
  try {
    if (name === "create_wiki_page") {
      if (host.kind !== "wiki") return failResult("capability_unavailable", "Open a wiki page to create wiki pages.", false);
      if (!host.actions.createWikiPage) {
        return failResult("capability_unavailable", "Wiki create is unavailable on this page.", false);
      }
      if (typeof args.title !== "string" || !args.title.trim()) {
        return failResult("invalid_arguments", "title is required.", false);
      }
      const slug = wikiSlug(args.title, typeof args.slug === "string" ? args.slug : undefined);
      const created = await host.actions.createWikiPage(
        host.project,
        slug,
        args.title.trim(),
        typeof args.body === "string" ? args.body : "",
      );
      host.navigate?.(`/p/${host.project}/wiki/${encodeURIComponent(slug)}`);
      host.refresh?.();
      return okResult(created);
    }

    if (typeof args.id !== "string" || !args.id.trim()) {
      return failResult("invalid_arguments", "id must be a non-empty string.", { retryable: false });
    }
    if (host.documentId && args.id !== host.documentId) {
      return failResult("invalid_arguments", `id must match the open ${host.kind} document.`, { retryable: false });
    }
    const kind = host.kind;
    const id = args.id;

    switch (name) {
      case "read_document": {
        const document = await host.actions.readDocument(host.project, kind, id);
        if (!document) return failResult("invalid_path", `Unknown ${kind} document "${id}".`, { retryable: false });
        return okResult(document, { diskHash: document.hash });
      }
      case "render_preview":
        return okResult(await host.actions.renderPreview(host.project, kind, id));
      case "patch_document": {
        if (typeof args.baseHash !== "string" || !args.baseHash) {
          return failResult("invalid_arguments", "baseHash must be a non-empty string.", { retryable: false });
        }
        if (typeof args.body !== "string") {
          return failResult("invalid_arguments", "body must be a string.", { retryable: false });
        }
        const next = await host.actions.patchDocument(
          host.project,
          kind,
          id,
          args.baseHash,
          args.body,
        );
        host.refresh?.();
        return okResult(next, { diskHash: next.hash });
      }
      case "update_wiki_page": {
        if (host.kind !== "wiki") return failResult("capability_unavailable", "Open a wiki page to update wiki metadata.", false);
        if (typeof args.baseHash !== "string" || !args.baseHash || typeof args.body !== "string") {
          return failResult("invalid_arguments", "baseHash and body are required.", false);
        }
        const metadata: Record<string, unknown> = {};
        if (typeof args.title === "string") metadata.title = args.title;
        if (Array.isArray(args.tags)) metadata.tags = args.tags;
        const next = await host.actions.patchWikiPage(host.project, id, args.baseHash, args.body, metadata);
        host.refresh?.();
        const hash = "hash" in next ? next.hash : undefined;
        return okResult(next, hash ? { diskHash: hash } : undefined);
      }
      case "delete_wiki_page": {
        if (!host.actions.deleteWikiPage) {
          return failResult("capability_unavailable", "Wiki delete is unavailable on this page.", false);
        }
        if (typeof args.baseHash !== "string" || !args.baseHash) {
          return failResult("invalid_arguments", "baseHash is required.", false);
        }
        await host.actions.deleteWikiPage(host.project, id, args.baseHash);
        host.navigate?.(`/p/${host.project}/wiki`);
        host.refresh?.();
        return okResult({ slug: id });
      }
      case "rename_wiki_page": {
        if (!host.actions.renameWikiPage) {
          return failResult("capability_unavailable", "Wiki rename is unavailable on this page.", false);
        }
        if (typeof args.to !== "string" || !args.to.trim()) {
          return failResult("invalid_arguments", "to must be a non-empty slug.", false);
        }
        if (typeof args.baseHash !== "string" || !args.baseHash) {
          return failResult("invalid_arguments", "baseHash is required.", false);
        }
        const renamed = await host.actions.renameWikiPage(host.project, id, args.to.trim(), args.baseHash);
        host.navigate?.(`/p/${host.project}/wiki/${encodeURIComponent(renamed.slug)}`);
        host.refresh?.();
        return okResult(renamed);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (code === "capability_unavailable") {
      return failResult("capability_unavailable", message, { retryable: false });
    }
    if (/hash|conflict|stale/i.test(message)) {
      return failResult("stale_disk_state", message, { retryable: true });
    }
    if (/unknown .*document|invalid path|not found|already exists/i.test(message)) {
      return failResult("invalid_path", message, { retryable: false });
    }
    if (/forbidden|unauthorized|permission|access denied/i.test(message)) {
      return failResult("permission_denied", message, { retryable: false });
    }
    return failResult("operation_failed", message, { retryable: true });
  }
}
