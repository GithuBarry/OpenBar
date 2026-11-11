import { z } from "zod";
import { commandJsonSchema, parseCommandInput } from "./command-schema";
import { failResult, okResult } from "./operation-result";
import { PROJECT_WRITE_SESSION_IDLE_MS, type ProjectWriteSessionStatus } from "./project-write-session-contract";
import type { WebMcpTool } from "./webmcp-register";

const inputs = {
  get_editing_session: z.strictObject({}),
  resume_edit: z.strictObject({
    expectedOwnerGeneration: z.uuid().nullable().describe("Exact ownerGeneration from get_editing_session. null expects an available project. A UUID explicitly transfers that observed session's editing access here."),
  }),
};

export type SessionWebMcpHost = {
  inspect: () => Promise<ProjectWriteSessionStatus>;
  resumeEdit: (expectedOwnerGeneration: string | null) => Promise<ProjectWriteSessionStatus>;
  pendingLocalWork: () => boolean;
};

export function buildSessionWebMcpTools(host: SessionWebMcpHost): WebMcpTool[] {
  return [
    {
      name: "get_editing_session",
      title: "Read editing access",
      description: "Read the current browser project's writing access, owner generation, idle timeout, and local draft status. Use before resume_edit.",
      inputSchema: commandJsonSchema(inputs.get_editing_session),
      annotations: { readOnlyHint: true },
      execute: async args => {
        const parsed = parseCommandInput(inputs.get_editing_session, args, true);
        if (!parsed.ok) return parsed;
        try { return okResult({ ...await host.inspect(), pendingLocalWork: host.pendingLocalWork(), idleTimeoutMs: PROJECT_WRITE_SESSION_IDLE_MS }); }
        catch (error) { return failResult("operation_failed", error instanceof Error ? error.message : "Editing access could not be read.", true); }
      },
    },
    {
      name: "resume_edit",
      title: "Resume edit",
      description: "When the human asks to resume or take over editing, acquire writing access in this tab using the exact owner generation from get_editing_session. The previous session keeps its draft and switches to viewing. This tab reloads the latest saved project. Wait for navigation and rediscover tools before editing. Local unsaved work requires the human's draft-preserving Resume edit action.",
      inputSchema: commandJsonSchema(inputs.resume_edit),
      annotations: { readOnlyHint: false },
      execute: async args => {
        const parsed = parseCommandInput(inputs.resume_edit, args, true);
        if (!parsed.ok) return parsed;
        try {
          const input = inputs.resume_edit.parse(parsed.value);
          const status = await host.resumeEdit(input.expectedOwnerGeneration);
          return okResult({ status, reloadScheduled: true, readyWhen: "The current project reloads and get_editing_session reports writable=true." });
        } catch (error) { return failResult("conflict", error instanceof Error ? error.message : "Check the current editing session and try again.", true); }
      },
    },
  ];
}
