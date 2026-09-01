/**
 * Shared page-scoped WebMCP tools available on every project page.
 */

import { artifactHref } from "./artifact-link";
import { SHARED_WEBMCP_SCHEMAS, SHARED_WEBMCP_TOOL_NAMES } from "./mcp-tool-schemas";
import { failResult, okResult, type OperationResult } from "./operation-result";
import { parseWebMcpArgs, unknownWebMcpArgument, type PaperWebMcpTool } from "./webmcp-paper-contract";

export type CurrentLocation = {
  kind: "paper" | "mindmap" | "wiki" | "home";
  href: string;
  sectionId?: string;
  nodeId?: string;
  mapId?: string;
  pageId?: string;
};

export { SHARED_WEBMCP_TOOL_NAMES };

export type SharedWebMcpActions = {
  getProjectState: (project: string, current?: CurrentLocation) => Promise<unknown>;
  searchProject: (project: string, query: string) => Promise<unknown>;
  resolveNavigation: (project: string, input: { id?: string; href?: string }) => Promise<{ href: string } | null>;
  readProjectSkill: (project: string, id: string) => Promise<unknown>;
  getProjectContext: (project: string) => Promise<unknown>;
  getCapabilities: () => Promise<unknown>;
  inspectRepository: (project: string) => Promise<unknown>;
  planRepositoryMigration: (project: string) => Promise<unknown>;
  applyRepositoryMigration: (project: string, planId: string, expectedHash: string, confirm: boolean) => Promise<OperationResult<unknown>>;
  previewConversion: (project: string, filePath: string, source: string, to: string, expandProject: boolean) => Promise<unknown>;
  applyConversion: (project: string, planId: string, expectedHash: string, acknowledgeLoss: boolean, dryRun: boolean) => Promise<OperationResult<unknown>>;
  getAgenda: (project: string) => Promise<unknown>;
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
  "get_project_context",
  "get_capabilities",
  "inspect_repository",
  "plan_repository_migration",
  "preview_conversion",
  "get_agenda",
  "navigate_artifact",
]);

const TOOL_META: Record<string, { title: string; description: string }> = {
  get_project_state: {
    title: "Read project state",
    description:
      "Read this first when entering an OpenBar project or after losing context. Returns the manuscript outline, open paper TODOs, available mindmaps, recent project activity, current location, and project-local skills. This operation does not modify project files.",
  },
  search_project: {
    title: "Search the project",
    description:
      "Search paper headings, TeX source, TODO and comment text, mindmap nodes, and wiki notes. Returns ids and hrefs that navigate_project can open. Does not modify project files.",
  },
  navigate_project: {
    title: "Navigate the project UI",
    description:
      "Navigate the current OpenBar UI to a paper section, TODO, mindmap, or other project location returned by get_project_state or search_project. Use this directly rather than asking the user to navigate.",
  },
  read_project_skill: {
    title: "Read a project skill",
    description:
      "Read one project-local SKILL.md or bundled OpenBar skill by id from get_project_state. Use this after orientation when the project names a research habit. Does not modify files.",
  },
  get_project_context: {
    title: "Read legacy project context",
    description:
      "Compatibility markdown dump of the project. Prefer get_project_state for orientation. Does not modify files.",
  },
  get_capabilities: {
    title: "Read runtime capabilities",
    description: "Return server compile and conversion capabilities. Does not modify files.",
  },
  inspect_repository: {
    title: "Inspect the TeX repository",
    description: "Inspect the manuscript include graph. Useful during import or repository setup, not during ordinary paper writing.",
  },
  plan_repository_migration: {
    title: "Plan a repository migration",
    description: "Preview a repository layout migration. Setup-only; not part of ordinary paper writing.",
  },
  apply_repository_migration: {
    title: "Apply a repository migration",
    description: "Apply a previously planned repository migration. Setup-only; requires confirm and expectedHash.",
  },
  preview_conversion: {
    title: "Preview a conversion",
    description: "Preview a Pandoc conversion of manuscript source. Setup-only.",
  },
  apply_conversion: {
    title: "Apply a conversion",
    description: "Apply a previously previewed conversion. Setup-only.",
  },
  get_agenda: {
    title: "Read the project agenda",
    description: "Return open manuscript TODOs and deadlines. Prefer get_project_state when you also need outline and skills.",
  },
  navigate_artifact: {
    title: "Navigate to an artifact",
    description: "Navigate to a typed artifact id. Prefer navigate_project with an href from get_project_state or search_project.",
  },
};

export function buildSharedWebMcpTools(host: SharedWebMcpHost): PaperWebMcpTool[] {
  return SHARED_WEBMCP_TOOL_NAMES.map((name) => ({
    name,
    title: TOOL_META[name]?.title || name.replaceAll("_", " "),
    description: TOOL_META[name]?.description || `Shared operation ${name}. Project is fixed by the open page.`,
    inputSchema: SHARED_WEBMCP_SCHEMAS[name]!,
    annotations: {
      readOnlyHint: READ_ONLY.has(name),
      untrustedContentHint: true,
    },
    execute: (args) => executeSharedWebMcpTool(host, name, args),
  }));
}

function hostCurrent(host: SharedWebMcpHost): CurrentLocation | undefined {
  return typeof host.current === "function" ? host.current() : host.current;
}

async function executeSharedWebMcpTool(
  host: SharedWebMcpHost,
  name: (typeof SHARED_WEBMCP_TOOL_NAMES)[number],
  rawArgs: unknown,
): Promise<OperationResult<unknown>> {
  const parsedArgs = parseWebMcpArgs(rawArgs);
  if (!parsedArgs.ok) return failResult("invalid_arguments", parsedArgs.message, { retryable: false });
  const args = parsedArgs.value;
  const unknown = unknownWebMcpArgument(args, SHARED_WEBMCP_SCHEMAS[name]!);
  if (unknown) return failResult("invalid_arguments", `Unknown argument "${unknown}".`, { retryable: false });
  try {
    switch (name) {
      case "get_project_state":
        return okResult(await host.actions.getProjectState(host.project, hostCurrent(host)));
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
      case "get_project_context":
        return okResult({ markdown: await host.actions.getProjectContext(host.project) });
      case "get_capabilities":
        return okResult(await host.actions.getCapabilities());
      case "inspect_repository":
        return okResult(await host.actions.inspectRepository(host.project));
      case "plan_repository_migration":
        return okResult(await host.actions.planRepositoryMigration(host.project));
      case "get_agenda":
        return okResult(await host.actions.getAgenda(host.project));
      case "navigate_artifact": {
        const kind = requiredString(args, "kind");
        if (typeof kind !== "string") return kind;
        const id = requiredString(args, "id");
        if (typeof id !== "string") return id;
        const href = artifactHref(host.project, { kind: kind as never, id });
        host.navigate?.(href);
        return okResult({ href });
      }
      case "apply_repository_migration": {
        const planId = requiredString(args, "planId");
        if (typeof planId !== "string") return planId;
        const expectedHash = requiredString(args, "expectedHash");
        if (typeof expectedHash !== "string") return expectedHash;
        if (typeof args.confirm !== "boolean") return failResult("invalid_arguments", "confirm must be a boolean.", { retryable: false });
        const result = await host.actions.applyRepositoryMigration(
          host.project,
          planId,
          expectedHash,
          args.confirm,
        );
        return result.ok ? okResult(result.value, { diskHash: result.diskHash }) : result;
      }
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
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/hash|conflict|stale/i.test(message)) return failResult("stale_disk_state", message, { retryable: true });
    if (/forbidden|unauthorized|permission|access denied/i.test(message)) return failResult("permission_denied", message, { retryable: false });
    if (/unknown|invalid|not found|path/i.test(message)) return failResult("invalid_arguments", message, { retryable: false });
    return failResult("operation_failed", message, { retryable: true });
  }
}
