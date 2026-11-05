/**
 * Live-buffer source tools advertised by PLAN.md. Page-scoped: no `project` input.
 * Existing paper tools in webmcp-paper-contract remain the focused set of ten.
 */

import { SOURCE_INPUTS } from "./command-inputs";
import { commandJsonSchemas, parseCommandInput } from "./command-schema";
import { applySourceOperation } from "./operation-service";
import { sourceOperation } from "./operations";
import { failResult, okResult, type OperationResult } from "./operation-result";
import { bannerRanges, splitBundleSource } from "@/lib/tex-project/source-bundle-format";
import { findMacroMatches, parseAnchorAttrs } from "@/lib/marker-codec";
import {
  assertLiveRevision,
  boundWebMcpText,
  MAX_WEBMCP_TEXT_CHARS,
  parseWebMcpMaxChars,
  type PaperWebMcpHost,
  type PaperWebMcpTool,
} from "./webmcp-paper-contract";
import type { SharedWebMcpActions, CurrentLocation } from "./webmcp-shared-contract";

export const PAPER_SOURCE_WEBMCP_TOOL_NAMES = [
  "get_source_bundle",
  "read_source_range",
  "replace_source_range",
  "add_comment",
  "add_todo",
  "update_todo",
  "complete_todo",
  "reopen_todo",
] as const;

export type PaperSourceWebMcpToolName = (typeof PAPER_SOURCE_WEBMCP_TOOL_NAMES)[number];

export type PaperSourceHost = PaperWebMcpHost & {
  replaceRange: (from: number, to: number, text: string, signal?: AbortSignal) => void | Promise<void>;
  sharedActions?: SharedWebMcpActions;
  navigate?: (href: string) => void;
  current?: () => CurrentLocation | undefined;
};

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

export const PAPER_SOURCE_WEBMCP_SCHEMAS = commandJsonSchemas(SOURCE_INPUTS);

export async function executePaperSourceTool(
  host: PaperSourceHost,
  name: PaperSourceWebMcpToolName,
  rawArgs: unknown,
  options?: { signal?: AbortSignal },
): Promise<OperationResult<unknown>> {
  const parsedArgs = parseCommandInput(SOURCE_INPUTS[name], rawArgs, true);
  if (!parsedArgs.ok) return failResult("invalid_arguments", parsedArgs.message, { retryable: false });
  const args = parsedArgs.value;
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
      const range = sourceRange(args, source);
      if ("ok" in range) return range;
      if (touchesBundleBanner(source, range.from, range.to)) {
        return failResult("invalid_path", "File banners identify source files and cannot be edited as body text.", false);
      }
      const result = applySourceOperation(source, sourceOperation(name, args));
      if (!result.ok) return result;
      if (dryRun) return okResult({ dryRun: true, patches: result.value.patches }, { revision: snapshot.revision });
      const mutationError = await runRangeMutation(host, range.from, range.to, result.value.patches[0]!.next, options?.signal);
      if (mutationError) return mutationError;
      return okResult({ changed: true }, { revision: host.getSnapshot().revision });
    }
    case "add_comment": {
      const rev = requireRev();
      if (!rev.ok) return rev;
      const range = sourceRange(args, source);
      if ("ok" in range) return range;
      if (touchesBundleBanner(source, range.from, range.to)) {
        return failResult("invalid_path", "File banners identify source files and cannot be edited as body text.", false);
      }
      const result = applySourceOperation(source, sourceOperation(name, args));
      if (!result.ok) return result;
      if (dryRun) return okResult({ dryRun: true, patches: result.value.patches }, { revision: snapshot.revision });
      const mutationError = await runRangeMutation(host, range.from, range.to, result.value.patches[0]!.next, options?.signal);
      if (mutationError) return mutationError;
      return okResult({ inserted: result.value.patches[0]!.next }, { revision: host.getSnapshot().revision });
    }
    case "add_todo": {
      const rev = requireRev();
      if (!rev.ok) return rev;
      const range = sourceRange(args, source);
      if ("ok" in range) return range;
      if (touchesBundleBanner(source, range.from, range.to)) {
        return failResult("invalid_path", "File banners identify source files and cannot be edited as body text.", false);
      }
      const result = applySourceOperation(source, sourceOperation(name, args));
      if (!result.ok) return result;
      const insert = result.value.patches[0]!.next;
      if (dryRun) return okResult({ dryRun: true, patches: result.value.patches, inserted: insert }, { revision: snapshot.revision });
      const mutationError = await runRangeMutation(host, range.from, range.to, insert, options?.signal);
      if (mutationError) return mutationError;
      const insertedMatch = findMacroMatches(insert, ["obtodo"])[0];
      const insertedAttrs = insertedMatch ? parseAnchorAttrs(insertedMatch.attrs) : {};
      const todoId = insertedAttrs.id?.trim();
      return okResult({ inserted: insert, ...(todoId ? { todoId } : {}) }, { revision: host.getSnapshot().revision });
    }
    case "update_todo": {
      const rev = requireRev();
      if (!rev.ok) return rev;
      const result = applySourceOperation(source, sourceOperation(name, args));
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
      const result = applySourceOperation(source, sourceOperation(name, args));
      if (!result.ok) return result;
      const patch = result.value.patches[0]!;
      if (dryRun) return okResult({ dryRun: true, patches: result.value.patches, id: args.id, completed: true }, { revision: snapshot.revision });
      const mutationError = await runRangeMutation(host, patch.from, patch.to, patch.next, options?.signal);
      if (mutationError) return mutationError;
      return okResult({ id: args.id, completed: true }, { revision: host.getSnapshot().revision });
    }
    case "reopen_todo": {
      const rev = requireRev();
      if (!rev.ok) return rev;
      const result = applySourceOperation(source, sourceOperation(name, args));
      if (!result.ok) return result;
      const patch = result.value.patches[0]!;
      if (dryRun) return okResult({ dryRun: true, patches: result.value.patches, id: args.id, completed: false }, { revision: snapshot.revision });
      const mutationError = await runRangeMutation(host, patch.from, patch.to, patch.next, options?.signal);
      if (mutationError) return mutationError;
      return okResult({ id: args.id, completed: false }, { revision: host.getSnapshot().revision });
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
    description: "Insert a stable \\obtodo at a live source range. The result includes todoId. After it succeeds, use get_project_state or navigate_project to open the Primary mindmap, then call place_todo_card with that todoId and a parentId so the paper TODO and its map card stay together. The mindmap convert_card_to_todo tool performs the reverse flow.",
  },
  update_todo: {
    title: "Update a paper TODO",
    description: "Change a TODO title, details, or completion by id. TeX is authoritative; the mindmap card reflects it.",
  },
  complete_todo: {
    title: "Complete a paper TODO",
    description: "Set the TeX completed timestamp. Completing does not require new manuscript prose.",
  },
  reopen_todo: {
    title: "Reopen a paper TODO",
    description: "Clear the TeX completed timestamp.",
  },
};

export function buildPaperSourceWebMcpTools(host: PaperSourceHost): PaperWebMcpTool[] {
  return PAPER_SOURCE_WEBMCP_TOOL_NAMES.map((name) => ({
    name,
    title: SOURCE_TOOL_META[name].title,
    description: SOURCE_TOOL_META[name].description,
    inputSchema: PAPER_SOURCE_WEBMCP_SCHEMAS[name],
    annotations: {
      readOnlyHint: name === "get_source_bundle" || name === "read_source_range",
      untrustedContentHint: true,
    },
    execute: (args, options) => executePaperSourceTool(host, name, args, options),
  }));
}
