"use client";

import { useQuery } from "@tanstack/react-query";
import { requestInbox } from "@/features/use-inbox-webmcp";
import type { AgentInbox } from "@/lib/research/agent-inbox-contract";

export const agentInboxKey = (project?: string) => ["openbar", "inbox", project ?? null] as const;

export function useAgentInbox(project?: string, includeAcknowledged = false) {
  return useQuery({
    queryKey: [...agentInboxKey(project), includeAcknowledged],
    queryFn: async ({ signal }) => {
      const result = await requestInbox<AgentInbox>("GET", project, { limit: 50, includeAcknowledged }, signal);
      if (!result.ok) throw new Error(result.message);
      return result.value;
    },
  });
}
