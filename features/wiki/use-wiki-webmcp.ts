"use client";

import { useEffect, useRef } from "react";

import { buildDocumentWebMcpTools, type DocumentWebMcpHost } from "@/lib/research/webmcp-document-contract";
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
      const tools = [...buildDocumentWebMcpTools(bound)];
      const registration = await registerWebMcpToolsIndependent(
        modelContext,
        tools,
        controller.signal,
        "wiki",
      );
      release = registration.release;
      if (!active || controller.signal.aborted) release();
    })();
    return () => {
      active = false;
      controller.abort();
      release?.();
    };
  }, [host.project, host.documentId, host.kind]);
}
