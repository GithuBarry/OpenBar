"use client";

import { useEffect, useRef } from "react";

import { buildInstructionsWebMcpTools, type InstructionsWebMcpHost } from "@/lib/research/webmcp-instructions-contract";
import {
  buildInstructionsWebMcpTools as buildProjectSkillWebMcpTools,
  buildSetupWebMcpTools,
} from "@/lib/research/webmcp-shared-contract";
import { registerWebMcpToolsIndependent, waitForModelContext } from "@/lib/research/webmcp-register";

export function useInstructionsWebMcp(host: InstructionsWebMcpHost): void {
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
        ...buildInstructionsWebMcpTools(bound),
        ...buildProjectSkillWebMcpTools({
          project: bound.project,
          actions: bound.sharedActions,
          navigate: (href) => hostRef.current.navigate?.(href),
          current: () => hostRef.current.current?.(),
        }),
        ...buildSetupWebMcpTools({
          project: bound.project,
          actions: bound.sharedActions,
          navigate: (href) => hostRef.current.navigate?.(href),
          current: () => hostRef.current.current?.(),
        }),
      ];
      const registration = await registerWebMcpToolsIndependent(
        modelContext,
        tools,
        controller.signal,
        "instructions",
      );
      release = registration.release;
      if (!active || controller.signal.aborted) release();
    })();
    return () => {
      active = false;
      controller.abort();
      release?.();
    };
  }, [host.project]);
}
