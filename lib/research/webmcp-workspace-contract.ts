/**
 * Workspace WebMCP tools for the project picker at `/`.
 *
 * The home page supplies the workspace actions and navigation callback. The
 * contract stays browser-safe and returns ordinary OperationResult values.
 */

import { WORKSPACE_INPUTS } from "./command-inputs";
import { parseCommandInput } from "./command-schema";
import { failResult, okResult, type OperationResult } from "./operation-result";
import {
  WORKSPACE_WEBMCP_SCHEMAS,
  WORKSPACE_WEBMCP_TOOL_NAMES,
} from "./mcp-tool-schemas";
import { type PaperWebMcpTool } from "./webmcp-paper-contract";
import type { MoveWorkspaceProjectInput, WorkspaceLayout } from "@/lib/workspace";

export { WORKSPACE_WEBMCP_TOOL_NAMES };

export type WorkspaceProjectResult = {
  slug: string;
  title: string;
  href: string;
  tagline?: string;
  icon?: string;
};

export type WorkspaceWebMcpActions = {
  listProjects: () => Promise<WorkspaceProjectResult[]>;
  searchProjects: (query: string) => Promise<WorkspaceProjectResult[]>;
  openProject: (slug: string) => Promise<WorkspaceProjectResult | null>;
  getWorkspaceLayout: () => Promise<WorkspaceLayout>;
  moveProject: (input: MoveWorkspaceProjectInput) => Promise<OperationResult<WorkspaceLayout>>;
};

export type WorkspaceWebMcpHost = {
  actions: WorkspaceWebMcpActions;
  navigate: (href: string) => void;
};

type WorkspaceToolName = (typeof WORKSPACE_WEBMCP_TOOL_NAMES)[number];

const TOOL_META: Record<WorkspaceToolName, { title: string; description: string }> = {
  list_projects: {
    title: "List projects",
    description: "List the projects in this OpenBar workspace with paper links and optional identity details.",
  },
  get_workspace_layout: {
    title: "Read project layout",
    description: "Read active and archived projects in saved order, with the hash required by move_project.",
  },
  move_project: {
    title: "Move a project",
    description: "Reorder, archive or restore a project using the current layout hash. beforeSlug and afterSlug identify adjacent destination-group neighbors. Omit both to append.",
  },
  search_projects: {
    title: "Search projects",
    description: "Find workspace projects by slug, title, tagline, or label. Search is case-insensitive.",
  },
  open_project: {
    title: "Open a project",
    description: "Open a project on its paper page. Use a slug returned by list_projects or search_projects.",
  },
};

function requiredString(args: Record<string, unknown>, key: string): string | OperationResult<never> {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    return failResult("invalid_arguments", `${key} must be a non-empty string.`, { retryable: false });
  }
  return value.trim();
}

export function buildWorkspaceWebMcpTools(host: WorkspaceWebMcpHost): PaperWebMcpTool[] {
  return WORKSPACE_WEBMCP_TOOL_NAMES.map((name) => ({
    name,
    title: TOOL_META[name].title,
    description: TOOL_META[name].description,
    inputSchema: WORKSPACE_WEBMCP_SCHEMAS[name],
    annotations: { readOnlyHint: name !== "move_project", untrustedContentHint: true },
    execute: (args) => executeWorkspaceTool(host, name, args),
  }));
}

async function executeWorkspaceTool(
  host: WorkspaceWebMcpHost,
  name: WorkspaceToolName,
  rawArgs: unknown,
): Promise<OperationResult<unknown>> {
  const parsedArgs = parseCommandInput(WORKSPACE_INPUTS[name], rawArgs, true);
  if (!parsedArgs.ok) return failResult("invalid_arguments", parsedArgs.message, { retryable: false });
  const args = parsedArgs.value;

  try {
    switch (name) {
      case "list_projects":
        return okResult(await host.actions.listProjects());
      case "get_workspace_layout":
        return okResult(await host.actions.getWorkspaceLayout());
      case "move_project":
        return host.actions.moveProject(WORKSPACE_INPUTS.move_project.parse(args));
      case "search_projects": {
        const query = requiredString(args, "query");
        if (typeof query !== "string") return query;
        return okResult(await host.actions.searchProjects(query));
      }
      case "open_project": {
        const slug = requiredString(args, "slug");
        if (typeof slug !== "string") return slug;
        const project = await host.actions.openProject(slug);
        if (!project) return failResult("invalid_arguments", `Unknown project "${slug}".`, { retryable: false });
        host.navigate(`/p/${encodeURIComponent(slug)}/paper`);
        return okResult({ ...project, status: "scheduled", readyWhen: "Wait for the project URL and its page-local tool catalog. Browser bridge clients can call window.openbarAgent.waitForNavigation(href)." });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error && typeof error === "object" && "code" in error && error.code === "stale_disk_state") {
      return failResult("stale_disk_state", message, { retryable: true, ...("currentHash" in error ? { currentHash: String(error.currentHash) } : {}) });
    }
    if (/forbidden|unauthorized|permission|access denied/i.test(message)) {
      return failResult("permission_denied", message, { retryable: false });
    }
    if (/unknown|invalid|not found|slug/i.test(message)) {
      return failResult("invalid_arguments", message, { retryable: false });
    }
    return failResult("operation_failed", message, { retryable: true });
  }
}
