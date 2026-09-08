/**
 * AGENTS.md and skill WebMCP tools for the instructions page.
 */

import { failResult, okResult, type OperationResult } from "./operation-result";
import { parseWebMcpArgs, unknownWebMcpArgument, type JsonSchemaObject, type PaperWebMcpTool } from "./webmcp-paper-contract";
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

function objectSchema(properties: Record<string, unknown> = {}, required: string[] = []): JsonSchemaObject {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

const SCHEMAS: Record<ToolName, JsonSchemaObject> = {
  write_agents_md: objectSchema({ body: { type: "string" }, expectedHash: { type: "string" } }, ["body"]),
  write_project_skill: objectSchema(
    {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      body: { type: "string" },
      expectedHash: { type: "string" },
    },
    ["id", "body"],
  ),
  delete_project_skill: objectSchema({ id: { type: "string" }, expectedHash: { type: "string" } }, ["id", "expectedHash"]),
  write_workspace_agents_md: objectSchema({ body: { type: "string" }, expectedHash: { type: "string" } }, ["body"]),
  write_workspace_skill: objectSchema(
    {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      body: { type: "string" },
      expectedHash: { type: "string" },
    },
    ["id", "body"],
  ),
  delete_workspace_skill: objectSchema({ id: { type: "string" }, expectedHash: { type: "string" } }, ["id", "expectedHash"]),
};

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
  const parsedArgs = parseWebMcpArgs(rawArgs);
  if (!parsedArgs.ok) return failResult("invalid_arguments", parsedArgs.message, { retryable: false });
  const args = parsedArgs.value;
  const unknown = unknownWebMcpArgument(args, SCHEMAS[name]);
  if (unknown) return failResult("invalid_arguments", `Unknown argument "${unknown}".`, false);
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
