"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { workspaceWebMcpActions } from "@/features/webmcp-actions";
import {
  buildWorkspaceWebMcpTools,
  type WorkspaceWebMcpHost,
} from "@/lib/research/webmcp-workspace-contract";
import { registerWebMcpToolsIndependent, waitForModelContext } from "@/lib/research/webmcp-register";

export function useWorkspaceWebMcp(host: WorkspaceWebMcpHost): void {
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
      const registration = await registerWebMcpToolsIndependent(
        modelContext,
        buildWorkspaceWebMcpTools(bound),
        controller.signal,
        "shared",
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

/** Client-only mount for the workspace catalog on the home page. */
export function WorkspaceWebMcp() {
  const router = useRouter();
  useWorkspaceWebMcp({
    actions: workspaceWebMcpActions,
    navigate: (href) => router.push(href),
  });
  return null;
}
