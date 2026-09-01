/**
 * Live-buffer source tools advertised by PLAN.md. Page-scoped: no `project` input.
 * Existing paper tools in webmcp-paper-contract remain the focused set of ten.
 */

import { applySourceOperation } from "./operation-service";
import { failResult, okResult, type OperationResult } from "./operation-result";
import { bannerRanges, splitBundleSource } from "@/lib/tex-project/source-bundle-format";
import {
  assertLiveRevision,
  boundWebMcpText,
  liveTodos,
  MAX_WEBMCP_TEXT_CHARS,
  parseWebMcpArgs,
  parseWebMcpMaxChars,
  unknownWebMcpArgument,
  type JsonSchemaObject,
  type PaperWebMcpHost,
  type PaperWebMcpTool,
} from "./webmcp-paper-contract";
import { artifactHref } from "./artifact-link";
import type { SharedWebMcpActions, CurrentLocation } from "./webmcp-shared-contract";

export const PAPER_SOURCE_WEBMCP_TOOL_NAMES = [
  "get_source_bundle",
  "read_source_range",
  "replace_source_range",
  "add_comment",
  "add_todo",
  "update_todo",
  "complete_todo",
  "lint_document",
  "compile_document",
  "navigate_artifact",
  "get_agenda",
] as const;

export type PaperSourceWebMcpToolName = (typeof PAPER_SOURCE_WEBMCP_TOOL_NAMES)[number];

export type PaperSourceHost = PaperWebMcpHost & {
  replaceRange: (from: number, to: number, text: string, signal?: AbortSignal) => void | Promise<void>;
  sharedActions?: SharedWebMcpActions;
  navigate?: (href: string) => void;
  current?: () => CurrentLocation | undefined;
};

function objectSchema(properties: Record<string, unknown> = {}, required: string[] = []): JsonSchemaObject {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

function sourceRange(args: Record<string, unknown>, source: string): { from: number; to: number } | OperationResult<never> {
  const from = args.from;
  const to = args.to;
  if (!Number.isInteger(from) || !Number.isInteger(to) || (from as number) < 0 || (to as number) < (from as number) || (to as number) > source.length) {
    return failResult("stale_selection", "Source range is outside the live buffer.", { retryable: true });
  }
  return { from: from as number, to: to as number };
}

async function runRangeMutation(host: PaperSourceHost, from: number, to: number, text: string, signal?: AbortSignal): Promise<OperationResult<never> | null> {
  try {
    if (signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" });
    await host.replaceRange(from, to, text, signal);
    return null;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
    const message = error instanceof Error ? error.message : String(error);
    const knownCode = code || (message.includes("stale_disk_state") ? "stale_disk_state" : message.includes("stale_selection") ? "stale_selection" : "save_failed");
    return failResult(knownCode, message, {
      retryable: knownCode === "stale_disk_state" || knownCode === "stale_selection" || knownCode === "save_failed",
      ...(error && typeof error === "object" && "currentHash" in error
        ? { currentHash: String((error as { currentHash?: unknown }).currentHash || "") }
        : {}),
    });
  }
}

function touchesBundleBanner(source: string, from: number, to: number): boolean {
  return bannerRanges(source).some((range) => (
    from === to
      ? from >= range.from && from < range.to
      : from < range.to && to > range.from
  ));
}

const expectedRevisionSchema = {
  type: "integer",
  minimum: 0,
  description: "Live editor revision from the last get_paper_state call.",
};

export const PAPER_SOURCE_WEBMCP_SCHEMAS: Record<PaperSourceWebMcpToolName, JsonSchemaObject> = {
  get_source_bundle: objectSchema({ maxChars: {
    type: "integer",
    minimum: 1,
    maximum: MAX_WEBMCP_TEXT_CHARS,
  } }),
  read_source_range: objectSchema(
    {
      from: { type: "integer", minimum: 0 },
      to: { type: "integer", minimum: 0 },
      maxChars: { type: "integer", minimum: 1, maximum: MAX_WEBMCP_TEXT_CHARS },
    },
    ["from", "to"],
  ),
  replace_source_range: objectSchema(
    {
      from: { type: "integer", minimum: 0 },
      to: { type: "integer", minimum: 0 },
      text: { type: "string" },
      expectedRevision: expectedRevisionSchema,
      dryRun: { type: "boolean", description: "Return patches without mutating the live buffer." },
    },
    ["from", "to", "text", "expectedRevision"],
  ),
  add_comment: objectSchema(
    {
      from: { type: "integer", minimum: 0 },
      to: { type: "integer", minimum: 0 },
      text: { type: "string" },
      expectedRevision: expectedRevisionSchema,
      dryRun: { type: "boolean", description: "Return patches without mutating the live buffer." },
    },
    ["from", "to", "text", "expectedRevision"],
  ),
  add_todo: objectSchema(
    {
      from: { type: "integer", minimum: 0 },
      to: { type: "integer", minimum: 0 },
      text: { type: "string" },
      owner: { type: "string" },
      due: { type: "string" },
      priority: { type: "string", enum: ["p0", "p1", "p2", "p3"] },
      expectedRevision: expectedRevisionSchema,
      dryRun: { type: "boolean", description: "Return patches without mutating the live buffer." },
    },
    ["from", "to", "text", "expectedRevision"],
  ),
  update_todo: objectSchema(
    {
      id: { type: "string" },
      text: { type: "string" },
      owner: { type: ["string", "null"] },
      due: { type: ["string", "null"] },
      priority: { type: ["string", "null"], enum: ["p0", "p1", "p2", "p3", null] },
      status: { type: "string", enum: ["open", "in_progress", "blocked", "done"] },
      expectedRevision: expectedRevisionSchema,
      dryRun: { type: "boolean", description: "Return patches without mutating the live buffer." },
    },
    ["id", "expectedRevision"],
  ),
  complete_todo: objectSchema(
    { id: { type: "string" }, expectedRevision: expectedRevisionSchema, dryRun: { type: "boolean" } },
    ["id", "expectedRevision"],
  ),
  lint_document: objectSchema(),
  compile_document: objectSchema(),
  navigate_artifact: objectSchema(
    { kind: { type: "string" }, id: { type: "string" } },
    ["kind", "id"],
  ),
  get_agenda: objectSchema(),
};

export async function executePaperSourceTool(
  host: PaperSourceHost,
  name: PaperSourceWebMcpToolName,
  rawArgs: unknown,
  options?: { signal?: AbortSignal },
): Promise<OperationResult<unknown>> {
  const parsedArgs = parseWebMcpArgs(rawArgs);
  if (!parsedArgs.ok) return failResult("invalid_arguments", parsedArgs.message, { retryable: false });
  const args = parsedArgs.value;
  const unknown = unknownWebMcpArgument(args, PAPER_SOURCE_WEBMCP_SCHEMAS[name]);
  if (unknown) return failResult("invalid_arguments", `Unknown argument "${unknown}".`, { retryable: false });
  const snapshot = host.getSnapshot();
  const source = snapshot.source;

  const requireRev = () => assertLiveRevision(args.expectedRevision, snapshot.revision);
  const dryRun = args.dryRun === true;

  switch (name) {
    case "get_source_bundle": {
      const maxChars = parseWebMcpMaxChars(args, snapshot.revision);
      if (typeof maxChars !== "number") return maxChars;
      const parts = splitBundleSource(source);
      const bounded = boundWebMcpText(source, maxChars);
      const sourceMetadata = new Map((snapshot.sourceSegments || []).map((segment) => [segment.filePath, segment]));
      const occurrenceCounts = new Map<string, number>();
      const segments = parts.length
        ? parts.map((part) => {
            const filePath = part.filePath || "root";
            const occurrence = (occurrenceCounts.get(filePath) || 0) + 1;
            occurrenceCounts.set(filePath, occurrence);
            return {
            id: occurrence === 1 ? filePath : `${filePath}#occurrence-${occurrence}`,
            filePath: part.filePath,
            virtualFrom: part.bannerFrom,
            virtualTo: part.bodyTo,
            fileFrom: part.bodyFrom - part.bannerFrom,
            fileTo: part.bodyTo - part.bannerFrom,
            visibleVirtualFrom: Math.min(part.bannerFrom, bounded.text.length),
            visibleVirtualTo: Math.min(part.bodyTo, bounded.text.length),
            editable: sourceMetadata.get(part.filePath)?.editable ?? true,
            };
          })
        : [{ id: "live", filePath: "live-editor", virtualFrom: 0, virtualTo: source.length, fileFrom: 0, fileTo: source.length, visibleVirtualFrom: 0, visibleVirtualTo: bounded.text.length, editable: true }];
      return okResult(
        {
          rootFile: parts[0]?.filePath || "paper.tex",
          source: bounded.text,
          truncated: bounded.truncated,
          totalCharacters: bounded.totalCharacters,
          revision: snapshot.revision,
          liveRevision: snapshot.revision,
          ...(snapshot.persistedHash ? { persistedHash: snapshot.persistedHash } : {}),
          segments,
        },
        { revision: snapshot.revision },
      );
    }
    case "read_source_range": {
      const range = sourceRange(args, source);
      if ("ok" in range) return range;
      const maxChars = parseWebMcpMaxChars(args, snapshot.revision);
      if (typeof maxChars !== "number") return maxChars;
      if (range.to - range.from > maxChars) {
        return failResult("invalid_arguments", `Requested range exceeds maxChars (${maxChars}).`, {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      return okResult({ from: range.from, to: range.to, text: source.slice(range.from, range.to) }, { revision: snapshot.revision });
    }
    case "replace_source_range": {
      const rev = requireRev();
      if (!rev.ok) return rev;
      if (typeof args.text !== "string") return failResult("invalid_arguments", "text must be a string.", false);
      if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") return failResult("invalid_arguments", "dryRun must be a boolean.", false);
      const range = sourceRange(args, source);
      if ("ok" in range) return range;
      if (touchesBundleBanner(source, range.from, range.to)) {
        return failResult("invalid_path", "File banners identify source files and cannot be edited as body text.", false);
      }
      const result = applySourceOperation(source, {
        type: "replace_range",
        from: range.from,
        to: range.to,
        text: args.text,
      });
      if (!result.ok) return result;
      if (dryRun) return okResult({ dryRun: true, patches: result.value.patches }, { revision: snapshot.revision });
      const mutationError = await runRangeMutation(host, range.from, range.to, args.text, options?.signal);
      if (mutationError) return mutationError;
      return okResult({ changed: true }, { revision: host.getSnapshot().revision });
    }
    case "add_comment": {
      const rev = requireRev();
      if (!rev.ok) return rev;
      if (typeof args.text !== "string") return failResult("invalid_arguments", "text must be a string.", false);
      if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") return failResult("invalid_arguments", "dryRun must be a boolean.", false);
      const range = sourceRange(args, source);
      if ("ok" in range) return range;
      if (touchesBundleBanner(source, range.from, range.to)) {
        return failResult("invalid_path", "File banners identify source files and cannot be edited as body text.", false);
      }
      const result = applySourceOperation(source, {
        type: "add_comment",
        from: range.from,
        to: range.to,
        text: args.text,
      });
      if (!result.ok) return result;
      if (dryRun) return okResult({ dryRun: true, patches: result.value.patches }, { revision: snapshot.revision });
      const mutationError = await runRangeMutation(host, range.from, range.to, result.value.patches[0]!.next, options?.signal);
      if (mutationError) return mutationError;
      return okResult({ inserted: result.value.patches[0]!.next }, { revision: host.getSnapshot().revision });
    }
    case "add_todo": {
      const rev = requireRev();
      if (!rev.ok) return rev;
      if (typeof args.text !== "string") return failResult("invalid_arguments", "text must be a string.", false);
      if (args.owner !== undefined && typeof args.owner !== "string") return failResult("invalid_arguments", "owner must be a string.", false);
      if (args.due !== undefined && typeof args.due !== "string") return failResult("invalid_arguments", "due must be a string.", false);
      if (args.priority !== undefined && (typeof args.priority !== "string" || !["p0", "p1", "p2", "p3"].includes(args.priority))) return failResult("invalid_arguments", "priority must be p0, p1, p2, or p3.", false);
      if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") return failResult("invalid_arguments", "dryRun must be a boolean.", false);
      const range = sourceRange(args, source);
      if ("ok" in range) return range;
      if (touchesBundleBanner(source, range.from, range.to)) {
        return failResult("invalid_path", "File banners identify source files and cannot be edited as body text.", false);
      }
      const result = applySourceOperation(source, {
        type: "add_todo",
        from: range.from,
        to: range.to,
        text: args.text,
        owner: typeof args.owner === "string" ? args.owner : undefined,
        due: typeof args.due === "string" ? args.due : undefined,
        priority: typeof args.priority === "string" ? (args.priority as "p0") : undefined,
      });
      if (!result.ok) return result;
      const insert = result.value.patches[0]!.next;
      if (dryRun) return okResult({ dryRun: true, patches: result.value.patches, inserted: insert }, { revision: snapshot.revision });
      const mutationError = await runRangeMutation(host, range.from, range.to, insert, options?.signal);
      if (mutationError) return mutationError;
      return okResult({ inserted: insert }, { revision: host.getSnapshot().revision });
    }
    case "update_todo": {
      const rev = requireRev();
      if (!rev.ok) return rev;
      if (typeof args.id !== "string") return failResult("invalid_arguments", "id must be a string.", false);
      if (args.text !== undefined && typeof args.text !== "string") return failResult("invalid_arguments", "text must be a string.", false);
      if (args.owner !== undefined && args.owner !== null && typeof args.owner !== "string") return failResult("invalid_arguments", "owner must be a string or null.", false);
      if (args.due !== undefined && args.due !== null && typeof args.due !== "string") return failResult("invalid_arguments", "due must be a string or null.", false);
      if (args.priority !== undefined && args.priority !== null && (typeof args.priority !== "string" || !["p0", "p1", "p2", "p3"].includes(args.priority))) return failResult("invalid_arguments", "priority must be p0, p1, p2, or null.", false);
      if (args.status !== undefined && (typeof args.status !== "string" || !["open", "in_progress", "blocked", "done"].includes(args.status))) return failResult("invalid_arguments", "status is invalid.", false);
      if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") return failResult("invalid_arguments", "dryRun must be a boolean.", false);
      const result = applySourceOperation(source, {
        type: "update_todo",
        id: args.id,
        text: typeof args.text === "string" ? args.text : undefined,
        owner: args.owner === null ? null : typeof args.owner === "string" ? args.owner : undefined,
        due: args.due === null ? null : typeof args.due === "string" ? args.due : undefined,
        priority: args.priority === null ? null : typeof args.priority === "string" ? (args.priority as "p0") : undefined,
        status: typeof args.status === "string" ? (args.status as "open") : undefined,
      });
      if (!result.ok) return result;
      const patch = result.value.patches[0]!;
      if (dryRun) return okResult({ dryRun: true, patches: result.value.patches, id: args.id }, { revision: snapshot.revision });
      const mutationError = await runRangeMutation(host, patch.from, patch.to, patch.next, options?.signal);
      if (mutationError) return mutationError;
      return okResult({ id: args.id }, { revision: host.getSnapshot().revision });
    }
    case "complete_todo": {
      const rev = requireRev();
      if (!rev.ok) return rev;
      if (typeof args.id !== "string") return failResult("invalid_arguments", "id must be a string.", false);
      if (args.dryRun !== undefined && typeof args.dryRun !== "boolean") return failResult("invalid_arguments", "dryRun must be a boolean.", false);
      const result = applySourceOperation(source, { type: "complete_todo", id: args.id });
      if (!result.ok) return result;
      const patch = result.value.patches[0]!;
      if (dryRun) return okResult({ dryRun: true, patches: result.value.patches, id: args.id, status: "done" }, { revision: snapshot.revision });
      const mutationError = await runRangeMutation(host, patch.from, patch.to, patch.next, options?.signal);
      if (mutationError) return mutationError;
      return okResult({ id: args.id, status: "done" }, { revision: host.getSnapshot().revision });
    }
    case "lint_document": {
      const report = host.lint ? host.lint() : { diagnostics: [] };
      return okResult(report, { revision: snapshot.revision, warnings: report.diagnostics });
    }
    case "compile_document": {
      try {
        const started = await host.compile(options?.signal);
        return okResult(started, { revision: host.getSnapshot().revision });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
        if (code === "cancelled" || (error instanceof Error && error.message.toLowerCase().includes("cancelled"))) {
          return failResult("cancelled", "Operation cancelled.", { retryable: false, currentRevision: host.getSnapshot().revision });
        }
        return failResult("compile_failed", error instanceof Error ? error.message : "Compilation failed.", {
          retryable: true,
          currentRevision: host.getSnapshot().revision,
        });
      }
    }
    case "navigate_artifact": {
      if (typeof args.kind !== "string" || typeof args.id !== "string" || !args.kind.trim() || !args.id.trim()) {
        return failResult("invalid_arguments", "kind and id must be non-empty strings.", false);
      }
      const href = artifactHref(snapshot.project, { kind: args.kind as never, id: args.id });
      if (args.kind === "draft-section" || args.kind === "draft-todo") {
        host.navigateSection(args.id);
      }
      return okResult({ href }, { revision: snapshot.revision });
    }
    case "get_agenda": {
      const todos = liveTodos(snapshot).map((todo) => ({
        id: todo.id,
        kind: todo.due ? "deadline" : "todo",
        title: todo.text,
        due: todo.due,
        priority: todo.priority,
        owner: todo.owner,
      }));
      return okResult(todos, { revision: snapshot.revision });
    }
  }
}

const SOURCE_TOOL_META: Record<PaperSourceWebMcpToolName, { title: string; description: string }> = {
  get_source_bundle: {
    title: "Read the live source bundle",
    description: "Return the live include-graph source, file segments, and revision. Prefer read_paper_section for ordinary research edits.",
  },
  read_source_range: {
    title: "Read a source range",
    description: "Read a character range from the live paper source. Use after get_paper_state when a section replacement is too coarse.",
  },
  replace_source_range: {
    title: "Replace a source range",
    description: "Replace a character range in the live editor using expectedRevision. The change appears immediately and saves through the same hash-checked path as human edits.",
  },
  add_comment: {
    title: "Add a paper comment",
    description: "Wrap or insert an \\obcomment at a live source range. Keep comments next to the relevant manuscript prose.",
  },
  add_todo: {
    title: "Add a paper TODO",
    description: "Insert an \\obtodo at a live source range. Basic creation needs only text; a stable id is generated. Optional owner, due, and priority are allowed.",
  },
  update_todo: {
    title: "Update a paper TODO",
    description: "Change TODO text or optional metadata by id through the live editor. Unknown attributes are preserved.",
  },
  complete_todo: {
    title: "Complete a paper TODO",
    description: "Mark an \\obtodo done in the live manuscript. Completing it removes it from the mindmap's active overlay.",
  },
  lint_document: {
    title: "Lint the live paper (alias)",
    description: "Alias of lint_paper. Prefer lint_paper.",
  },
  compile_document: {
    title: "Compile the paper (alias)",
    description: "Alias of compile_paper. Prefer compile_paper.",
  },
  navigate_artifact: {
    title: "Navigate to a paper artifact",
    description: "Jump to a paper section or TODO on the open paper page. Prefer navigate_project when the target may be on another page.",
  },
  get_agenda: {
    title: "Read live paper TODOs",
    description: "Return open TODOs from the live paper buffer. Prefer get_project_state for project-wide orientation.",
  },
};

export function buildPaperSourceWebMcpTools(host: PaperSourceHost): PaperWebMcpTool[] {
  return PAPER_SOURCE_WEBMCP_TOOL_NAMES.map((name) => ({
    name,
    title: SOURCE_TOOL_META[name].title,
    description: SOURCE_TOOL_META[name].description,
    inputSchema: PAPER_SOURCE_WEBMCP_SCHEMAS[name],
    annotations: {
      readOnlyHint: name === "get_source_bundle" || name === "read_source_range" || name === "lint_document" || name === "get_agenda" || name === "navigate_artifact",
      untrustedContentHint: true,
    },
    execute: (args, options) => executePaperSourceTool(host, name, args, options),
  }));
}
