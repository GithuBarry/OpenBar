/**
 * AGENTS.md and skill WebMCP tools for the instructions page.
 */

import { INSTRUCTIONS_INPUTS } from "./command-inputs";
import { commandJsonSchemas, parseCommandInput } from "./command-schema";
import { failResult, okResult, type OperationResult } from "./operation-result";
import { type PaperWebMcpTool } from "./webmcp-paper-contract";
import type { CurrentLocation, SharedWebMcpActions } from "./webmcp-shared-contract";

export type SkillWriteSpec = { id: string; name?: string; description?: string; body: string };

export type InstructionsWebMcpActions = {
  writeAgentsMd: (project: string, body: string, expectedHash?: string) => Promise<{ path: string; hash: string }>;
  writeProjectSkill: (project: string, spec: SkillWriteSpec, expectedHash?: string) => Promise<unknown>;
  deleteProjectSkill: (project: string, id: string, expectedHash: string) => Promise<unknown>;
  writeWorkspaceAgentsMd: (body: string, expectedHash?: string) => Promise<{ path: string; hash: string }>;
  writeWorkspaceSkill: (spec: SkillWriteSpec, expectedHash?: string) => Promise<unknown>;
  deleteWorkspaceSkill: (id: string, expectedHash: string) => Promise<unknown>;
};

export type InstructionsWebMcpHost = {
  project: string;
  actions: InstructionsWebMcpActions;
  sharedActions: SharedWebMcpActions;
  refresh?: () => void;
  navigate?: (href: string) => void;
  current?: () => CurrentLocation | undefined;
};

const NAMES = [
  "write_agents_md",
  "write_project_skill",
  "delete_project_skill",
  "write_workspace_agents_md",
  "write_workspace_skill",
  "delete_workspace_skill",
] as const;

type ToolName = (typeof NAMES)[number];

const SCHEMAS = commandJsonSchemas(INSTRUCTIONS_INPUTS);

const META: Record<ToolName, { title: string; description: string }> = {
  write_agents_md: {
    title: "Write AGENTS.md",
    description: "Write this project's AGENTS.md. Pass expectedHash from get_project_state.",
  },
  write_project_skill: {
    title: "Write a project skill",
    description: "Create or update .openbar/skills/<id>/SKILL.md for this project.",
  },
  delete_project_skill: {
    title: "Delete a project skill",
    description: "Delete a project-local SKILL.md.",
  },
  write_workspace_agents_md: {
    title: "Write shared instructions",
    description: "Write the workspace AGENTS.md shared across projects.",
  },
  write_workspace_skill: {
    title: "Write a workspace skill",
    description: "Create or update a skill under the workspace content/skills directory.",
  },
  delete_workspace_skill: {
    title: "Delete a workspace skill",
    description: "Delete a workspace-level SKILL.md.",
  },
};

export function buildInstructionsWebMcpTools(host: Pick<InstructionsWebMcpHost, "project" | "actions" | "refresh">): PaperWebMcpTool[] {
  return NAMES.map((name) => ({
    name,
    title: META[name].title,
    description: META[name].description,
    inputSchema: SCHEMAS[name],
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: (args) => executeInstructionsTool(host, name, args),
  }));
}

async function executeInstructionsTool(
  host: Pick<InstructionsWebMcpHost, "project" | "actions" | "refresh">,
  name: ToolName,
  rawArgs: unknown,
): Promise<OperationResult<unknown>> {
  const parsedArgs = parseCommandInput(INSTRUCTIONS_INPUTS[name], rawArgs, true);
  if (!parsedArgs.ok) return failResult("invalid_arguments", parsedArgs.message, { retryable: false });
  const args = parsedArgs.value;
  try {
    switch (name) {
      case "write_agents_md": {
        if (typeof args.body !== "string") return failResult("invalid_arguments", "body must be a string.", false);
        const result = await host.actions.writeAgentsMd(
          host.project,
          args.body,
          typeof args.expectedHash === "string" ? args.expectedHash : undefined,
        );
        host.refresh?.();
        return okResult(result, { diskHash: result.hash });
      }
      case "write_workspace_agents_md": {
        if (typeof args.body !== "string") return failResult("invalid_arguments", "body must be a string.", false);
        const result = await host.actions.writeWorkspaceAgentsMd(
          args.body,
          typeof args.expectedHash === "string" ? args.expectedHash : undefined,
        );
        host.refresh?.();
        return okResult(result, { diskHash: result.hash });
      }
      case "write_project_skill":
      case "write_workspace_skill": {
        if (typeof args.id !== "string" || !args.id.trim()) return failResult("invalid_arguments", "id is required.", false);
        if (typeof args.body !== "string") return failResult("invalid_arguments", "body must be a string.", false);
        const spec = {
          id: args.id.trim(),
          name: typeof args.name === "string" ? args.name : undefined,
          description: typeof args.description === "string" ? args.description : undefined,
          body: args.body,
        };
        const expectedHash = typeof args.expectedHash === "string" ? args.expectedHash : undefined;
        const result = name === "write_project_skill"
          ? await host.actions.writeProjectSkill(host.project, spec, expectedHash)
          : await host.actions.writeWorkspaceSkill(spec, expectedHash);
        host.refresh?.();
        return okResult(result);
      }
      case "delete_project_skill":
      case "delete_workspace_skill": {
        if (typeof args.id !== "string" || !args.id.trim()) return failResult("invalid_arguments", "id is required.", false);
        if (typeof args.expectedHash !== "string" || !args.expectedHash) {
          return failResult("invalid_arguments", "expectedHash is required.", false);
        }
        if (name === "delete_project_skill") await host.actions.deleteProjectSkill(host.project, args.id.trim(), args.expectedHash);
        else await host.actions.deleteWorkspaceSkill(args.id.trim(), args.expectedHash);
        host.refresh?.();
        return okResult({ id: args.id.trim() });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/hash|changed on disk|stale/i.test(message)) return failResult("stale_disk_state", message, { retryable: true });
    return failResult("operation_failed", message, { retryable: true });
  }
}
