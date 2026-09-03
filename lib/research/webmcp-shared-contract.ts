/**
 * Shared page-scoped WebMCP tools available on every project page.
 */

import {
  INSTRUCTIONS_WEBMCP_TOOL_NAMES,
  PROJECT_WEBMCP_TOOL_NAMES,
  SHARED_WEBMCP_SCHEMAS,
  SETUP_WEBMCP_TOOL_NAMES,
} from "./mcp-tool-schemas";
import { failResult, okResult, type OperationResult } from "./operation-result";
import { parseWebMcpArgs, unknownWebMcpArgument, type PaperWebMcpTool } from "./webmcp-paper-contract";
import { safeUrl } from "@/lib/safe-url";
import type { ProjectLink } from "@/lib/types";

export type CurrentLocation = {
  kind: "paper" | "mindmap" | "wiki" | "home" | "instructions";
  href: string;
  sectionId?: string;
  nodeId?: string;
  mapId?: string;
  pageId?: string;
};

export { INSTRUCTIONS_WEBMCP_TOOL_NAMES, PROJECT_WEBMCP_TOOL_NAMES, SETUP_WEBMCP_TOOL_NAMES };

export type ProjectStateQuery = {
  detail?: "summary" | "full";
  todoLimit?: number;
};

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
  links?: ProjectLink[];
  collaborators?: string[];
  archivedAt?: string | null;
};

export type SharedWebMcpActions = {
  getProjectState: (project: string, current?: CurrentLocation, query?: ProjectStateQuery) => Promise<unknown>;
  searchProject: (project: string, query: string) => Promise<unknown>;
  resolveNavigation: (project: string, input: { id?: string; href?: string }) => Promise<{ href: string } | null>;
  readProjectSkill: (project: string, id: string) => Promise<unknown>;
  getCapabilities: () => Promise<unknown>;
  inspectRepository: (project: string) => Promise<unknown>;
  previewConversion: (project: string, filePath: string, source: string, to: string, expandProject: boolean) => Promise<unknown>;
  applyConversion: (project: string, planId: string, expectedHash: string, acknowledgeLoss: boolean, dryRun: boolean) => Promise<OperationResult<unknown>>;
  updateProject: (project: string, patch: ProjectMetadataPatch) => Promise<unknown>;
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

function optionalBoolean(args: Record<string, unknown>, key: string): OperationResult<true> | null {
  if (args[key] !== undefined && typeof args[key] !== "boolean") {
    return failResult("invalid_arguments", `${key} must be a boolean.`, { retryable: false });
  }
  return null;
}

const READ_ONLY = new Set<string>([
  "get_project_state",
  "search_project",
  "navigate_project",
  "read_project_skill",
  "get_capabilities",
  "inspect_repository",
  "preview_conversion",
]);

type SharedToolName =
  | (typeof PROJECT_WEBMCP_TOOL_NAMES)[number]
  | (typeof INSTRUCTIONS_WEBMCP_TOOL_NAMES)[number]
  | (typeof SETUP_WEBMCP_TOOL_NAMES)[number];

export type SharedWebMcpProfile = "full" | "public-demo";

const PUBLIC_DEMO_PROJECT_TOOLS = [
  "get_project_state",
  "search_project",
  "navigate_project",
  "read_project_skill",
] as const satisfies readonly SharedToolName[];

const TOOL_META: Record<SharedToolName, { title: string; description: string }> = {
  get_project_state: {
    title: "Read project state",
    description:
      "Read this first when entering an OpenBar project or after losing context. Default detail=summary returns location, paper title, section TODO counts, Primary Unplaced count, recent activity, mindmaps (id, title, primary, nodeCount, href), skills, and AGENTS.md path/hash. TODOs are {id, title, text, completed, primaryUnplaced, primaryMapNodeId}. Pass detail=full for AGENTS bodies and every TODO. Then search_project or navigate_project for detail. Does not modify files.",
  },
  search_project: {
    title: "Search the project",
    description:
      "Search paper headings, TeX source, TODO titles and details, comment text, mindmap titles, labels, refs, shared TODO text, and wiki pages. Returns ids and hrefs that navigate_project can open. Does not modify project files.",
  },
  navigate_project: {
    title: "Navigate the project UI",
    description:
      "Navigate the current OpenBar UI to a paper section, TODO, mindmap, or other project location returned by get_project_state or search_project. Use this directly rather than asking the user to navigate.",
  },
  read_project_skill: {
    title: "Read a project skill",
    description:
      "Read one project-local SKILL.md, workspace skill, or bundled OpenBar skill by id from get_project_state. Use this after orientation when the project names a research habit. Does not modify files.",
  },
  get_capabilities: {
    title: "Read runtime capabilities",
    description: "Return server compile and conversion capabilities. Does not modify files.",
  },
  inspect_repository: {
    title: "Inspect the TeX repository",
    description: "Inspect the manuscript include graph. Useful during import or repository setup, not during ordinary paper writing.",
  },
  preview_conversion: {
    title: "Preview a conversion",
    description: "Preview a Pandoc conversion of manuscript source. Setup-only.",
  },
  apply_conversion: {
    title: "Apply a conversion",
    description: "Apply a previously previewed conversion. Setup-only.",
  },
  update_project: {
    title: "Update project metadata",
    description: "Update any editable project metadata: title, venue, tagline, overview, research kind, color, icon, label, links, collaborators, or archive state. TeX project metadata remains the shared source.",
  },
};

export function buildSharedWebMcpTools(host: SharedWebMcpHost, profile: SharedWebMcpProfile = "full"): PaperWebMcpTool[] {
  const names = profile === "public-demo" ? PUBLIC_DEMO_PROJECT_TOOLS : PROJECT_WEBMCP_TOOL_NAMES;
  return names.map((name) => sharedTool(host, name));
}

export const buildProjectWebMcpTools = buildSharedWebMcpTools;

export function buildInstructionsWebMcpTools(host: SharedWebMcpHost): PaperWebMcpTool[] {
  return INSTRUCTIONS_WEBMCP_TOOL_NAMES.map((name) => sharedTool(host, name));
}

export function buildSetupWebMcpTools(host: SharedWebMcpHost): PaperWebMcpTool[] {
  return SETUP_WEBMCP_TOOL_NAMES.map((name) => sharedTool(host, name));
}

function sharedTool(host: SharedWebMcpHost, name: SharedToolName): PaperWebMcpTool {
  return {
    name,
    title: TOOL_META[name]?.title || name.replaceAll("_", " "),
    description: TOOL_META[name]?.description || `Shared operation ${name}. Project is fixed by the open page.`,
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
  const parsedArgs = parseWebMcpArgs(rawArgs);
  if (!parsedArgs.ok) return failResult("invalid_arguments", parsedArgs.message, { retryable: false });
  const args = parsedArgs.value;
  const unknown = unknownWebMcpArgument(args, SHARED_WEBMCP_SCHEMAS[name]!);
  if (unknown) return failResult("invalid_arguments", `Unknown argument "${unknown}".`, { retryable: false });
  try {
    switch (name) {
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
      case "search_project": {
        const query = requiredString(args, "query");
        if (typeof query !== "string") return query;
        return okResult(await host.actions.searchProject(host.project, query));
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
        return okResult(target);
      }
      case "read_project_skill": {
        const id = requiredString(args, "id");
        if (typeof id !== "string") return id;
        return okResult(await host.actions.readProjectSkill(host.project, id));
      }
      case "get_capabilities":
        return okResult(await host.actions.getCapabilities());
      case "inspect_repository":
        return okResult(await host.actions.inspectRepository(host.project));
      case "preview_conversion": {
        if (args.filePath !== undefined && (typeof args.filePath !== "string" || !args.filePath.trim())) {
          return failResult("invalid_arguments", "filePath must be a non-empty string.", { retryable: false });
        }
        if (args.to !== undefined && (typeof args.to !== "string" || !args.to.trim())) {
          return failResult("invalid_arguments", "to must be a non-empty string.", { retryable: false });
        }
        const expandCheck = optionalBoolean(args, "expandProject");
        if (expandCheck) return expandCheck;
        const expandProject = args.expandProject === true;
        const plan = await host.actions.previewConversion(
          host.project,
          typeof args.filePath === "string" ? args.filePath : "paper.tex",
          expandProject ? "" : (host.liveSource?.() || ""),
          typeof args.to === "string" ? args.to : "html5",
          expandProject,
        );
        return okResult(plan);
      }
      case "apply_conversion": {
        const planId = requiredString(args, "planId");
        if (typeof planId !== "string") return planId;
        const expectedHash = requiredString(args, "expectedHash");
        if (typeof expectedHash !== "string") return expectedHash;
        const acknowledgeCheck = optionalBoolean(args, "acknowledgeLoss");
        if (acknowledgeCheck) return acknowledgeCheck;
        const dryRunCheck = optionalBoolean(args, "dryRun");
        if (dryRunCheck) return dryRunCheck;
        const result = await host.actions.applyConversion(
          host.project,
          planId,
          expectedHash,
          args.acknowledgeLoss === true,
          args.dryRun === true,
        );
        return result.ok ? okResult(result.value) : result;
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
    if (/hash|conflict|stale/i.test(message)) return failResult("stale_disk_state", message, { retryable: true });
    if (/forbidden|unauthorized|permission|access denied/i.test(message)) return failResult("permission_denied", message, { retryable: false });
    if (/unknown|invalid|not found|path/i.test(message)) return failResult("invalid_arguments", message, { retryable: false });
    return failResult("operation_failed", message, { retryable: true });
  }
}
