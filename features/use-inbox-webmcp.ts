"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { INBOX_INPUTS } from "@/lib/research/command-inputs";
import { commandJsonSchemas, parseCommandInput } from "@/lib/research/command-schema";
import { AGENT_INBOX_ACTOR_HEADER, INBOX_TOOL_DESCRIPTIONS } from "@/lib/research/agent-inbox-contract";
import { failResult, isOperationResult, type OperationResult } from "@/lib/research/operation-result";
import { registerWebMcpToolsIndependent, waitForModelContext, type WebMcpTool } from "@/lib/research/webmcp-register";

const SCHEMAS = commandJsonSchemas(INBOX_INPUTS);
const NAMES = ["check_inbox", "claim_inbox", "acknowledge_inbox"] as const;

export async function requestInbox<T>(
  method: "GET" | "POST" | "PATCH",
  project: string | undefined,
  input: Record<string, unknown> = {},
  signal?: AbortSignal,
  actor: "human" | "webmcp" = "human",
): Promise<OperationResult<T>> {
  const query = new URLSearchParams();
  if (project) query.set("project", project);
  if (typeof input.limit === "number") query.set("limit", String(input.limit));
  if (input.includeAcknowledged === true) query.set("includeAcknowledged", "true");
  try {
    const response = await fetch(`/api/agent-inbox${method === "GET" && query.size ? `?${query}` : ""}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal,
      ...(method === "POST" || method === "PATCH" ? {
        headers: { "Content-Type": "application/json", [AGENT_INBOX_ACTOR_HEADER]: actor },
        body: JSON.stringify({ ...input, ...(project ? { project } : {}) }),
      } : {}),
    });
    const result: unknown = await response.json();
    return isOperationResult(result)
      ? result as OperationResult<T>
      : failResult("operation_failed", "The inbox response was incomplete. Check updates again.", true);
  } catch (error) {
    return signal?.aborted
      ? failResult("cancelled", "The inbox request was cancelled.", false)
      : failResult("operation_failed", error instanceof Error ? error.message : "The inbox is unavailable. Check updates again.", true);
  }
}

export function useInboxProject(): string | undefined {
  const pathname = usePathname();
  const segment = pathname.match(/^\/p\/([^/]+)(?:\/|$)/)?.[1];
  return segment ? decodeURIComponent(segment) : undefined;
}

/** Mount with the project shell or workspace, independently of visible controls. */
export function useInboxWebMcp(project?: string): void {
  useEffect(() => {
    const controller = new AbortController();
    let release: (() => void) | undefined;
    void (async () => {
      const modelContext = await waitForModelContext(30_000, controller.signal);
      if (controller.signal.aborted || !modelContext) return;
      const tools: WebMcpTool[] = NAMES.map((name) => ({
        name,
        title: name === "check_inbox" ? "Check OpenBar updates" : name === "claim_inbox" ? "Mark inbox mentions as actively in progress" : "Mark inbox messages handled or reopen them",
        description: INBOX_TOOL_DESCRIPTIONS[name],
        inputSchema: SCHEMAS[name],
        annotations: { readOnlyHint: name === "check_inbox", untrustedContentHint: true },
        execute: async (raw, options) => {
          const parsed = parseCommandInput(INBOX_INPUTS[name], raw, true);
          if (!parsed.ok) return parsed;
          const signal = options?.signal
            ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
          const method = name === "check_inbox" ? "GET" : name === "claim_inbox" ? "PATCH" : "POST";
          const result = await requestInbox(method, project, parsed.value, signal, "webmcp");
          if (result.ok && name !== "check_inbox") window.dispatchEvent(new Event("openbar-inbox-updated"));
          return result;
        },
      }));
      const registration = await registerWebMcpToolsIndependent(modelContext, tools, controller.signal, project ? "shared" : "workspace");
      release = registration.release;
      if (controller.signal.aborted) release();
    })();
    return () => {
      controller.abort();
      release?.();
    };
  }, [project]);

}
