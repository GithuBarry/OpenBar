/**
 * Shared page-scoped WebMCP tools available on every project page.
 */

import { safeUrl } from "@/lib/safe-url";
import type { ProjectLink } from "@/lib/types";
import { SHARED_INPUTS } from "./command-inputs";
import { parseCommandInput } from "./command-schema";
import {
PROJECT_WEBMCP_TOOL_NAMES,
SHARED_WEBMCP_SCHEMAS,
} from "./mcp-tool-schemas";
import { failResult,okResult,type OperationResult } from "./operation-result";
import { type PaperWebMcpTool } from "./webmcp-paper-contract";

export type CurrentLocation = {
  kind: "paper" | "mindmap" | "wiki" | "home" | "instructions";
  href: string;
  sectionId?: string;
  nodeId?: string;
  mapId?: string;
  pageId?: string;
};

export { PROJECT_WEBMCP_TOOL_NAMES };

export type ProjectStateQuery = {
  detail?: "summary" | "full";
  todoLimit?: number;
};

export type WorkspaceInstructionsPatch = { body: string; expectedHash: string };

export type ProjectMetadataPatch = {
  expectedHash: string;
  title?: string;
  venue?: string;
  tagline?: string;
  overview?: string;
  researchKind?: string;
  color?: string;
  icon?: string;
  label?: string;
  engine?: "pdflatex" | "xelatex" | "lualatex";
  mainFile?: string;
  texliveVersion?: string;
  links?: ProjectLink[];
  collaborators?: string[];
  archivedAt?: string | null;
};

export type SharedWebMcpActions = {
  syncProject?: (project: string, args: unknown) => Promise<OperationResult<unknown>>;
  getProjectState: (project: string, current?: CurrentLocation, query?: ProjectStateQuery) => Promise<unknown>;
  resolveNavigation: (project: string, input: { id?: string; href?: string }) => Promise<{ href: string } | null>;
  readProjectSkill: (project: string, id: string, source?: "project" | "workspace" | "openbar") => Promise<unknown>;
  updateProject: (project: string, patch: ProjectMetadataPatch) => Promise<unknown>;
  updateWorkspaceInstructions: (project: string, patch: WorkspaceInstructionsPatch) => Promise<OperationResult<unknown>>;
};

export type SharedWebMcpHost = {
  project: string;
  current?: CurrentLocation | (() => CurrentLocation | undefined);
  liveSource?: () => string;
  navigate?: (href: string) => void;
  actions: SharedWebMcpActions;
};

function requiredString(args: Record<string, unknown>, key: string): string | OperationResult<never> {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    return failResult("invalid_arguments", `${key} must be a non-empty string.`, { retryable: false });
  }
  return value;
}

const READ_ONLY = new Set<string>(["get_project_state", "navigate_project", "read_project_skill"]);

type SharedToolName = keyof typeof SHARED_INPUTS;

export type SharedWebMcpProfile = "full" | "public-demo";

const PUBLIC_DEMO_PROJECT_TOOLS = ["get_project_state","navigate_project","read_project_skill"] as const;

const TOOL_META: Record<SharedToolName, { title: string; description: string }> = {
  sync_project: { title: "Review and resolve Git synchronization", description: "Inspect Git status, exact commit IDs and recovery refs. review_pull prepares an isolated merge and returns base/local/Git contents for conflicting files. Resolve whole files, then apply_pull with its token and resolutions. Save live editor drafts before reviewing. Local edits arriving during review require a fresh review. cancel_pull closes the review." },
  get_project_state: {
    title: "Read project state",
    description:
      "Start here on every project visit, then call check_inbox at the start of each new agent session, including without earlier chat context. Read saved project state, @agent and fast tracked @stat requests, TODO coverage, Git sync, and instruction/skill metadata. workspaceAgentsMd includes shared User / workspace instructions and the hash for update_workspace_instructions in the private workspace. detail=full also includes project AGENTS.md bodies and all TODOs. Use get_paper_state or read_project_files for the browser's live draft.",
  },
  update_workspace_instructions: {
    title: "Update User / workspace instructions",
    description: "Update the existing User / workspace instructions shared across every project. Read workspaceAgentsMd.body and hash from get_project_state, preserve useful existing preferences, and pass the complete body with expectedHash. Save only comments or preferences the user has asked to share across projects. The Instructions page exposes the same workspace AGENTS.md. A concurrent save returns a hash conflict for review.",
  },
  navigate_project: {
    title: "Navigate the project UI",
    description:
      "Navigate the current OpenBar UI to a paper section, TODO, mindmap, or other project location returned by get_project_state. Use this directly rather than asking the user to navigate.",
  },
  read_project_skill: {
    title: "Read a project skill",
    description:
      "Load one project, workspace, or bundled skill by its catalog ID when its description fits the task.",
  },
  update_project: {
    title: "Update project metadata",
    description: "Update any editable project metadata: title, venue, tagline, overview, research kind, color, icon, label, links, collaborators, or archive state. TeX project metadata remains the shared source.",
  }
};

export function sharedToolDescription(name: SharedToolName): string {
  return TOOL_META[name].description;
}

export function buildSharedWebMcpTools(host: SharedWebMcpHost, profile: SharedWebMcpProfile = "full"): PaperWebMcpTool[] {
  const names = profile === "public-demo" ? PUBLIC_DEMO_PROJECT_TOOLS : PROJECT_WEBMCP_TOOL_NAMES;
  return names.map((name) => sharedTool(host, name));
}



function sharedTool(host: SharedWebMcpHost, name: SharedToolName): PaperWebMcpTool {
  return {
    name,
    title: TOOL_META[name]?.title || name.replaceAll("_", " "),
    description: sharedToolDescription(name),
    inputSchema: SHARED_WEBMCP_SCHEMAS[name]!,
    annotations: {
      readOnlyHint: READ_ONLY.has(name),
      untrustedContentHint: true,
    },
    execute: (args) => executeSharedWebMcpTool(host, name, args),
  };
}

function hostCurrent(host: SharedWebMcpHost): CurrentLocation | undefined {
  return typeof host.current === "function" ? host.current() : host.current;
}

async function executeSharedWebMcpTool(
  host: SharedWebMcpHost,
  name: SharedToolName,
  rawArgs: unknown,
): Promise<OperationResult<unknown>> {
  const parsedArgs = parseCommandInput(SHARED_INPUTS[name], rawArgs, true);
  if (!parsedArgs.ok) return failResult("invalid_arguments", parsedArgs.message, { retryable: false });
  const args = parsedArgs.value;
  try {
    switch (name) {
      case "update_workspace_instructions": return await host.actions.updateWorkspaceInstructions(host.project, args as WorkspaceInstructionsPatch);
      case "sync_project": return host.actions.syncProject ? host.actions.syncProject(host.project, args) : failResult("capability_unavailable", "Synchronization review is unavailable in this client.", false);
      case "get_project_state": {
        if (args.detail !== undefined && args.detail !== "summary" && args.detail !== "full") {
          return failResult("invalid_arguments", 'detail must be "summary" or "full".', { retryable: false });
        }
        if (args.todoLimit !== undefined && (!Number.isInteger(args.todoLimit) || (args.todoLimit as number) < 0 || (args.todoLimit as number) > 200)) {
          return failResult("invalid_arguments", "todoLimit must be an integer from 0 to 200.", { retryable: false });
        }
        return okResult(await host.actions.getProjectState(host.project, hostCurrent(host), {
          detail: args.detail === "full" ? "full" : "summary",
          todoLimit: typeof args.todoLimit === "number" ? args.todoLimit : undefined,
        }));
      }
      case "navigate_project": {
        if (args.id !== undefined && (typeof args.id !== "string" || !args.id.trim())) {
          return failResult("invalid_arguments", "id must be a non-empty string.", { retryable: false });
        }
        if (args.href !== undefined && (typeof args.href !== "string" || !args.href.trim())) {
          return failResult("invalid_arguments", "href must be a non-empty string.", { retryable: false });
        }
        const id = typeof args.id === "string" ? args.id.trim() : undefined;
        const hrefArg = typeof args.href === "string" ? args.href.trim() : undefined;
        if (!id && !hrefArg) {
          return failResult("invalid_arguments", "Provide id or href from get_project_state or search_project.", { retryable: false });
        }
        const target = await host.actions.resolveNavigation(host.project, { id, href: hrefArg });
        if (!target?.href) return failResult("invalid_arguments", "Could not resolve that project location.", { retryable: false });
        if (!host.navigate) {
          return failResult(
            "capability_unavailable",
            "Navigation is unavailable on this page. Open any project page and retry navigate_project.",
            { retryable: true },
          );
        }
        host.navigate(target.href);
        return okResult({ ...target, status: "scheduled", readyWhen: "Wait for the destination URL and its page-local tool catalog. Browser bridge clients can call window.openbarAgent.waitForNavigation(href)." });
      }
      case "read_project_skill": {
        const id = requiredString(args, "id");
        if (typeof id !== "string") return id;
        return okResult(await host.actions.readProjectSkill(host.project, id, args.source as Parameters<SharedWebMcpActions["readProjectSkill"]>[2]));
      }
      case "update_project": {
        const expectedHash = requiredString(args, "expectedHash");
        if (typeof expectedHash !== "string") return expectedHash;
        const patch: ProjectMetadataPatch = { expectedHash };
        let hasMetadataPatch = false;
        for (const key of ["title", "venue", "tagline", "overview", "researchKind", "color", "icon", "label"] as const) {
          if (args[key] === undefined) continue;
          if (typeof args[key] !== "string") {
            return failResult("invalid_arguments", `${key} must be a string.`, { retryable: false });
          }
          patch[key] = args[key];
          hasMetadataPatch = true;
        }
        if (args.engine !== undefined) {
          if (args.engine !== "pdflatex" && args.engine !== "xelatex" && args.engine !== "lualatex") {
            return failResult("invalid_arguments", "engine must be pdflatex, xelatex, or lualatex.", { retryable: false });
          }
          patch.engine = args.engine;
          hasMetadataPatch = true;
        }
        for (const key of ["mainFile", "texliveVersion"] as const) {
          if (args[key] === undefined) continue;
          if (typeof args[key] !== "string") return failResult("invalid_arguments", `${key} must be a string.`, { retryable: false });
          patch[key] = args[key];
          hasMetadataPatch = true;
        }
        if (args.collaborators !== undefined) {
          if (!Array.isArray(args.collaborators) || args.collaborators.length > 100) {
            return failResult("invalid_arguments", "collaborators must be an array with at most 100 names.", { retryable: false });
          }
          const collaborators: string[] = [];
          for (const collaborator of args.collaborators) {
            if (typeof collaborator !== "string" || collaborator.trim().length > 160) {
              return failResult("invalid_arguments", "Each collaborator must be a string of at most 160 characters.", { retryable: false });
            }
            if (collaborator.trim()) collaborators.push(collaborator.trim());
          }
          patch.collaborators = collaborators;
          hasMetadataPatch = true;
        }
        if (args.links !== undefined) {
          if (!Array.isArray(args.links) || args.links.length > 50) {
            return failResult("invalid_arguments", "links must be an array with at most 50 entries.", { retryable: false });
          }
          const links: ProjectLink[] = [];
          for (const item of args.links) {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
              return failResult("invalid_arguments", "Each link must contain label, url, and kind.", { retryable: false });
            }
            const link = item as Record<string, unknown>;
            const extra = Object.keys(link).find((key) => !["label", "url", "kind"].includes(key));
            if (extra) return failResult("invalid_arguments", `Unknown link property "${extra}".`, { retryable: false });
            if (typeof link.label !== "string" || link.label.trim().length > 240) {
              return failResult("invalid_arguments", "Each link label must be a string of at most 240 characters.", { retryable: false });
            }
            if (typeof link.url !== "string" || link.url.trim().length > 2_000 || !safeUrl(link.url)) {
              return failResult("invalid_arguments", "Each link url must be a safe http(s) URL of at most 2,000 characters.", { retryable: false });
            }
            if (link.kind !== "overleaf" && link.kind !== "latex" && link.kind !== "arxiv" && link.kind !== "web" && link.kind !== "repo") {
              return failResult("invalid_arguments", "Each link kind must be overleaf, latex, arxiv, web, or repo.", { retryable: false });
            }
            links.push({ label: link.label.trim(), url: safeUrl(link.url)!, kind: link.kind });
          }
          patch.links = links;
          hasMetadataPatch = true;
        }
        if (args.archivedAt !== undefined) {
          if (args.archivedAt !== null && (typeof args.archivedAt !== "string" || !Number.isFinite(Date.parse(args.archivedAt)))) {
            return failResult("invalid_arguments", "archivedAt must be an ISO date-time or null to unarchive.", { retryable: false });
          }
          patch.archivedAt = args.archivedAt === null ? null : String(args.archivedAt);
          hasMetadataPatch = true;
        }
        if (!hasMetadataPatch) {
          return failResult("invalid_arguments", "Provide at least one project metadata field.", { retryable: false });
        }
        return okResult(await host.actions.updateProject(host.project, patch));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/hash|conflict|stale|changed on disk/i.test(message)) return failResult("stale_disk_state", message, { retryable: true });
    if (/forbidden|unauthorized|permission|access denied/i.test(message)) return failResult("permission_denied", message, { retryable: false });
    if (/unknown|invalid|not found|path/i.test(message)) return failResult("invalid_arguments", message, { retryable: false });
    return failResult("operation_failed", message, { retryable: true });
  }
}
