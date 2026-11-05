/**
 * Shared operation vocabulary for UI, browser WebMCP, and server actions.
 */

import type { ConflictPayload, OperationDiagnostic, OperationResult } from "./operation-result";

export type OperationActorKind = "human" | "webmcp";

export type OperationContext = {
  projectId: string;
  documentId: string;
  expectedRevision: number;
  expectedDiskHash?: string;
  dryRun?: boolean;
  actor: {
    kind: OperationActorKind;
    id?: string;
  };
};

export type ReplaceRangeOperation = {
  type: "replace_range";
  from: number;
  to: number;
  text: string;
  expectedSourceHash?: string;
};

export type AddTodoOperation = {
  type: "add_todo";
  from: number;
  to: number;
  title?: string;
  text: string;
  textFormat?: "plain" | "tex";
  id?: string;
};

export type UpdateTodoOperation = {
  type: "update_todo";
  id: string;
  expectedSourceHash?: string;
  title?: string;
  text?: string;
  textFormat?: "plain" | "tex";
  completed?: boolean;
};

export type CompleteTodoOperation = {
  type: "complete_todo";
  id: string;
  expectedSourceHash?: string;
};

export type ReopenTodoOperation = {
  type: "reopen_todo";
  id: string;
  expectedSourceHash?: string;
};

export type AddCommentOperation = {
  type: "add_comment";
  from: number;
  to: number;
  text: string;
  /** Free project vocabulary such as question, reviewer, or result. */
  kind?: string;
  id?: string;
};

export type AssignTodoIdsOperation = {
  type: "assign_todo_ids";
};

export type SourceOperation =
  | ReplaceRangeOperation
  | AddTodoOperation
  | UpdateTodoOperation
  | CompleteTodoOperation
  | ReopenTodoOperation
  | AddCommentOperation
  | AssignTodoIdsOperation;

/** Build the shared operation after the transport validates its command input. */
export function sourceOperation(
  name: "replace_source_range" | "add_todo" | "update_todo" | "add_comment" | "complete_todo" | "reopen_todo",
  args: Record<string, unknown>,
): SourceOperation {
  const id = (args.id ?? args.todoId) as string;
  switch (name) {
    case "replace_source_range":
      return { type: "replace_range", from: args.from as number, to: args.to as number, text: args.text as string };
    case "add_comment":
      return { type: name, from: args.from as number, to: args.to as number, text: args.text as string, kind: args.kind as string | undefined, id };
    case "add_todo":
      return { type: name, from: args.from as number, to: args.to as number, title: args.title as string | undefined, text: args.text as string, textFormat: args.textFormat as "plain" | "tex" | undefined, id };
    case "update_todo":
      return { type: name, id, title: args.title as string | undefined, text: args.text as string | undefined, textFormat: args.textFormat as "plain" | "tex" | undefined, completed: args.completed as boolean | undefined };
    case "complete_todo":
    case "reopen_todo":
      return { type: name, id };
  }
}

export type SourcePatch = {
  filePath: string;
  from: number;
  to: number;
  next: string;
  previous: string;
};

export type DryRunResult = {
  patches: SourcePatch[];
  diagnostics: OperationDiagnostic[];
};

export type { ConflictPayload, OperationDiagnostic, OperationResult };
