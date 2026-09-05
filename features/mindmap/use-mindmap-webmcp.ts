"use client";

import { useEffect, useRef } from "react";

import { buildMindmapWebMcpTools, type MindmapTodoConversionResult, type MindmapWebMcpHost } from "@/lib/research/webmcp-mindmap-contract";
import { registerWebMcpToolsIndependent, waitForModelContext } from "@/lib/research/webmcp-register";

export function useMindmapWebMcp(host: MindmapWebMcpHost): void {
  const hostRef = useRef(host);
  hostRef.current = host;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let release: (() => void) | undefined;
    (async () => {
      const modelContext = await waitForModelContext(30_000, controller.signal);
      if (!active || controller.signal.aborted || !modelContext?.registerTool) return;
      const bound: MindmapWebMcpHost = {
        sharedActions: hostRef.current.sharedActions,
        getSnapshot: () => hostRef.current.getSnapshot(),
        focusNode: (id) => hostRef.current.focusNode(id),
        addNode: (parentId, text, expectedRevision, title) => hostRef.current.addNode(parentId, text, expectedRevision, title),
        moveNode: (id, parentId, beforeId, afterId, expectedRevision) => hostRef.current.moveNode(id, parentId, beforeId, afterId, expectedRevision),
        deleteNode: (id, expectedRevision) => hostRef.current.deleteNode(id, expectedRevision),
        deleteBranch: (id, expectedRevision) => hostRef.current.deleteBranch?.(id, expectedRevision),
        setCollapsed: (id, collapsed, expectedRevision) => hostRef.current.setCollapsed(id, collapsed, expectedRevision),
        patchNode: (id, patch, expectedRevision) => hostRef.current.patchNode(id, patch, expectedRevision),
        setActivityHighlight: (since) => hostRef.current.setActivityHighlight(since),
        placeTodoCard: (todoId, parentId, expectedRevision) => hostRef.current.placeTodoCard?.(todoId, parentId, expectedRevision) as Promise<string>,
        convertCardToTodo: (id, sectionId, expectedRevision, requestId) => hostRef.current.convertCardToTodo?.(id, sectionId, expectedRevision, requestId) as MindmapTodoConversionResult | Promise<MindmapTodoConversionResult>,
        completeTodo: (todoId) => hostRef.current.completeTodo?.(todoId),
        reopenTodo: (todoId) => hostRef.current.reopenTodo?.(todoId),
        focusTodoInPaper: (todoId) => hostRef.current.focusTodoInPaper?.(todoId),
        renameMap: (title, expectedRevision) => hostRef.current.renameMap?.(title, expectedRevision),
      };
      const tools = [...buildMindmapWebMcpTools(bound)];
      const registration = await registerWebMcpToolsIndependent(
        modelContext,
        tools,
        controller.signal,
        "mindmap",
      );
      release = registration.release;
      if (!active || controller.signal.aborted) release();
    })();
    return () => {
      active = false;
      controller.abort();
      release?.();
    };
  }, []);
}
