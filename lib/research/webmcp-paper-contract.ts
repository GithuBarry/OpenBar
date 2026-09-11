/**
 * WebMCP paper-page tool contract.
 *
 * Page tools are ambient-scoped: the open paper supplies `project`. Input
 * schemas therefore omit `project`. `execute()` returns ordinary
 * `OperationResult` values, never MCP `{ content: [{ type: "text" }] }` envelopes.
 *
 * `use-paper-webmcp` should import this module rather than duplicating names,
 * schemas, or CAS / identity checks.
 */

import {
  failResult,
  okResult,
  WEBMCP_ERROR_CODES,
} from "./operation-result";
import type { RemoteSyncOutcome } from "./operation-result";
import { PAPER_MUTATION_SCHEMAS } from "./mcp-tool-schemas";
import { analyzePaper } from "./paper-analysis";
import { findMacroMatches, parseAnchorAttrs } from "@/lib/marker-codec";
import { patchSectionTableCell } from "@/lib/tex-project/table-fragments";
import { summarizeTabulars } from "@/lib/tex-project/table-ast";
import { todoIsComplete, todoMetaFromAttrs, todoTitleFromAttrs } from "@/lib/todo-meta";
import { previewTodoAtSection } from "./paper-todo-placement";
import type { OperationDiagnostic as WebMcpDiagnostic, OperationResult } from "./operation-result";

export {
  failResult,
  isOperationResult,
  okResult,
  OPERATION_ERROR_CODES,
  WEBMCP_ERROR_CODES,
} from "./operation-result";
export type {
  OperationDiagnostic,
  OperationDiagnostic as WebMcpDiagnostic,
  OperationErrorCode as WebMcpErrorCode,
  OperationResult,
} from "./operation-result";

export const SECTION_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$";
export const SECTION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const PAPER_WEBMCP_TOOL_NAMES = [
  "get_paper_state",
  "get_paper_outline",
  "read_paper_section",
  "preview_paper_todo",
  "add_paper_todo_at_section",
  "relocate_paper_todo",
  "navigate_paper_section",
  "set_paper_reader_mode",
  "replace_paper_section",
  "patch_paper_table",
  "remove_paper_todo",
  "lint_paper",
  "compile_paper",
  "get_paper_compile",
  "get_bibliography",
] as const;

export type PaperWebMcpToolName = (typeof PAPER_WEBMCP_TOOL_NAMES)[number];

/** Mindmap page capabilities. Must not be registered on a paper page. */
export const MINDMAP_WEBMCP_TOOL_NAMES = [
  "get_mindmap",
  "focus_mindmap_node",
  "add_mindmap_node",
  "move_mindmap_node",
  "delete_mindmap_node",
  "delete_mindmap_branch",
  "set_mindmap_collapsed",
  "patch_mindmap_node",
  "attach_mindmap_image",
  "detach_mindmap_image",
  "caption_mindmap_image",
  "read_mindmap_image",
  "highlight_mindmap_activity",
  "place_todo_card",
  "convert_card_to_todo",
  "complete_todo",
  "reopen_todo",
  "focus_todo_in_paper",
  "rename_mindmap",
  "set_mindmap_font_size",
] as const;

export type MindmapWebMcpToolName = (typeof MINDMAP_WEBMCP_TOOL_NAMES)[number];

export type JsonSchemaObject = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
};

export type WebMcpReaderMode = "document" | "pdf";

export type LivePaperSection = {
  id: string;
  title: string;
  level: number;
  tex: string;
  headingKey?: string;
  persistedHash?: string;
};

export type LivePaperTodo = {
  id: string;
  title?: string;
  text: string;
  sectionId?: string;
  createdAt?: string;
  completed: boolean;
};

export type PaperTodoPlacement = {
  todoId: string;
  sectionId: string;
  filePath?: string;
  from: number;
  to: number;
  before: string;
  after: string;
  proposedText: string;
};

export type LivePaperComment = {
  id?: string;
  kind?: string;
  text: string;
  sectionId?: string;
};

export type LivePaperMarker = {
  kind: string;
  text: string;
  sectionId?: string;
};

export type LivePaperSourceSection = {
  id: string;
  title: string;
  level: number;
  order: number;
  file: string;
  sourceHash: string;
  sourceRange: { from: number; to: number };
  writeTargetId?: string;
  excerpt: string;
  headingPath: string[];
  parseStatus: "ok" | "error";
  diagnostic?: {
    severity: "error" | "warning" | "info";
    code: string;
    message: string;
    filePath?: string;
    repair?: { kind: "missing-edit-end"; sectionId: string; filePath?: string };
  };
  diagnostics: Array<NonNullable<LivePaperSourceSection["diagnostic"]>>;
};

export type LivePaperSnapshot = {
  project: string;
  title: string;
  revision: number;
  source: string;
  sections: LivePaperSection[];
  activeSectionId?: string;
  dirty: boolean;
  /** Hash of the persisted source bundle known by the mounted page. */
  persistedHash?: string;
  /** True while dirty content is waiting for or undergoing a save. */
  pendingSave?: boolean;
  /** Last local-save-to-Git outcome, including an actionable failure. */
  remoteSync?: RemoteSyncOutcome;
  sourceSegments?: Array<{ filePath: string; editable: boolean }>;
  compileState?: {
    state: string;
    compiler?: "latexmk";
    jobId?: string;
    pdfAvailable?: boolean;
    sourceHash?: string;
    buildInputHash?: string;
    artifactId?: string;
    artifactSourceHash?: string;
    artifactBuildInputHash?: string;
    lastSuccessfulArtifact?: {
      artifactId: string;
      artifactSourceHash?: string;
      artifactBuildInputHash?: string;
    };
    observationDelayed?: boolean;
    stale?: boolean;
    message?: string;
    diagnostics?: string[];
    parsedDiagnostics?: { file: string; line: number; message: string }[];
    rawLog?: string;
    completedAt?: string;
  };
  bibliographyKeys: string[];
  bibliographyRaw?: string;
  todos?: LivePaperTodo[];
  comments?: LivePaperComment[];
  markers?: LivePaperMarker[];
  sourceContext?: {
    rootFile?: string;
    sections: LivePaperSourceSection[];
    diagnostics: Array<NonNullable<LivePaperSourceSection["diagnostic"]>>;
  };
};

export type PaperWebMcpHost = {
  getSnapshot: () => LivePaperSnapshot;
  navigateSection: (sectionId: string) => void;
  setReaderMode: (mode: WebMcpReaderMode) => void;
  addTodoAtSection?: (
    sectionId: string,
    text: string,
    title: string | undefined,
    todoId: string | undefined,
    signal?: AbortSignal,
  ) => PaperTodoPlacement | Promise<PaperTodoPlacement>;
  relocateTodo?: (
    todoId: string,
    sectionId: string,
    signal?: AbortSignal,
  ) => PaperTodoPlacement | Promise<PaperTodoPlacement>;
  replaceSection: (sectionId: string, tex: string, signal?: AbortSignal) => void | Promise<void>;
  removeTodo: (todoId: string, signal?: AbortSignal) => void | Promise<void>;
  compile: (signal?: AbortSignal) =>
    | { status: string; jobId?: string; sourceHash?: string }
    | Promise<{ status: string; jobId?: string; sourceHash?: string }>;
  lint?: () => { readiness?: string; diagnostics: WebMcpDiagnostic[] };
};

export type PaperWebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  annotations: { readOnlyHint: boolean; untrustedContentHint?: boolean };
  execute: (
    args?: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<OperationResult<unknown>>;
};

function objectSchema(properties: Record<string, unknown> = {}, required: string[] = []): JsonSchemaObject {
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

const sectionIdSchema = {
  type: "string",
  pattern: SECTION_ID_PATTERN,
  description: "Current section id from get_paper_outline. The open page supplies the project; do not pass project.",
};

const expectedRevisionSchema = {
  type: "integer",
  minimum: 0,
  description: "Live editor revision from the last get_paper_state or read_paper_section call.",
};

export const MAX_WEBMCP_TEXT_CHARS = 200_000;

const maxCharsSchema = {
  type: "integer",
  minimum: 1,
  maximum: MAX_WEBMCP_TEXT_CHARS,
  description: `Maximum UTF-16 code units to return. The default is ${MAX_WEBMCP_TEXT_CHARS}. Use range reads for larger files.`,
};

export const PAPER_WEBMCP_TOOL_SCHEMAS: Record<PaperWebMcpToolName, JsonSchemaObject> = {
  get_paper_state: objectSchema(),
  get_paper_outline: objectSchema(),
  read_paper_section: objectSchema({ sectionId: sectionIdSchema, maxChars: maxCharsSchema }, ["sectionId"]),
  preview_paper_todo: objectSchema(
    {
      sectionId: sectionIdSchema,
      title: { type: "string" },
      text: { type: "string" },
      todoId: { type: "string", pattern: SECTION_ID_PATTERN },
    },
    ["sectionId", "text"],
  ),
  add_paper_todo_at_section: objectSchema(
    {
      sectionId: sectionIdSchema,
      title: { type: "string" },
      text: { type: "string" },
      todoId: { type: "string", pattern: SECTION_ID_PATTERN, description: "Reuse preview_paper_todo.todoId for an idempotent retry." },
      expectedRevision: expectedRevisionSchema,
    },
    ["sectionId", "text", "expectedRevision"],
  ),
  relocate_paper_todo: objectSchema(
    { todoId: sectionIdSchema, sectionId: sectionIdSchema, expectedRevision: expectedRevisionSchema },
    ["todoId", "sectionId", "expectedRevision"],
  ),
  navigate_paper_section: objectSchema({ sectionId: sectionIdSchema }, ["sectionId"]),
  set_paper_reader_mode: objectSchema(
    {
      mode: {
        type: "string",
        enum: ["document", "pdf"],
        description: "Show the live document or the compiled PDF in the paper reader.",
      },
    },
    ["mode"],
  ),
  replace_paper_section: objectSchema(
    {
      sectionId: sectionIdSchema,
      expectedRevision: expectedRevisionSchema,
      tex: { type: "string", description: "Replacement TeX body for the section, excluding the heading line." },
    },
    ["sectionId", "expectedRevision", "tex"],
  ),
  patch_paper_table: PAPER_MUTATION_SCHEMAS.patch_paper_table,
  remove_paper_todo: objectSchema(
    {
      todoId: sectionIdSchema,
      expectedRevision: expectedRevisionSchema,
    },
    ["todoId", "expectedRevision"],
  ),
  lint_paper: objectSchema(),
  compile_paper: objectSchema(),
  get_paper_compile: objectSchema({ jobId: { type: "string", description: "Optional compile job id to compare with the live result." } }),
  get_bibliography: objectSchema({
    raw: { type: "boolean", description: "When true, include the exact BibTeX text." },
    maxChars: maxCharsSchema,
  }),
};

const TOOL_META: Record<PaperWebMcpToolName, { title: string; description: string; readOnly: boolean }> = {
  get_paper_state: {
    title: "Read live paper state",
    description:
      "Return the live paper snapshot: revision, dirty flag, active section, outline, open TODO count, comments, markers, and compile state. Call this after navigate_project lands on the paper page. Project is fixed by the open page. \\obmarker is a paper-local hole, not a mindmap TODO.",
    readOnly: true,
  },
  get_paper_outline: {
    title: "Read paper outline",
    description: "Return current section ids, titles, levels, TODO counts, and marker counts for the live paper.",
    readOnly: true,
  },
  read_paper_section: {
    title: "Read one paper section",
    description: "Return the live TeX and revision for one section id. Unsaved editor edits are visible. Use this before replace_paper_section.",
    readOnly: true,
  },
  preview_paper_todo: {
    title: "Preview a paper TODO placement",
    description: "Show the exact included file, insertion range, neighboring manuscript text, and proposed TeX TODO before writing it. This is read-only.",
    readOnly: true,
  },
  add_paper_todo_at_section: {
    title: "Add a paper TODO at a section",
    description: "Insert a TeX-owned TODO at the selected current section's end after previewing it. Reuse the preview todoId on retry; the result separates the local save from Git synchronization.",
    readOnly: false,
  },
  relocate_paper_todo: {
    title: "Relocate one paper TODO",
    description: "Move an existing TeX TODO to another current section without changing its id, title, text, completion, or map references. Read the target context first and pass the live revision.",
    readOnly: false,
  },
  navigate_paper_section: {
    title: "Navigate to a paper section",
    description: "Move the live document and editor to a current section id from get_paper_outline. The paper page must already be open.",
    readOnly: true,
  },
  set_paper_reader_mode: {
    title: "Switch paper reader",
    description: "Switch the visible reader between the live document and the compiled PDF.",
    readOnly: true,
  },
  replace_paper_section: {
    title: "Replace a paper section",
    description:
      "Replace one manuscript section using the current live editor revision. Use read_paper_section first. Preserve tables, axes, captions, labels, TODOs, comments, markers, and intentionally incomplete cells. Make the smallest paper change that satisfies the request. For a single table cell, prefer patch_paper_table.",
    readOnly: false,
  },
  patch_paper_table: {
    title: "Patch one table cell",
    description:
      "Replace exactly one cell in a simple tabular. Pass tableIndex and a single {row, column, tex} update. Surrounding cells, markers, and axes stay as-is. Complex tables (multicolumn, multirow, tabularx, longtable) return capability_unavailable — use replace_paper_section carefully instead. \\obmarker cells are paper-local holes, not mindmap TODOs.",
    readOnly: false,
  },
  remove_paper_todo: {
    title: "Remove a paper TODO",
    description: "Remove one \\obtodo by stable id through the live editor. Pass expectedRevision from the last read. Prefer complete_todo when the TODO should remain as completed metadata.",
    readOnly: false,
  },
  lint_paper: {
    title: "Lint the live paper",
    description: "Return structured diagnostics for the live manuscript. Does not mutate the paper.",
    readOnly: true,
  },
  compile_paper: {
    title: "Compile the paper",
    description: "Flush live edits onto the ordinary save path and start compilation. Returns the source hash being compiled. The human PDF preview updates when the build finishes.",
    readOnly: false,
  },
  get_paper_compile: {
    title: "Read paper compile result",
    description: "Read the current compile job, exact source hash, parsed file/line diagnostics, bounded raw log, and stale/PDF-current state. Poll this tool with the returned jobId until the state is no longer running; compile success is not research completion.",
    readOnly: true,
  },
  get_bibliography: {
    title: "Read the bibliography",
    description: "Return parsed citation keys for the open paper. Set raw to include BibTeX text. Does not add references.",
    readOnly: true,
  },
};

/** True when a WebMCP execute() leaked an MCP CallToolResult envelope. */
export function isMcpContentEnvelope(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.some((part) => {
    if (!part || typeof part !== "object") return false;
    const item = part as { type?: unknown; text?: unknown };
    return item.type === "text" && typeof item.text === "string";
  });
}

export function pageToolSchemaHasProject(schema: JsonSchemaObject): boolean {
  return Boolean(schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, "project"));
}

export function isPaperWebMcpToolName(name: string): name is PaperWebMcpToolName {
  return (PAPER_WEBMCP_TOOL_NAMES as readonly string[]).includes(name);
}

export function isMindmapWebMcpToolName(name: string): name is MindmapWebMcpToolName {
  return (MINDMAP_WEBMCP_TOOL_NAMES as readonly string[]).includes(name);
}

export function normalizeWebMcpArgs(value: unknown): Record<string, unknown> {
  const parsed = parseWebMcpArgs(value);
  return parsed.ok ? parsed.value : {};
}

export function parseWebMcpArgs(value: unknown):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string } {
  if (value == null) return { ok: true, value: {} };
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ok: true, value: parsed as Record<string, unknown> };
      }
      return { ok: false, message: "Tool arguments must be a JSON object." };
    } catch {
      return { ok: false, message: "Tool arguments must be a JSON object." };
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ok: true, value: value as Record<string, unknown> };
  }
  return { ok: false, message: "Tool arguments must be a JSON object." };
}

export function unknownWebMcpArgument(args: Record<string, unknown>, schema: JsonSchemaObject): string | undefined {
  return Object.keys(args).find((key) => !Object.prototype.hasOwnProperty.call(schema.properties, key));
}

export function parseWebMcpMaxChars(
  args: Record<string, unknown>,
  currentRevision?: number,
): number | OperationResult<never> {
  const value = args.maxChars;
  if (value === undefined) return MAX_WEBMCP_TEXT_CHARS;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_WEBMCP_TEXT_CHARS) {
    return failResult(
      WEBMCP_ERROR_CODES.invalid_arguments,
      `maxChars must be an integer from 1 to ${MAX_WEBMCP_TEXT_CHARS}.`,
      { retryable: false, currentRevision },
    );
  }
  return value as number;
}

export function boundWebMcpText(value: string, maxChars: number): {
  text: string;
  truncated: boolean;
  totalCharacters: number;
} {
  let end = Math.min(value.length, maxChars);
  // Keep a Unicode surrogate pair together when the UTF-16 limit lands in it.
  if (end < value.length && end > 0 && value.charCodeAt(end - 1) >= 0xd800 && value.charCodeAt(end - 1) <= 0xdbff) {
    end -= 1;
  }
  return { text: value.slice(0, end), truncated: end < value.length, totalCharacters: value.length };
}

function countTodos(tex: string): number {
  return findMacroMatches(tex, ["obtodo"])
    .filter((match) => !todoIsComplete(parseAnchorAttrs(match.attrs)))
    .length;
}

function countMarkers(tex: string): number {
  return (tex.match(/\\obmarker\b/g) || []).length;
}

function outlineOf(snapshot: LivePaperSnapshot) {
  return snapshot.sections.map((section) => ({
    id: section.id,
    title: section.title,
    level: section.level,
    todoCount: countTodos(section.tex),
    markerCount: countMarkers(section.tex),
  }));
}

export function liveTodos(snapshot: LivePaperSnapshot): LivePaperTodo[] {
  if (snapshot.todos) return snapshot.todos;
  const todos: LivePaperTodo[] = [];
  for (const section of snapshot.sections) {
    for (const match of findMacroMatches(section.tex, ["obtodo"])) {
      const attrs = parseAnchorAttrs(match.attrs);
      const id = attrs.id;
      if (!id) continue;
      todos.push({
        id,
        ...(todoTitleFromAttrs(attrs) ? { title: todoTitleFromAttrs(attrs) } : {}),
        text: match.body.trim(),
        sectionId: section.id,
        completed: todoIsComplete(attrs),
        ...todoMetaFromAttrs(attrs),
      });
    }
  }
  return todos;
}

export function liveComments(snapshot: LivePaperSnapshot): LivePaperComment[] {
  if (snapshot.comments) return snapshot.comments;
  const comments: LivePaperComment[] = [];
  for (const section of snapshot.sections) {
    for (const note of analyzePaper(section.tex).comments) {
      if (note.macro !== "obcomment") continue;
      const kind = note.attrs.kind?.trim();
      comments.push({
        ...(note.id ? { id: note.id } : {}),
        ...(kind ? { kind } : {}),
        text: note.text,
        sectionId: section.id,
      });
    }
  }
  return comments;
}

export function liveMarkers(snapshot: LivePaperSnapshot): LivePaperMarker[] {
  if (snapshot.markers) return snapshot.markers;
  const markers: LivePaperMarker[] = [];
  for (const section of snapshot.sections) {
    for (const marker of analyzePaper(section.tex).markers) {
      markers.push({ kind: marker.kind, text: marker.text, sectionId: section.id });
    }
  }
  return markers;
}

export function findLiveSection(snapshot: LivePaperSnapshot, sectionId: string): OperationResult<LivePaperSection> {
  if (typeof sectionId !== "string" || !SECTION_ID_RE.test(sectionId)) {
    return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "sectionId must be a current section id.", {
      retryable: false,
      currentRevision: snapshot.revision,
    });
  }
  const section = snapshot.sections.find((item) => item.id === sectionId);
  if (!section) {
    return failResult(WEBMCP_ERROR_CODES.unknown_section, `Unknown section "${sectionId}".`, {
      retryable: false,
      currentRevision: snapshot.revision,
    });
  }
  return okResult(section, { revision: snapshot.revision });
}

export function assertLiveRevision(expectedRevision: unknown, currentRevision: number): OperationResult<number> {
  if (typeof expectedRevision !== "number" || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "expectedRevision must be a non-negative integer.", {
      retryable: false,
      currentRevision,
    });
  }
  if (expectedRevision !== currentRevision) {
    return failResult(
      WEBMCP_ERROR_CODES.stale_live_state,
      `Live paper revision is ${currentRevision}, not ${expectedRevision}. Reread, then retry.`,
      { retryable: true, currentRevision },
    );
  }
  return okResult(currentRevision, { revision: currentRevision });
}

export function requireKnownCitation(key: string, knownKeys: readonly string[]): OperationResult<{ key: string }> {
  if (typeof key !== "string" || !key.trim()) {
    return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "Citation key is required.", { retryable: false });
  }
  if (!knownKeys.includes(key)) {
    return failResult(WEBMCP_ERROR_CODES.unknown_citation, `Unknown citation "${key}".`, { retryable: false });
  }
  return okResult({ key });
}

export function requireKnownCitations(keys: readonly string[], knownKeys: readonly string[]): OperationResult<{ keys: string[] }> {
  for (const key of keys) {
    const check = requireKnownCitation(key, knownKeys);
    if (!check.ok) return check;
  }
  return okResult({ keys: [...keys] });
}

function defaultLint(snapshot: LivePaperSnapshot): { readiness?: string; diagnostics: WebMcpDiagnostic[] } {
  const diagnostics: WebMcpDiagnostic[] = [];
  for (const todo of liveTodos(snapshot).filter((item) => !item.completed)) {
    diagnostics.push({
      severity: "warning",
      code: "open-todo",
      message: todo.text || `Open TODO ${todo.id}`,
      sectionId: todo.sectionId,
    });
  }
  return { diagnostics };
}

function paperMutationFailure(host: PaperWebMcpHost, error: unknown): OperationResult<never> {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  const message = error instanceof Error ? error.message : String(error);
  const current = host.getSnapshot();
  const remoteFailure = current.remoteSync && current.remoteSync.status !== "pushed"
    ? { remote: current.remoteSync }
    : {};
  if (code === WEBMCP_ERROR_CODES.cancelled || /cancelled/i.test(message)) {
    return failResult(WEBMCP_ERROR_CODES.cancelled, message || "Operation cancelled.", {
      retryable: false,
      currentRevision: current.revision,
    });
  }
  if (code === WEBMCP_ERROR_CODES.stale_live_state || code === WEBMCP_ERROR_CODES.stale_selection) {
    return failResult(code, message, { retryable: true, currentRevision: current.revision });
  }
  if (code === WEBMCP_ERROR_CODES.stale_disk_state || /conflict|hash|changed on disk|stale/i.test(message)) {
    return failResult(WEBMCP_ERROR_CODES.stale_disk_state, message, {
      retryable: true,
      currentRevision: current.revision,
      currentHash: current.persistedHash,
    });
  }
  return failResult(code || "operation_failed", message || "Could not update the paper.", {
    retryable: true,
    currentRevision: current.revision,
    ...remoteFailure,
  });
}

function paperMutationSuccess<T>(host: PaperWebMcpHost, value: T): OperationResult<T> {
  const current = host.getSnapshot();
  return okResult(value, {
    revision: current.revision,
    ...(current.remoteSync ? { remote: current.remoteSync } : {}),
  });
}

async function executeNamed(
  host: PaperWebMcpHost,
  name: PaperWebMcpToolName,
  rawArgs: unknown,
  options?: { signal?: AbortSignal },
): Promise<OperationResult<unknown>> {
  const parsedArgs = parseWebMcpArgs(rawArgs);
  if (!parsedArgs.ok) return failResult(WEBMCP_ERROR_CODES.invalid_arguments, parsedArgs.message, { retryable: false });
  const args = parsedArgs.value;
  const unknown = unknownWebMcpArgument(args, PAPER_WEBMCP_TOOL_SCHEMAS[name]);
  if (unknown) return failResult(WEBMCP_ERROR_CODES.invalid_arguments, `Unknown argument "${unknown}".`, { retryable: false });
  const snapshot = host.getSnapshot();

  switch (name) {
    case "get_paper_state": {
      const outline = outlineOf(snapshot);
      const todos = liveTodos(snapshot);
      const comments = liveComments(snapshot);
      const markers = liveMarkers(snapshot);
      return okResult(
        {
          project: snapshot.project,
          title: snapshot.title,
          revision: snapshot.revision,
          dirty: snapshot.dirty,
          persistedHash: snapshot.persistedHash,
          pendingSave: snapshot.pendingSave ?? snapshot.dirty,
          remoteSync: snapshot.remoteSync,
          activeSection: snapshot.activeSectionId || snapshot.sections[0]?.id,
          outline,
          openTodoCount: todos.filter((todo) => !todo.completed).length,
          openMarkerCount: markers.length,
          comments,
          markers,
          sourceContext: snapshot.sourceContext,
          compileState: snapshot.compileState || { state: "idle" },
        },
        { revision: snapshot.revision },
      );
    }
    case "get_paper_outline":
      return okResult(outlineOf(snapshot), { revision: snapshot.revision });
    case "read_paper_section": {
      if (typeof args.sectionId !== "string") return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "sectionId must be a string.", { retryable: false, currentRevision: snapshot.revision });
      const found = findLiveSection(snapshot, args.sectionId);
      if (!found.ok) return found;
      const section = found.value;
      const maxChars = parseWebMcpMaxChars(args, snapshot.revision);
      if (typeof maxChars !== "number") return maxChars;
      const bounded = boundWebMcpText(section.tex, maxChars);
      return okResult(
        {
          sectionId: section.id,
          title: section.title,
          level: section.level,
          tex: bounded.text,
          truncated: bounded.truncated,
          totalCharacters: bounded.totalCharacters,
          revision: snapshot.revision,
          persistedHash: section.persistedHash,
          todos: liveTodos(snapshot).filter((todo) => todo.sectionId === section.id),
          comments: liveComments(snapshot).filter((comment) => comment.sectionId === section.id),
          markers: liveMarkers(snapshot).filter((marker) => marker.sectionId === section.id),
          tables: summarizeTabulars(section.tex),
        },
        { revision: snapshot.revision },
      );
    }
    case "preview_paper_todo": {
      if (typeof args.sectionId !== "string" || typeof args.text !== "string") {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "sectionId and text are required.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      if (args.title !== undefined && typeof args.title !== "string") {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "title must be a string.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      if (args.todoId !== undefined && typeof args.todoId !== "string") {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "todoId must be a string.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      const preview = previewTodoAtSection(snapshot.source, args.sectionId, args.text, typeof args.title === "string" ? args.title : undefined, typeof args.todoId === "string" ? args.todoId : undefined);
      if (!preview.sectionFound || preview.error) {
        return failResult(preview.sectionFound ? WEBMCP_ERROR_CODES.invalid_tex : WEBMCP_ERROR_CODES.unknown_section, preview.error || `Unknown paper section "${args.sectionId}".`, {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      return okResult(
        {
          todoId: preview.id,
          sectionId: preview.sectionId,
          filePath: preview.filePath,
          from: preview.from,
          to: preview.to,
          before: preview.before,
          after: preview.after,
          proposedText: preview.nextSource.slice(preview.from, preview.to),
          revision: snapshot.revision,
        },
        { revision: snapshot.revision },
      );
    }
    case "add_paper_todo_at_section": {
      const revision = assertLiveRevision(args.expectedRevision, snapshot.revision);
      if (!revision.ok) return revision;
      if (typeof args.sectionId !== "string" || typeof args.text !== "string") {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "sectionId and text are required.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      if (args.title !== undefined && typeof args.title !== "string") {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "title must be a string.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      if (args.todoId !== undefined && typeof args.todoId !== "string") {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "todoId must be a string.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      if (!host.addTodoAtSection) {
        return failResult(WEBMCP_ERROR_CODES.capability_unavailable, "The live paper page cannot add a section TODO.", {
          retryable: true,
          currentRevision: snapshot.revision,
        });
      }
      try {
        const placement = await host.addTodoAtSection(
          args.sectionId,
          args.text,
          typeof args.title === "string" ? args.title : undefined,
          typeof args.todoId === "string" ? args.todoId : undefined,
        );
        return paperMutationSuccess(host, placement);
      } catch (error) {
        return paperMutationFailure(host, error);
      }
    }
    case "relocate_paper_todo": {
      const revision = assertLiveRevision(args.expectedRevision, snapshot.revision);
      if (!revision.ok) return revision;
      if (typeof args.todoId !== "string" || typeof args.sectionId !== "string") {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "todoId and sectionId are required.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      if (!liveTodos(snapshot).some((todo) => todo.id === args.todoId)) {
        return failResult(WEBMCP_ERROR_CODES.unknown_todo, `Unknown TODO "${args.todoId}".`, {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      if (!host.relocateTodo) {
        return failResult(WEBMCP_ERROR_CODES.capability_unavailable, "The live paper page cannot relocate TODOs.", {
          retryable: true,
          currentRevision: snapshot.revision,
        });
      }
      try {
        const placement = await host.relocateTodo(args.todoId, args.sectionId);
        return paperMutationSuccess(host, placement);
      } catch (error) {
        return paperMutationFailure(host, error);
      }
    }
    case "navigate_paper_section": {
      if (typeof args.sectionId !== "string") return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "sectionId must be a string.", { retryable: false, currentRevision: snapshot.revision });
      const found = findLiveSection(snapshot, args.sectionId);
      if (!found.ok) return found;
      host.navigateSection(found.value.id);
      return okResult({ sectionId: found.value.id }, { revision: snapshot.revision });
    }
    case "set_paper_reader_mode": {
      const mode = args.mode;
      if (mode !== "document" && mode !== "pdf") {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, 'mode must be "document" or "pdf".', { retryable: false });
      }
      host.setReaderMode(mode);
      return okResult({ mode }, { revision: snapshot.revision });
    }
    case "replace_paper_section": {
      if (typeof args.sectionId !== "string") return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "sectionId must be a string.", { retryable: false, currentRevision: snapshot.revision });
      const found = findLiveSection(snapshot, args.sectionId);
      if (!found.ok) return found;
      const revision = assertLiveRevision(args.expectedRevision, snapshot.revision);
      if (!revision.ok) return revision;
      if (typeof args.tex !== "string") {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "tex must be a string.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      try {
        await host.replaceSection(found.value.id, args.tex, options?.signal);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
        const message = error instanceof Error ? error.message : "";
        const staleDisk = code === "stale_disk_state" || message.includes("stale_disk_state");
        const staleSelection = code === "stale_selection" || message.includes("stale_selection");
        const cancelled = code === "cancelled" || message.toLowerCase().includes("cancelled");
        if (cancelled) {
          return failResult(WEBMCP_ERROR_CODES.cancelled, "Operation cancelled.", {
            retryable: false,
            currentRevision: snapshot.revision,
          });
        }
        if (staleSelection || staleDisk) {
          return failResult(staleDisk ? "stale_disk_state" : "stale_selection", error instanceof Error ? error.message : "Source selection is stale.", {
            retryable: true,
            currentRevision: snapshot.revision,
            currentHash: error && typeof error === "object" && "currentHash" in error ? String((error as { currentHash?: unknown }).currentHash || "") : undefined,
          });
        }
        throw error;
      }
      return paperMutationSuccess(host,
        {
          sectionId: found.value.id,
          changed: { insertedCharacters: args.tex.length },
        },
      );
    }
    case "patch_paper_table": {
      if (typeof args.sectionId !== "string") {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "sectionId must be a string.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      const found = findLiveSection(snapshot, args.sectionId);
      if (!found.ok) return found;
      const revision = assertLiveRevision(args.expectedRevision, snapshot.revision);
      if (!revision.ok) return revision;
      if (!Number.isInteger(args.tableIndex) || (args.tableIndex as number) < 0) {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "tableIndex must be a non-negative integer.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      const updates = args.updates;
      if (!Array.isArray(updates) || updates.length !== 1) {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "patch_paper_table updates must contain exactly one cell.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      const update = updates[0];
      if (!update || typeof update !== "object" || Array.isArray(update)) {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "Each update needs row, column, and tex.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      const cell = update as Record<string, unknown>;
      if (!Number.isInteger(cell.row) || (cell.row as number) < 0 || !Number.isInteger(cell.column) || (cell.column as number) < 0) {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "row and column must be non-negative integers.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      if (typeof cell.tex !== "string") {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "tex must be a string.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      const patched = patchSectionTableCell(
        found.value.tex,
        args.tableIndex as number,
        cell.row as number,
        cell.column as number,
        cell.tex,
      );
      if (!patched.ok) {
        if (patched.reason === "complex") {
          return failResult(
            WEBMCP_ERROR_CODES.capability_unavailable,
            "This table is too complex for patch_paper_table. Use replace_paper_section and keep unrelated cells.",
            { retryable: false, currentRevision: snapshot.revision },
          );
        }
        return failResult(
          WEBMCP_ERROR_CODES.invalid_arguments,
          patched.reason === "missing_table" ? `No table ${args.tableIndex} in this section.` : "Unknown table cell.",
          { retryable: false, currentRevision: snapshot.revision },
        );
      }
      try {
        await host.replaceSection(found.value.id, patched.tex, options?.signal);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
        const message = error instanceof Error ? error.message : "";
        const staleDisk = code === "stale_disk_state" || message.includes("stale_disk_state");
        const staleSelection = code === "stale_selection" || message.includes("stale_selection");
        const cancelled = code === "cancelled" || message.toLowerCase().includes("cancelled");
        if (cancelled) {
          return failResult(WEBMCP_ERROR_CODES.cancelled, "Operation cancelled.", {
            retryable: false,
            currentRevision: snapshot.revision,
          });
        }
        if (staleSelection || staleDisk) {
          return failResult(staleDisk ? "stale_disk_state" : "stale_selection", error instanceof Error ? error.message : "Source selection is stale.", {
            retryable: true,
            currentRevision: snapshot.revision,
            currentHash: error && typeof error === "object" && "currentHash" in error ? String((error as { currentHash?: unknown }).currentHash || "") : undefined,
          });
        }
        throw error;
      }
      return paperMutationSuccess(host,
        {
          sectionId: found.value.id,
          tableIndex: args.tableIndex,
          row: cell.row,
          column: cell.column,
        },
      );
    }
    case "remove_paper_todo": {
      const revision = assertLiveRevision(args.expectedRevision, snapshot.revision);
      if (!revision.ok) return revision;
      if (typeof args.todoId !== "string") {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "todoId must be a string.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      const todoId = args.todoId;
      if (!SECTION_ID_RE.test(todoId)) {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "todoId must be a stable id.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      const todo = liveTodos(snapshot).find((item) => item.id === todoId);
      if (!todo) {
        return failResult(WEBMCP_ERROR_CODES.unknown_todo, `Unknown TODO "${todoId}".`, {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      try {
        await host.removeTodo(todo.id, options?.signal);
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code: string }).code) : "";
        const message = error instanceof Error ? error.message : "";
        const staleDisk = code === "stale_disk_state" || message.includes("stale_disk_state");
        const staleSelection = code === "stale_selection" || message.includes("stale_selection");
        const cancelled = code === "cancelled" || message.toLowerCase().includes("cancelled");
        if (cancelled) {
          return failResult(WEBMCP_ERROR_CODES.cancelled, "Operation cancelled.", {
            retryable: false,
            currentRevision: snapshot.revision,
          });
        }
        if (staleSelection || staleDisk) {
          return failResult(staleDisk ? "stale_disk_state" : "stale_selection", error instanceof Error ? error.message : "TODO selection is stale.", {
            retryable: true,
            currentRevision: snapshot.revision,
            currentHash: error && typeof error === "object" && "currentHash" in error ? String((error as { currentHash?: unknown }).currentHash || "") : undefined,
          });
        }
        throw error;
      }
      return paperMutationSuccess(host, { todoId: todo.id });
    }
    case "lint_paper": {
      const report = host.lint ? host.lint() : defaultLint(snapshot);
      return okResult(report, { revision: snapshot.revision, warnings: report.diagnostics });
    }
    case "compile_paper": {
      try {
        const started = await host.compile(options?.signal);
        return okResult(started, { revision: host.getSnapshot().revision });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
        if (code === "cancelled" || (error instanceof Error && error.message.toLowerCase().includes("cancelled"))) {
          return failResult(WEBMCP_ERROR_CODES.cancelled, "Operation cancelled.", {
            retryable: false,
            currentRevision: host.getSnapshot().revision,
          });
        }
        const message = error instanceof Error ? error.message : "Compilation failed.";
        const rawDiagnostics = error && typeof error === "object" && Array.isArray((error as { diagnostics?: unknown }).diagnostics)
          ? (error as { diagnostics: unknown[] }).diagnostics.filter((item): item is string => typeof item === "string")
          : [];
        return failResult(
          WEBMCP_ERROR_CODES.compile_failed,
          message,
          {
            retryable: true,
            currentRevision: host.getSnapshot().revision,
            diagnostics: (rawDiagnostics.length ? rawDiagnostics : [message]).map((diagnostic) => ({
              severity: "error" as const,
              code: "compile",
              message: diagnostic,
            })),
          },
        );
      }
    }
    case "get_paper_compile": {
      const compile = snapshot.compileState || { state: "idle" };
      if (args.jobId !== undefined && typeof args.jobId !== "string") {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "jobId must be a string.", {
          retryable: false,
          currentRevision: snapshot.revision,
        });
      }
      return okResult({
        ...compile,
        ...(args.jobId !== undefined ? { jobIdMatches: compile.jobId === args.jobId } : {}),
        pdfCurrent: compile.state === "success" && compile.stale !== true && Boolean(compile.sourceHash && compile.sourceHash === snapshot.persistedHash),
      }, { revision: snapshot.revision });
    }
    case "get_bibliography": {
      if (args.raw !== undefined && typeof args.raw !== "boolean") {
        return failResult(WEBMCP_ERROR_CODES.invalid_arguments, "raw must be a boolean.", { retryable: false, currentRevision: snapshot.revision });
      }
      const raw = args.raw === true;
      const maxChars = parseWebMcpMaxChars(args, snapshot.revision);
      if (typeof maxChars !== "number") return maxChars;
      const bounded = raw && snapshot.bibliographyRaw != null
        ? boundWebMcpText(snapshot.bibliographyRaw, maxChars)
        : undefined;
      return okResult(
        {
          keys: snapshot.bibliographyKeys,
          ...(bounded ? {
            raw: bounded.text,
            truncated: bounded.truncated,
            totalCharacters: bounded.totalCharacters,
          } : {}),
        },
        { revision: snapshot.revision },
      );
    }
  }
}

export async function executePaperWebMcpTool(
  host: PaperWebMcpHost,
  name: string,
  args?: unknown,
  options?: { signal?: AbortSignal },
): Promise<OperationResult<unknown>> {
  if (!isPaperWebMcpToolName(name)) {
    return failResult(WEBMCP_ERROR_CODES.invalid_arguments, `Unknown paper tool "${name}".`, { retryable: false });
  }
  return executeNamed(host, name, args, options);
}

export function buildPaperWebMcpTools(host: PaperWebMcpHost): PaperWebMcpTool[] {
  return PAPER_WEBMCP_TOOL_NAMES.map((name) => {
    const meta = TOOL_META[name];
    return {
      name,
      title: meta.title,
      description: meta.description,
      inputSchema: PAPER_WEBMCP_TOOL_SCHEMAS[name],
      annotations: { readOnlyHint: meta.readOnly, untrustedContentHint: true },
      execute: (args, options) => executePaperWebMcpTool(host, name, args, options),
    };
  });
}
