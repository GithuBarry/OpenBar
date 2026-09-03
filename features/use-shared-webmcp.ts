"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { sharedWebMcpActions } from "@/features/webmcp-actions";
import { buildSharedWebMcpTools, type CurrentLocation, type SharedWebMcpProfile } from "@/lib/research/webmcp-shared-contract";
import { registerWebMcpToolsIndependent, waitForModelContext } from "@/lib/research/webmcp-register";

export function useSharedProjectWebMcp(input: {
  project: string;
  current: CurrentLocation | (() => CurrentLocation | undefined);
  profile?: SharedWebMcpProfile;
}): void {
  const router = useRouter();
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let release: (() => void) | undefined;
    (async () => {
      const modelContext = await waitForModelContext(30_000, controller.signal);
      if (!active || controller.signal.aborted || !modelContext?.registerTool) return;
      const tools = buildSharedWebMcpTools({
        project: inputRef.current.project,
        actions: sharedWebMcpActions,
        navigate: (href) => router.push(href),
        current: () => {
          const value = inputRef.current.current;
          return typeof value === "function" ? value() : value;
        },
      }, inputRef.current.profile || "full");
      const registration = await registerWebMcpToolsIndependent(
        modelContext,
        tools,
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
  }, [input.profile, input.project, router]);
}
