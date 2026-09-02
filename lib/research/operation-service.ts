/**
 * Pure source-operation reducer shared by the editor, browser WebMCP, and server actions.
 */

import { findMacroMatches, parseAnchorAttrs } from "@/lib/marker-codec";
import { composeObtodo, parseTodoDate, rewriteObtodo, todayStamp } from "@/lib/todo-meta";
import { escapeTexText } from "@/lib/tex-project/tex-encode";
import { parseTaskStatus } from "./tasks";
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

function plainAnchorText(value: string): string {
  return escapeTexText(value.replace(/\s+/gu, " ").trim());
}

function replaceObtodoBody(tex: string, text: string): string {
  const match = findMacroMatches(tex, ["obtodo"])[0];
  if (!match) return tex;
  const attrs = match.attrs.trim();
  const replacement = `\\obtodo${attrs ? `[${attrs}]` : ""}{${plainAnchorText(text)}}`;
  return `${tex.slice(0, match.index)}${replacement}${tex.slice(match.index + match.length)}`;
}

function validTodoPriority(value: unknown): value is "p0" | "p1" | "p2" | "p3" {
  return value === "p0" || value === "p1" || value === "p2" || value === "p3";
}

function validTodoStatus(value: unknown): value is "open" | "in_progress" | "blocked" | "done" {
  return value === "open" || value === "in_progress" || value === "blocked" || value === "done";
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
      if (!validRange(source, operation.from, operation.to)) {
        return failResult("stale_selection", "Comment range is outside the live source.", { retryable: true });
      }
      const insert = `\\obcomment{${plainAnchorText(text)}}`;
      const applied = replaceSlice(source, operation.from, operation.to, insert);
      return okResult({ source: applied.source, patches: [applied.patch], diagnostics: [] });
    }
    case "add_todo": {
      const text = operation.text.trim();
      if (!text) return failResult("invalid_arguments", "TODO text is required.", false);
      if (!validRange(source, operation.from, operation.to)) {
        return failResult("stale_selection", "TODO range is outside the live source.", { retryable: true });
      }
      if (operation.due !== undefined && !parseTodoDate(operation.due)) {
        return failResult("invalid_arguments", "TODO due date must be a real YYYY-MM-DD date.", false);
      }
      if (operation.priority !== undefined && !validTodoPriority(operation.priority)) {
        return failResult("invalid_arguments", "TODO priority must be p0, p1, p2, or p3.", false);
      }
      const insert = composeObtodo({
        id: operation.id,
        text,
        owner: operation.owner,
        due: operation.due,
        priority: operation.priority === "p3" ? "p3" : operation.priority,
        createdAt: todayStamp(now),
      });
      const applied = replaceSlice(source, operation.from, operation.to, insert);
      return okResult({ source: applied.source, patches: [applied.patch], diagnostics: [] });
    }
    case "update_todo": {
      const found = findObtodo(source, operation.id);
      if (!found) return failResult("unknown_todo", `Unknown TODO "${operation.id}".`, false);
      if (operation.due !== undefined && operation.due !== null && !parseTodoDate(operation.due)) {
        return failResult("invalid_arguments", "TODO due date must be a real YYYY-MM-DD date.", false);
      }
      if (operation.priority !== undefined && operation.priority !== null && !validTodoPriority(operation.priority)) {
        return failResult("invalid_arguments", "TODO priority must be p0, p1, p2, or p3.", false);
      }
      if (operation.status !== undefined && !validTodoStatus(operation.status)) {
        return failResult("invalid_arguments", "TODO status is invalid.", false);
      }
      const nextStatus = operation.status ? parseTaskStatus(operation.status) : undefined;
      let next = rewriteObtodo(source.slice(found.from, found.to), {
        priority: operation.priority === undefined ? undefined : operation.priority,
        due: operation.due === undefined ? undefined : operation.due,
        owner: operation.owner === undefined ? undefined : operation.owner,
        status: nextStatus,
        completedAt: nextStatus === "done" ? todayStamp(now) : undefined,
      });
      if (operation.text != null) {
        next = replaceObtodoBody(next, operation.text);
      }
      const applied = replaceSlice(source, found.from, found.to, next);
      return okResult({ source: applied.source, patches: [applied.patch], diagnostics: [] });
    }
    case "complete_todo": {
      return applySourceOperation(source, { type: "update_todo", id: operation.id, status: "done" }, now);
    }
    case "rename_heading":
    case "move_section":
    case "convert_document":
      return failResult("capability_unavailable", `${operation.type} is handled by the structural/conversion adapter, not the live buffer reducer.`, false);
  }
}
