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
    let releases: Array<() => void> = [];
    (async () => {
      const modelContext = await waitForModelContext(30_000, controller.signal);
      if (!active || controller.signal.aborted || !modelContext?.registerTool) return;
      const bound = hostRef.current;
      const sharedHost = {
        project: bound.project,
        actions: bound.sharedActions,
        navigate: (href: string) => hostRef.current.navigate?.(href),
        current: () => hostRef.current.current?.(),
      };
      const registrations = await Promise.all([
        registerWebMcpToolsIndependent(
          modelContext,
          [
            ...buildInstructionsWebMcpTools(bound),
            ...buildProjectSkillWebMcpTools(sharedHost),
          ],
          controller.signal,
          "instructions",
        ),
        registerWebMcpToolsIndependent(
          modelContext,
          buildSetupWebMcpTools(sharedHost),
          controller.signal,
          "setup",
        ),
      ]);
      releases = registrations.map((registration) => registration.release);
      if (!active || controller.signal.aborted) releases.forEach((release) => release());
    })();
    return () => {
      active = false;
      controller.abort();
      releases.forEach((release) => release());
    };
  }, [host.project]);
}
