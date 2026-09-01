/**
 * Shared page-scoped WebMCP tools from PLAN.md section 8.
 */

import { artifactHref } from "./artifact-link";
import { SHARED_WEBMCP_SCHEMAS, SHARED_WEBMCP_TOOL_NAMES } from "./mcp-tool-schemas";
import { failResult, okResult, type OperationResult } from "./operation-result";
import { parseWebMcpArgs, unknownWebMcpArgument, type PaperWebMcpTool } from "./webmcp-paper-contract";

export { SHARED_WEBMCP_TOOL_NAMES };

export type SharedWebMcpActions = {
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
  "get_project_context",
  "get_capabilities",
  "inspect_repository",
  "plan_repository_migration",
  "preview_conversion",
  "get_agenda",
  "navigate_artifact",
]);

export function buildSharedWebMcpTools(host: SharedWebMcpHost): PaperWebMcpTool[] {
  return SHARED_WEBMCP_TOOL_NAMES.map((name) => ({
    name,
    title: name.replaceAll("_", " "),
    description: `Shared operation ${name}. Project is fixed by the open page.`,
    inputSchema: SHARED_WEBMCP_SCHEMAS[name]!,
    annotations: {
      readOnlyHint: READ_ONLY.has(name),
      untrustedContentHint: true,
    },
    execute: (args) => executeSharedWebMcpTool(host, name, args),
  }));
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
