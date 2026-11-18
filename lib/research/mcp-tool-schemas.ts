import { SHARED_INPUTS,WORKSPACE_INPUTS } from "./command-inputs";
import { commandJsonSchemas } from "./command-schema";

export const PROJECT_WEBMCP_TOOL_NAMES = ["get_project_state","read_project_skill","sync_project","navigate_project","update_project","update_workspace_instructions"] as const;

export const WORKSPACE_WEBMCP_TOOL_NAMES = ["list_projects","get_workspace_layout","move_project","open_project"] as const;

export const SHARED_WEBMCP_SCHEMAS = commandJsonSchemas(SHARED_INPUTS);
export const WORKSPACE_WEBMCP_SCHEMAS = commandJsonSchemas(WORKSPACE_INPUTS);
