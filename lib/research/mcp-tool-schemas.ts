/**
 * Shared Zod + JSON Schema for overlapping WebMCP / HTTP MCP tools.
 * HTTP MCP adds a `project` field; page-scoped WebMCP omits it.
 */

import { z } from "zod";

import type { JsonSchemaObject } from "./webmcp-paper-contract";

export const SHARED_WEBMCP_TOOL_NAMES = [
  "get_project_state",
  "search_project",
  "navigate_project",
  "read_project_skill",
  "get_project_context",
  "get_capabilities",
  "inspect_repository",
  "plan_repository_migration",
  "apply_repository_migration",
  "preview_conversion",
  "apply_conversion",
  "get_agenda",
  "navigate_artifact",
] as const;

export const DOCUMENT_WEBMCP_TOOL_NAMES = ["read_document", "patch_document", "render_preview"] as const;

export function objectSchema(properties: Record<string, unknown> = {}, required: string[] = []): JsonSchemaObject {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

export const documentKindSchema = z.enum(["wiki", "notes", "slides"]);

export const applyMigrationZod = z.object({
  planId: z.string(),
  expectedHash: z.string(),
  confirm: z.boolean(),
});

export const applyConversionZod = z.object({
  planId: z.string(),
  expectedHash: z.string(),
  acknowledgeLoss: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

export const previewConversionZod = z.object({
  filePath: z.string().optional(),
  to: z.string().optional(),
  expandProject: z.boolean().optional(),
});

export const readDocumentZod = z.object({
  kind: documentKindSchema,
  id: z.string(),
});

export const patchDocumentZod = z.object({
  kind: documentKindSchema,
  id: z.string(),
  baseHash: z.string(),
  body: z.string(),
});

export const navigateArtifactZod = z.object({
  kind: z.string(),
  id: z.string(),
});

export const searchProjectZod = z.object({
  query: z.string(),
});

export const navigateProjectZod = z.object({
  id: z.string().optional(),
  href: z.string().optional(),
});

export const readProjectSkillZod = z.object({
  id: z.string(),
});

export const SHARED_WEBMCP_SCHEMAS: Record<string, JsonSchemaObject> = {
  get_project_state: objectSchema(),
  search_project: objectSchema({ query: { type: "string", description: "Case-insensitive substring to find in the paper, TODOs, comments, mindmap, or wiki." } }, ["query"]),
  navigate_project: objectSchema({
    id: { type: "string", description: "An id returned by get_project_state or search_project." },
    href: { type: "string", description: "A project href returned by get_project_state or search_project." },
  }),
  read_project_skill: objectSchema({ id: { type: "string", description: "Skill id from get_project_state." } }, ["id"]),
  get_project_context: objectSchema(),
  get_capabilities: objectSchema(),
  inspect_repository: objectSchema(),
  plan_repository_migration: objectSchema(),
  apply_repository_migration: objectSchema(
    { planId: { type: "string" }, expectedHash: { type: "string" }, confirm: { type: "boolean" } },
    ["planId", "expectedHash", "confirm"],
  ),
  preview_conversion: objectSchema({ filePath: { type: "string" }, to: { type: "string" }, expandProject: { type: "boolean" } }),
  apply_conversion: objectSchema(
    { planId: { type: "string" }, expectedHash: { type: "string" }, acknowledgeLoss: { type: "boolean" }, dryRun: { type: "boolean" } },
    ["planId", "expectedHash"],
  ),
  get_agenda: objectSchema(),
  navigate_artifact: objectSchema({ kind: { type: "string" }, id: { type: "string" } }, ["kind", "id"]),
};

export const DOCUMENT_WEBMCP_SCHEMAS: Record<string, JsonSchemaObject> = {
  read_document: objectSchema({ kind: { type: "string" }, id: { type: "string" } }, ["id"]),
  patch_document: objectSchema(
    { kind: { type: "string" }, id: { type: "string" }, baseHash: { type: "string" }, body: { type: "string" } },
    ["id", "baseHash", "body"],
  ),
  render_preview: objectSchema({ kind: { type: "string" }, id: { type: "string" } }, ["id"]),
};
