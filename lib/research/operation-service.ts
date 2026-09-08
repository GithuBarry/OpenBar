/**
 * Pure source-operation reducer shared by the editor, browser WebMCP, and server actions.
 */

import { findMacroMatches, parseAnchorAttrs } from "@/lib/marker-codec";
import { assignMissingTodoIds, composeObtodo, rewriteObtodo, nowStamp } from "@/lib/todo-meta";
import { composeObcomment } from "./paper-analysis";
import {
  failResult,
  okResult,
  type OperationResult,
} from "./operation-result";
import type { DryRunResult, SourceOperation, SourcePatch } from "./operations";

function replaceSlice(source: string, from: number, to: number, next: string): { source: string; patch: SourcePatch } {
  return {
    source: `${source.slice(0, from)}${next}${source.slice(to)}`,
    patch: {
      filePath: "",
      from,
      to,
      next,
      previous: source.slice(from, to),
    },
  };
}

function validRange(source: string, from: number, to: number): boolean {
  return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from && to <= source.length;
}

function findObtodo(source: string, id: string): { from: number; to: number; body: string; attrs: Record<string, string> } | null {
  for (const match of findMacroMatches(source, ["obtodo"])) {
    const attrs = parseAnchorAttrs(match.attrs);
    if (attrs.id === id) {
      return { from: match.index, to: match.index + match.length, body: match.body, attrs };
    }
  }
  return null;
}

export function applySourceOperation(
  source: string,
  operation: SourceOperation,
  now = new Date(),
): OperationResult<{ source: string; patches: SourcePatch[] } & DryRunResult> {
  switch (operation.type) {
    case "replace_range": {
      if (!validRange(source, operation.from, operation.to)) {
        return failResult("stale_selection", "Replacement range is outside the live source.", { retryable: true });
      }
      const applied = replaceSlice(source, operation.from, operation.to, operation.text);
      return okResult({ source: applied.source, patches: [applied.patch], diagnostics: [] });
    }
    case "add_comment": {
      const text = operation.text.trim();
      if (!text) return failResult("invalid_arguments", "Comment text is required.", false);
      const kind = operation.kind?.trim() || undefined;
      if (kind && kind.length > 80) return failResult("invalid_arguments", "Comment kind must be 80 characters or fewer.", false);
      if (!validRange(source, operation.from, operation.to)) {
        return failResult("stale_selection", "Comment range is outside the live source.", { retryable: true });
      }
      const insert = composeObcomment({ text, kind, id: operation.id, now });
      const applied = replaceSlice(source, operation.from, operation.to, insert);
      return okResult({ source: applied.source, patches: [applied.patch], diagnostics: [] });
    }
    case "add_todo": {
      const text = operation.text.trim();
      const title = operation.title?.trim() || "";
      if (!text && !title) return failResult("invalid_arguments", "TODO title or details are required.", false);
      if (!validRange(source, operation.from, operation.to)) {
        return failResult("stale_selection", "TODO range is outside the live source.", { retryable: true });
      }
      const insert = composeObtodo({
        id: operation.id,
        title,
        text,
        textFormat: operation.textFormat,
        createdAt: nowStamp(now),
        now,
      });
      if (operation.textFormat === "tex" && findMacroMatches(insert, ["obtodo"])[0]?.length !== insert.length) {
        return failResult("invalid_tex", "TODO formatting needs balanced TeX braces.", false);
      }
      const applied = replaceSlice(source, operation.from, operation.to, insert);
      return okResult({ source: applied.source, patches: [applied.patch], diagnostics: [] });
    }
    case "update_todo": {
      const found = findObtodo(source, operation.id);
      if (!found) return failResult("unknown_todo", `Unknown TODO "${operation.id}".`, false);
      const next = rewriteObtodo(source.slice(found.from, found.to), {
        title: operation.title,
        text: operation.text,
        textFormat: operation.textFormat,
        completed: operation.completed,
      }, now);
      if (operation.textFormat === "tex" && findMacroMatches(next, ["obtodo"])[0]?.length !== next.length) {
        return failResult("invalid_tex", "TODO formatting needs balanced TeX braces.", false);
      }
      const applied = replaceSlice(source, found.from, found.to, next);
      return okResult({ source: applied.source, patches: [applied.patch], diagnostics: [] });
    }
    case "complete_todo": {
      return applySourceOperation(source, { type: "update_todo", id: operation.id, completed: true }, now);
    }
    case "reopen_todo": {
      return applySourceOperation(source, { type: "update_todo", id: operation.id, completed: false }, now);
    }
    case "assign_todo_ids": {
      const result = assignMissingTodoIds(source, now);
      if (!result.assigned.length) {
        return okResult({ source, patches: [], diagnostics: [] });
      }
      return okResult({
        source: result.source,
        patches: [{ filePath: "", from: 0, to: source.length, next: result.source, previous: source }],
        diagnostics: result.assigned.map((id) => ({
          severity: "info" as const,
          code: "assigned-todo-id",
          message: `Assigned stable id ${id}.`,
        })),
      });
    }
  }
}
