import { SHARED_INPUTS, WORKSPACE_INPUTS, DOCUMENT_INPUTS, PAPER_INPUTS } from "./command-inputs";
import { commandJsonSchemas } from "./command-schema";

export const PROJECT_WEBMCP_TOOL_NAMES = [
  "get_project_state",
  "read_project_skill",
  "sync_project",
  "search_project",
  "navigate_project",
  "update_project",
] as const;

export const WORKSPACE_WEBMCP_TOOL_NAMES = ["list_projects", "get_workspace_layout", "move_project", "search_projects", "open_project"] as const;

/** Setup / import tools. Registered on the instructions page, not ordinary research pages. */
export const SETUP_WEBMCP_TOOL_NAMES = [
  "get_capabilities",
  "inspect_repository",
  "preview_conversion",
  "apply_conversion",
] as const;

export const DOCUMENT_WEBMCP_TOOL_NAMES = ["read_document", "patch_document", "render_preview"] as const;

export const SHARED_WEBMCP_SCHEMAS = commandJsonSchemas(SHARED_INPUTS);
export const WORKSPACE_WEBMCP_SCHEMAS = commandJsonSchemas(WORKSPACE_INPUTS);
export const DOCUMENT_WEBMCP_SCHEMAS = commandJsonSchemas(DOCUMENT_INPUTS);
export const PAPER_MUTATION_TOOL_NAMES = ["patch_paper_table"] as const;
export const PAPER_MUTATION_SCHEMAS = commandJsonSchemas({ patch_paper_table: PAPER_INPUTS.patch_paper_table });
