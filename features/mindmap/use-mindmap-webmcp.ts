"use client";

import { useEffect, useRef } from "react";

import { buildMindmapWebMcpTools, type MindmapWebMcpHost } from "@/lib/research/webmcp-mindmap-contract";
import { buildSharedWebMcpTools } from "@/lib/research/webmcp-shared-contract";
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
        addNode: (parentId, text, expectedRevision) => hostRef.current.addNode(parentId, text, expectedRevision),
        renameNode: (id, text, expectedRevision) => hostRef.current.renameNode(id, text, expectedRevision),
        moveNode: (id, parentId, beforeId, afterId, expectedRevision) => hostRef.current.moveNode(id, parentId, beforeId, afterId, expectedRevision),
        deleteNode: (id, expectedRevision) => hostRef.current.deleteNode(id, expectedRevision),
        setCollapsed: (id, collapsed, expectedRevision) => hostRef.current.setCollapsed(id, collapsed, expectedRevision),
        setPresentation: (id, patch, expectedRevision) => hostRef.current.setPresentation(id, patch, expectedRevision),
        linkArtifact: (id, kind, artifactId, label, url, expectedRevision) => hostRef.current.linkArtifact(id, kind, artifactId, label, url, expectedRevision),
        setActivityHighlight: (since) => hostRef.current.setActivityHighlight(since),
      };
      const tools = [
        ...buildMindmapWebMcpTools(bound),
        ...(bound.sharedActions
          ? buildSharedWebMcpTools({ project: bound.getSnapshot().project, actions: bound.sharedActions })
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
          detail: { tools: registration.registered, diagnostics: registration.diagnostics, surface: "mindmap" },
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
