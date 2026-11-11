import { commandJsonSchema } from "./command-schema";
import { failResult, type OperationResult } from "./operation-result";
import { READ_PROJECT_FILES_INPUT, APPLY_PROJECT_EDITS_INPUT, type ProjectFilesReadInput, type ProjectFilesEditInput, type ProjectFilesRead, type ProjectFilesEditReceipt } from "./project-files-contract";
import type { PaperWebMcpTool } from "./webmcp-paper-contract";

export function buildProjectFilesWebMcpTools(host: {
  read: (input: ProjectFilesReadInput) => Promise<OperationResult<ProjectFilesRead>>;
  edit: (input: ProjectFilesEditInput) => Promise<OperationResult<ProjectFilesEditReceipt>>;
}): PaperWebMcpTool[] {
  return [
    { name: "read_project_files", title: "Read project files", description: "List project directories or read file bytes and SHA256 hashes. Paths stay inside the project. OpenBar state and Git metadata are protected. The open editor saves its draft before reading.", schema: READ_PROJECT_FILES_INPUT, readOnly: true, run: host.read },
    { name: "apply_project_edits", title: "Edit project files", description: "Create, replace, or delete project files in a hash-checked batch. Arbitrary file types are supported. OpenBar state and Git metadata are protected. The open editor saves first and reconciles the result.", schema: APPLY_PROJECT_EDITS_INPUT, readOnly: false, run: host.edit },
  ].map(tool => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: commandJsonSchema(tool.schema),
    annotations: { readOnlyHint: tool.readOnly, untrustedContentHint: true },
    async execute(raw: unknown) {
      const parsed = tool.schema.safeParse(raw ?? {});
      if (!parsed.success) return failResult("invalid_arguments", parsed.error.issues.map(issue => issue.message).join(" "));
      try { return await (tool.run as (input: unknown) => Promise<OperationResult<unknown>>)(parsed.data); }
      catch (error) { return failResult("file_operation_failed", error instanceof Error ? error.message : String(error), { retryable: true }); }
    },
  }));
}
