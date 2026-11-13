import { z } from "zod";
import { commandJsonSchema, parseCommandInput } from "./command-schema";
import { failResult, okResult } from "./operation-result";
import { PROJECT_WRITE_SESSION_IDLE_MS, type ProjectWriteSessionStatus } from "./project-write-session-contract";
import type { WebMcpTool } from "./webmcp-register";

const inputs = {
  get_editing_session: z.strictObject({}),
  release_edit: z.strictObject({}),
  resume_edit: z.strictObject({
    expectedOwnerGeneration: z.uuid().nullable().describe("Exact ownerGeneration from get_editing_session. null expects an available project. A UUID explicitly transfers that observed session's editing access here."),
  }),
};

export type SessionWebMcpHost = {
  inspect: () => Promise<ProjectWriteSessionStatus>;
  resumeEdit: (expectedOwnerGeneration: string | null) => Promise<ProjectWriteSessionStatus>;
  pendingLocalWork: () => boolean;
  canRelease: () => boolean;
  release: () => Promise<void>;
};

const coordination = {
  contribute: "Use the current writing tab's WebMCP tools for Agent draft children or edits to other cards. get_mindmap.writeAccess names any actively edited card. Native MCP apply_mindmap_edits contributes with current revision and disk hash while browser ownership stays in place.",
  transferConsequence: "resume_edit transfers browser writing access here. The previous writing tab keeps its local draft and switches to viewing. Use this transfer when the human requests it.",
  releaseConsequence: "release_edit yields this tab's writing access after local work is saved. Its final inspect confirms this tab is viewing.",
};

export function buildSessionWebMcpTools(host: SessionWebMcpHost): WebMcpTool[] {
  return [
    {
      name: "get_editing_session",
      title: "Read editing access",
      description: "Read writing access, pending local work, release readiness and coordination guidance. Inspect before resume_edit or release_edit. Contributions can use the current writing tab or revision-checked native MCP. Resume edit transfers browser ownership.",
      inputSchema: commandJsonSchema(inputs.get_editing_session),
      annotations: { readOnlyHint: true },
      execute: async args => {
        const parsed = parseCommandInput(inputs.get_editing_session, args, true);
        if (!parsed.ok) return parsed;
        try {
          const status = await host.inspect();
          const pendingLocalWork = host.pendingLocalWork();
          return okResult({ ...status, pendingLocalWork, canRelease: status.writable && host.canRelease() && !pendingLocalWork, idleTimeoutMs: PROJECT_WRITE_SESSION_IDLE_MS, coordination });
        } catch (error) { return failResult("operation_failed", error instanceof Error ? error.message : "Editing access could not be read.", true); }
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
          if (host.pendingLocalWork()) return failResult("conflict", "Save the local draft before transferring editing access. The human can use the draft-preserving Resume edit action.", true);
          const status = await host.resumeEdit(input.expectedOwnerGeneration);
          return okResult({ status, reloadScheduled: true, readyWhen: "The current project reloads and get_editing_session reports writable=true." });
        } catch (error) { return failResult("conflict", error instanceof Error ? error.message : "Check the current editing session and try again.", true); }
      },
    },
    {
      name: "release_edit",
      title: "Release editing access",
      description: "Yield this browser tab's writing access after local work is saved. Pending drafts or operations keep access here. The tool inspects access after release and reports the confirmed viewing state. Other agents can contribute through native MCP while the human keeps browser ownership.",
      inputSchema: commandJsonSchema(inputs.release_edit),
      annotations: { readOnlyHint: false },
      execute: async args => {
        const parsed = parseCommandInput(inputs.release_edit, args, true);
        if (!parsed.ok) return parsed;
        try {
          if (host.pendingLocalWork()) return failResult("conflict", "Save the local draft before releasing editing access.", true);
          const before = await host.inspect();
          if (!before.writable) return okResult({ status: before, released: true });
          if (!host.canRelease() || host.pendingLocalWork()) return failResult("conflict", "Editing work is still pending. Wait for it to finish before releasing access.", true);
          await host.release();
          const status = await host.inspect();
          return status.writable
            ? failResult("conflict", "This tab still holds writing access. Inspect the session and try releasing again after local work finishes.", true)
            : okResult({ status, released: true });
        } catch (error) { return failResult("operation_failed", error instanceof Error ? error.message : "Editing access could not be released.", true); }
      },
    },
  ];
}
