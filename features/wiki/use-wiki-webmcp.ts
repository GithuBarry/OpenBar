"use client";

import { useEffect, useRef } from "react";

import { buildDocumentWebMcpTools, type DocumentWebMcpHost } from "@/lib/research/webmcp-document-contract";
import { buildSharedWebMcpTools } from "@/lib/research/webmcp-shared-contract";
import { registerWebMcpToolsIndependent, waitForModelContext } from "@/lib/research/webmcp-register";

export function useWikiWebMcp(host: DocumentWebMcpHost): void {
  const hostRef = useRef(host);
  hostRef.current = host;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let release: (() => void) | undefined;
    (async () => {
      const modelContext = await waitForModelContext(30_000, controller.signal);
      if (!active || controller.signal.aborted || !modelContext?.registerTool) return;
      const bound = hostRef.current;
      const tools = [
        ...buildDocumentWebMcpTools(bound),
        ...buildSharedWebMcpTools({
          project: bound.project,
          actions: bound.sharedActions,
          navigate: (href) => hostRef.current.navigate?.(href),
          current: () => hostRef.current.current?.(),
        }),
      ];
      const registration = await registerWebMcpToolsIndependent(
        modelContext.registerTool.bind(modelContext),
        tools,
        controller.signal,
      );
      release = registration.release;
      if (active && !controller.signal.aborted) {
        window.dispatchEvent(new CustomEvent("webmcp-ready", {
          detail: { tools: registration.registered, diagnostics: registration.diagnostics, surface: "wiki" },
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
  }, [host.project, host.documentId, host.kind]);
}
