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

import type { BibliographyImportResult } from "@/lib/bibtex";
import { MINDMAP_INPUTS,PAPER_INPUTS } from "./command-inputs";
import { commandJsonSchemas,parseCommandInput } from "./command-schema";

import { findMacroMatches,parseAnchorAttrs } from "@/lib/marker-codec";
import { todoIsComplete,todoMetaFromAttrs,todoTitleFromAttrs } from "@/lib/todo-meta";
import type { OperationResult,RemoteSyncOutcome,OperationDiagnostic as WebMcpDiagnostic } from "./operation-result";
import {
failResult,
okResult,
WEBMCP_ERROR_CODES,
} from "./operation-result";
import { analyzePaper } from "./paper-analysis";

export {
failResult,
isOperationResult,
okResult,
OPERATION_ERROR_CODES,
WEBMCP_ERROR_CODES
} from "./operation-result";
export type {
OperationDiagnostic,OperationResult,OperationDiagnostic as WebMcpDiagnostic,
OperationErrorCode as WebMcpErrorCode
} from "./operation-result";

export const SECTION_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$";
export const SECTION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const PAPER_WEBMCP_TOOL_NAMES = ["get_paper_state","navigate_paper_section","set_paper_reader_mode","compile_paper","get_paper_compile"] as const;

export type PaperWebMcpToolName = (typeof PAPER_WEBMCP_TOOL_NAMES)[number];

/** Mindmap page capabilities. Must not be registered on a paper page. */
export const MINDMAP_WEBMCP_TOOL_NAMES = ["get_mindmap","focus_mindmap_node","set_mindmap_collapsed","highlight_mindmap_activity","focus_todo_in_paper","apply_mindmap_edits"] as const;

export type MindmapWebMcpToolName = keyof typeof MINDMAP_INPUTS;

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
  importBibtex?: (bibtex: string, expectedHash: string, signal?: AbortSignal) =>
    OperationResult<BibliographyImportResult> | Promise<OperationResult<BibliographyImportResult>>;
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

export const MAX_WEBMCP_TEXT_CHARS = 200_000;

export const PAPER_WEBMCP_TOOL_SCHEMAS = commandJsonSchemas(PAPER_INPUTS);

const TOOL_META: Record<PaperWebMcpToolName, { title: string; description: string; readOnly: boolean }> = {
  get_paper_state: {
    title: "Read live paper state",
    description:
      "Return the live paper snapshot: revision, dirty flag, active section, outline, open TODO count, comments, markers, and compile state. Call this after navigate_project lands on the paper page. Project is fixed by the open page. \\obmarker is a paper-local hole, not a mindmap TODO.",
    readOnly: true,
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
  compile_paper: {
    title: "Compile the paper",
    description: "Flush live edits onto the ordinary save path and start compilation. Returns the source hash being compiled. The human PDF preview updates when the build finishes.",
    readOnly: false,
  },
  get_paper_compile: {
    title: "Read paper compile result",
    description: "Read the current compile job, exact source hash, parsed file/line diagnostics, bounded raw log, and stale/PDF-current state. Poll this tool with the returned jobId until the state is no longer running; compile success is not research completion.",
    readOnly: true,
  }
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

async function executeNamed(
  host: PaperWebMcpHost,
  name: PaperWebMcpToolName,
  rawArgs: unknown,
  options?: { signal?: AbortSignal },
): Promise<OperationResult<unknown>> {
  const parsedArgs = parseCommandInput(PAPER_INPUTS[name], rawArgs, true);
  if (!parsedArgs.ok) return failResult(WEBMCP_ERROR_CODES.invalid_arguments, parsedArgs.message, { retryable: false });
  const args = parsedArgs.value;
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
        pdfCurrent: !snapshot.dirty && !snapshot.pendingSave && compile.state === "success" && compile.stale !== true && Boolean(compile.artifactBuildInputHash && compile.artifactBuildInputHash === compile.buildInputHash),
      }, { revision: snapshot.revision });
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
