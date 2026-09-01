/**
 * Shared operation vocabulary for UI, WebMCP, and HTTP MCP.
 *
 * Pure types plus CAS context. Persistence lives in adapters.
 */

import type { ConflictPayload, OperationDiagnostic, OperationResult } from "./operation-result";

export type OperationActorKind = "human" | "webmcp" | "http-mcp";

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
  text: string;
  id?: string;
  due?: string;
  priority?: "p0" | "p1" | "p2" | "p3";
  owner?: string;
};

export type UpdateTodoOperation = {
  type: "update_todo";
  id: string;
  expectedSourceHash?: string;
  text?: string;
  due?: string | null;
  priority?: "p0" | "p1" | "p2" | "p3" | null;
  owner?: string | null;
  status?: "open" | "in_progress" | "blocked" | "done";
};

export type CompleteTodoOperation = {
  type: "complete_todo";
  id: string;
  expectedSourceHash?: string;
};

export type AddCommentOperation = {
  type: "add_comment";
  from: number;
  to: number;
  text: string;
  id?: string;
};

export type RenameHeadingOperation = {
  type: "rename_heading";
  sectionId: string;
  title: string;
};

export type MoveSectionOperation = {
  type: "move_section";
  sectionId: string;
  afterId?: string | null;
};

export type ConvertDocumentOperation = {
  type: "convert_document";
  planId: string;
  fromFormat: "tex" | "markdown" | "html";
  toFormat: "tex" | "markdown" | "html";
  acknowledgeLoss: boolean;
};

export type SourceOperation =
  | ReplaceRangeOperation
  | AddTodoOperation
  | UpdateTodoOperation
  | CompleteTodoOperation
  | AddCommentOperation
  | RenameHeadingOperation
  | MoveSectionOperation
  | ConvertDocumentOperation;

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
