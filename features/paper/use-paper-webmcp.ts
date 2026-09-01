"use client";

import { useEffect, useRef } from "react";
import { Annotation } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import {
  buildPaperWebMcpTools,
  type LivePaperSection,
  type LivePaperSnapshot,
  type LivePaperTodo,
} from "@/lib/research/webmcp-paper-contract";
import { buildPaperSourceWebMcpTools, type PaperSourceHost } from "@/lib/research/webmcp-source-contract";
import { buildSharedWebMcpTools } from "@/lib/research/webmcp-shared-contract";
import { registerWebMcpToolsIndependent, waitForModelContext } from "@/lib/research/webmcp-register";
import { lintDraft } from "@/lib/transparency-lint";
import { lintProsePercentages } from "@/lib/tex-project/tex-lint";
import { suspiciousTexSequences } from "@/lib/tex-project/tex-repair";

import {
  collectEditorTodos,
  listBookmarks,
  parseEditorSections,
  type PaperEditorSection,
} from "./tex-source";

export const webmcpOrigin = Annotation.define<"human" | "webmcp">();

interface WebMcpModelContext {
  registerTool: (
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema?: unknown;
      annotations?: { readOnlyHint?: boolean };
      execute: (
        args: Record<string, unknown>,
        options?: { signal?: AbortSignal },
      ) => Promise<unknown> | unknown;
    },
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
}

declare global {
  interface Document {
    readonly modelContext?: WebMcpModelContext;
  }
}

function isChromeLine(line: string): boolean {
  const t = line.trim();
  return /^\\appendix\b/.test(t) || /^\\input\s*\{openbarry\/references(?:\.tex)?\}(?:\s*%.*)?$/.test(t);
}

function offsetAtLine(source: string, line: number): number {
  if (line <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") {
      seen += 1;
      if (seen === line) return i + 1;
    }
  }
  return source.length;
}

function matchHeading(
  bookmarks: ReturnType<typeof listBookmarks>,
  sections: LivePaperSection[],
  sectionId: string,
) {
  const section = sections.find((item) => item.id === sectionId);
  if (!section) return undefined;
  const prior = sections.filter((item) => item.id !== sectionId && sections.indexOf(item) < sections.indexOf(section) && item.title.toLowerCase() === section.title.toLowerCase()).length;
  let seen = 0;
  for (const bookmark of bookmarks) {
    if (bookmark.title.toLowerCase() !== section.title.toLowerCase()) continue;
    if (seen === prior) return bookmark;
    seen += 1;
  }
  return undefined;
}

export function sectionBodyRange(
  source: string,
  expected: PaperEditorSection[],
  sectionId: string,
): { from: number; to: number } | null {
  const parsed = parseEditorSections(source, expected);
  if (parsed.error || !parsed.sections.length) return null;
  const sections = parsed.sections.map((section) => ({
    id: section.id,
    title: section.title,
    level: section.level,
    tex: section.tex,
  }));
  const heading = matchHeading(listBookmarks(source), sections, sectionId);
  if (!heading) return null;
  const endHeading = listBookmarks(source).find((bookmark) => bookmark.line > heading.line && bookmark.level <= heading.level);
  const from = offsetAtLine(source, heading.line + 1);
  let to = endHeading ? offsetAtLine(source, endHeading.line) : source.length;
  const body = source.slice(from, to);
  const lines = body.split("\n");
  while (lines.length && isChromeLine(lines[lines.length - 1]!)) lines.pop();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  to = from + (lines.length ? lines.join("\n").length : 0);
  return { from, to };
}

export function liveSnapshotFromSource(input: {
  project: string;
  title: string;
  source: string;
  revision: number;
  dirty: boolean;
  persistedHash?: string;
  pendingSave?: boolean;
  sourceSegments?: Array<{ filePath: string; editable: boolean }>;
  activeHeadingKey?: string;
  compileState?: { state: string; sourceHash?: string };
  bibliographyKeys: string[];
  bibliographyRaw?: string;
  expected: PaperEditorSection[];
}): LivePaperSnapshot {
  const parsed = parseEditorSections(input.source, input.expected);
  const bookmarks = listBookmarks(input.source);
  const sections: LivePaperSection[] = [];
  if (!parsed.error) {
    let cursor = 0;
    for (const section of parsed.sections) {
      const heading = bookmarks.find((bookmark, index) =>
        index >= cursor && bookmark.title.toLowerCase() === section.title.toLowerCase(),
      );
      if (heading) cursor = bookmarks.indexOf(heading) + 1;
      const original = input.expected.find((item) => item.id === section.id);
      sections.push({
        id: section.id,
        title: section.title,
        level: section.level,
        tex: section.tex,
        headingKey: heading?.slug,
        persistedHash: original?.hash,
      });
    }
  }

  const todos: LivePaperTodo[] = collectEditorTodos(input.source).flatMap((todo) => {
    if (!todo.id) return [];
    const section = sections.find((item) => item.title.toLowerCase() === todo.section.toLowerCase());
    return [{
      id: todo.id,
      text: todo.text,
      sectionId: section?.id,
      priority: todo.priority,
      due: todo.due,
      owner: todo.owner,
      createdAt: todo.createdAt,
    }];
  });

  let activeSectionId = sections[0]?.id;
  if (input.activeHeadingKey) {
    const exact = sections.find((section) => section.headingKey === input.activeHeadingKey);
    if (exact) {
      activeSectionId = exact.id;
    } else {
      const bookmarkIndex = bookmarks.findIndex((bookmark) => bookmark.slug === input.activeHeadingKey);
      if (bookmarkIndex >= 0) {
        for (let i = bookmarkIndex; i >= 0; i--) {
          const parent = sections.find((section) => section.headingKey === bookmarks[i]!.slug);
          if (parent) {
            activeSectionId = parent.id;
            break;
          }
        }
      }
    }
  }

  return {
    project: input.project,
    title: parsed.title || input.title,
    revision: input.revision,
    source: input.source,
    sections,
    activeSectionId,
    dirty: input.dirty,
    ...(input.persistedHash ? { persistedHash: input.persistedHash } : {}),
    ...(input.pendingSave != null ? { pendingSave: input.pendingSave } : {}),
    ...(input.sourceSegments ? { sourceSegments: input.sourceSegments } : {}),
    compileState: input.compileState,
    bibliographyKeys: input.bibliographyKeys,
    ...(input.bibliographyRaw != null ? { bibliographyRaw: input.bibliographyRaw } : {}),
    todos,
  };
}

export function lintLivePaper(source: string): { readiness?: string; diagnostics: { severity: "error" | "warning"; code: string; message: string; sectionId?: string }[] } {
  const lints = lintDraft(source);
  const diagnostics = [
    ...lints.map((lint) => ({
      severity: (lint.severity === "blocker" ? "error" : "warning") as "error" | "warning",
      code: lint.id,
      message: lint.title,
    })),
    ...lintProsePercentages(source).map((fix) => ({
      severity: "warning" as const,
      code: "prose-percent",
      message: fix.message,
    })),
    ...suspiciousTexSequences(source).map((code) => ({
      severity: "warning" as const,
      code,
      message: `Suspicious TeX sequence: ${code}`,
    })),
  ];
  return {
    readiness: lints.some((lint) => lint.severity === "blocker") ? "blocked" : diagnostics.length ? "needs-work" : "clear",
    diagnostics,
  };
}

export function applyWebMcpChange(
  view: EditorView | null,
  from: number,
  to: number,
  insert: string,
  onFallback: (next: string) => void,
  fallbackSource: string,
): void {
  if (view) {
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      scrollIntoView: true,
      annotations: [webmcpOrigin.of("webmcp")],
    });
    view.focus();
    return;
  }
  onFallback(`${fallbackSource.slice(0, from)}${insert}${fallbackSource.slice(to)}`);
}

export function usePaperWebMcp(host: PaperSourceHost): void {
  const hostRef = useRef(host);
  hostRef.current = host;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let release: (() => void) | undefined;

    (async () => {
      const modelContext = await waitForModelContext(30_000, controller.signal);
      if (!active || controller.signal.aborted || !modelContext?.registerTool) return;
      const bound: PaperSourceHost = {
        sharedActions: hostRef.current.sharedActions,
        getSnapshot: () => hostRef.current.getSnapshot(),
        navigateSection: (sectionId) => hostRef.current.navigateSection(sectionId),
        setReaderMode: (mode) => hostRef.current.setReaderMode(mode),
        replaceSection: (sectionId, tex, signal) => hostRef.current.replaceSection(sectionId, tex, signal),
        resolveTodo: (todoId, signal) => hostRef.current.resolveTodo(todoId, signal),
        compile: (signal) => hostRef.current.compile(signal),
        lint: () => (hostRef.current.lint ? hostRef.current.lint() : { diagnostics: [] }),
        replaceRange: (from, to, text, signal) => hostRef.current.replaceRange(from, to, text, signal),
      };
      const tools = [
        ...buildPaperWebMcpTools(bound),
        ...buildPaperSourceWebMcpTools(bound),
        ...(bound.sharedActions
          ? buildSharedWebMcpTools({
              project: bound.getSnapshot().project,
              liveSource: () => bound.getSnapshot().source,
              navigate: (href) => hostRef.current.navigate?.(href),
              current: () => hostRef.current.current?.(),
              actions: bound.sharedActions,
            })
          : []),
      ];
      const registration = await registerWebMcpToolsIndependent(
        modelContext.registerTool.bind(modelContext),
        tools,
        controller.signal,
      );
      release = registration.release;
      if (active && !controller.signal.aborted) {
        window.dispatchEvent(new CustomEvent("webmcp-ready", {
          detail: { tools: registration.registered, diagnostics: registration.diagnostics },
        }));
      } else {
        release();
      }
    })();

    return () => {
      active = false;
      controller.abort();
      release?.();
    };
  }, []);
}
