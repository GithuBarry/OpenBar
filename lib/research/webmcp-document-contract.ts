/**
 * Wiki / notes / slides WebMCP tools from PLAN.md section 8.
 */

import { failResult, okResult, type OperationResult } from "./operation-result";
import { DOCUMENT_WEBMCP_SCHEMAS, DOCUMENT_WEBMCP_TOOL_NAMES } from "./mcp-tool-schemas";
import { parseWebMcpArgs, unknownWebMcpArgument, type JsonSchemaObject, type PaperWebMcpTool } from "./webmcp-paper-contract";
import type { SharedWebMcpActions } from "./webmcp-shared-contract";

export { DOCUMENT_WEBMCP_TOOL_NAMES };

export type DocumentWebMcpActions = {
  readDocument: (project: string, kind: "wiki" | "notes" | "slides", id: string) => Promise<{ hash: string } | null>;
  patchDocument: (project: string, kind: "wiki" | "notes" | "slides", id: string, baseHash: string, body: string) => Promise<{ hash: string }>;
  patchWikiPage: (
    project: string,
    id: string,
    baseHash: string,
    body: string,
    metadata: unknown,
  ) => Promise<{ hash: string }>;
  renderPreview: (project: string, kind: "wiki" | "notes" | "slides", id: string) => Promise<unknown>;
};

export type DocumentWebMcpHost = {
  project: string;
  kind: "wiki" | "notes" | "slides";
  documentId: string;
  actions: DocumentWebMcpActions;
  sharedActions: SharedWebMcpActions;
  refresh?: () => void;
};

const WIKI_WEBMCP_TOOL_NAMES = ["update_wiki_page"] as const;
type DocumentWebMcpToolName = (typeof DOCUMENT_WEBMCP_TOOL_NAMES)[number] | (typeof WIKI_WEBMCP_TOOL_NAMES)[number];

const WIKI_UPDATE_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    id: { type: "string" },
    baseHash: { type: "string" },
    body: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    refs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string" },
          id: { type: "string" },
          label: { type: "string" },
          url: { type: "string" },
        },
        required: ["kind", "id"],
        additionalProperties: false,
      },
    },
    pinnedForAgents: { type: "boolean" },
    htmlMode: { type: "string", enum: ["static", "interactive"] },
  },
  required: ["id", "baseHash", "body", "title", "summary", "tags", "refs", "pinnedForAgents"],
  additionalProperties: false,
};

export function buildDocumentWebMcpTools(host: DocumentWebMcpHost): PaperWebMcpTool[] {
  const names: DocumentWebMcpToolName[] = [
    ...DOCUMENT_WEBMCP_TOOL_NAMES,
    ...(host.kind === "wiki" ? WIKI_WEBMCP_TOOL_NAMES : []),
  ];
  return names.map((name) => ({
    name,
    title: name.replaceAll("_", " "),
    description: `Primary ${host.kind} document operation ${name}. Project and document are fixed by the open page.`,
    inputSchema: name === "update_wiki_page" ? WIKI_UPDATE_SCHEMA : DOCUMENT_WEBMCP_SCHEMAS[name]!,
    annotations: {
      readOnlyHint: name !== "patch_document" && name !== "update_wiki_page",
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
  const schema = name === "update_wiki_page" ? WIKI_UPDATE_SCHEMA : DOCUMENT_WEBMCP_SCHEMAS[name]!;
  const unknown = unknownWebMcpArgument(args, schema);
  if (unknown) return failResult("invalid_arguments", `Unknown argument "${unknown}".`, { retryable: false });
  if (args.kind !== undefined && (typeof args.kind !== "string" || args.kind !== host.kind)) {
    return failResult("invalid_arguments", `kind must match the open ${host.kind} page.`, { retryable: false });
  }
  if (typeof args.id !== "string" || !args.id.trim()) {
    return failResult("invalid_arguments", "id must be a non-empty string.", { retryable: false });
  }
  if (args.id !== host.documentId) {
    return failResult("invalid_arguments", `id must match the open ${host.kind} document.`, { retryable: false });
  }
  const kind = host.kind;
  const id = args.id;
  try {
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
        const metadata = {
          title: args.title,
          summary: args.summary,
          tags: args.tags,
          refs: args.refs,
          pinnedForAgents: args.pinnedForAgents,
          ...(args.htmlMode === undefined ? {} : { htmlMode: args.htmlMode }),
        };
        const next = await host.actions.patchWikiPage(host.project, id, args.baseHash, args.body, metadata);
        host.refresh?.();
        return okResult(next, { diskHash: next.hash });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/hash|conflict|stale/i.test(message)) {
      return failResult("stale_disk_state", message, { retryable: true });
    }
    if (/unknown .*document|invalid path|not found/i.test(message)) {
      return failResult("invalid_path", message, { retryable: false });
    }
    if (/forbidden|unauthorized|permission|access denied/i.test(message)) {
      return failResult("permission_denied", message, { retryable: false });
    }
    return failResult("operation_failed", message, { retryable: true });
  }
}
