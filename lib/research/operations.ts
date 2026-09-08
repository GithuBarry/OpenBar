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
