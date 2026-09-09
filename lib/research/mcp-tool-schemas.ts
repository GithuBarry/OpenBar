/**
 * Shared Zod + JSON Schema for browser WebMCP tools.
 */

import { syncProjectProperties } from "./sync-project-contract";
import { z } from "zod";

import type { JsonSchemaObject } from "./webmcp-paper-contract";

export const PROJECT_WEBMCP_TOOL_NAMES = [
  "get_project_state",
  "sync_project",
  "search_project",
  "navigate_project",
  "update_project",
] as const;

export const INSTRUCTIONS_WEBMCP_TOOL_NAMES = ["read_project_skill"] as const;

export const WORKSPACE_WEBMCP_TOOL_NAMES = ["list_projects", "search_projects", "open_project"] as const;

/** Setup / import tools. Registered on the instructions page, not ordinary research pages. */
export const SETUP_WEBMCP_TOOL_NAMES = [
  "get_capabilities",
  "inspect_repository",
  "preview_conversion",
  "apply_conversion",
] as const;

export const DOCUMENT_WEBMCP_TOOL_NAMES = ["read_document", "patch_document", "render_preview"] as const;

export function objectSchema(properties: Record<string, unknown> = {}, required: string[] = []): JsonSchemaObject {
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
}

export const documentKindSchema = z.enum(["wiki"]);

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

export const updateProjectZod = z.object({
  expectedHash: z.string(),
  title: z.string().optional(),
  venue: z.string().optional(),
  tagline: z.string().optional(),
  overview: z.string().optional(),
  researchKind: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  label: z.string().optional(),
  engine: z.enum(["pdflatex", "xelatex", "lualatex"]).optional(),
  mainFile: z.string().optional(),
  texliveVersion: z.string().optional(),
  links: z.array(z.object({
    label: z.string(),
    url: z.string(),
    kind: z.enum(["overleaf", "latex", "arxiv", "web", "repo"]),
  })).optional(),
  collaborators: z.array(z.string()).optional(),
  archivedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const SHARED_WEBMCP_SCHEMAS: Record<string, JsonSchemaObject> = {
  sync_project: objectSchema(syncProjectProperties, ["action"]),
  get_project_state: objectSchema({
    detail: {
      type: "string",
      enum: ["summary", "full"],
      description: "summary is the default compact orientation. full includes AGENTS.md bodies and every TODO.",
    },
    todoLimit: {
      type: "integer",
      minimum: 0,
      maximum: 200,
      description: "Max TODO rows to include. Default 8 for summary; full includes all unless set.",
    },
  }),
  search_project: objectSchema({ query: { type: "string", description: "Case-insensitive substring to find in the paper, TODOs, comments, mindmap, or wiki." } }, ["query"]),
  navigate_project: objectSchema({
    id: { type: "string", description: "An id returned by get_project_state or search_project." },
    href: { type: "string", description: "A project href returned by get_project_state or search_project." },
  }),
  read_project_skill: objectSchema({ id: { type: "string", description: "Skill id from get_project_state." } }, ["id"]),
  get_capabilities: objectSchema(),
  inspect_repository: objectSchema(),
  preview_conversion: objectSchema({ filePath: { type: "string" }, to: { type: "string" }, expandProject: { type: "boolean" } }),
  apply_conversion: objectSchema(
    { planId: { type: "string" }, expectedHash: { type: "string" }, acknowledgeLoss: { type: "boolean" }, dryRun: { type: "boolean" } },
    ["planId", "expectedHash"],
  ),
  update_project: objectSchema({
    expectedHash: { type: "string", description: "Project hash from get_project_state.project.hash." },
    title: { type: "string" },
    venue: { type: "string" },
    tagline: { type: "string" },
    overview: { type: "string" },
    researchKind: { type: "string" },
    color: { type: "string" },
    icon: { type: "string" },
    label: { type: "string" },
    links: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          url: { type: "string" },
          kind: { type: "string", enum: ["overleaf", "latex", "arxiv", "web", "repo"] },
        },
        required: ["label", "url", "kind"],
        additionalProperties: false,
      },
    },
    collaborators: { type: "array", maxItems: 100, items: { type: "string" } },
    archivedAt: { type: ["string", "null"] },
    engine: { type: "string", enum: ["pdflatex", "xelatex", "lualatex"] },
    mainFile: { type: "string" },
    texliveVersion: { type: "string" },
  }, ["expectedHash"]),
};

export const WORKSPACE_WEBMCP_SCHEMAS: Record<(typeof WORKSPACE_WEBMCP_TOOL_NAMES)[number], JsonSchemaObject> = {
  list_projects: objectSchema(),
  search_projects: objectSchema(
    { query: { type: "string", description: "Case-insensitive text to match against project slug, title, tagline, or label." } },
    ["query"],
  ),
  open_project: objectSchema(
    { slug: { type: "string", description: "Project slug from list_projects or search_projects." } },
    ["slug"],
  ),
};

export const DOCUMENT_WEBMCP_SCHEMAS: Record<string, JsonSchemaObject> = {
  read_document: objectSchema({ kind: { type: "string" }, id: { type: "string" } }, ["id"]),
  patch_document: objectSchema(
    { kind: { type: "string" }, id: { type: "string" }, baseHash: { type: "string" }, body: { type: "string" } },
    ["id", "baseHash", "body"],
  ),
  render_preview: objectSchema({ kind: { type: "string" }, id: { type: "string" } }, ["id"]),
};

/** Page-scoped paper mutation tools. */
export const PAPER_MUTATION_TOOL_NAMES = ["patch_paper_table"] as const;

export const patchPaperTableZod = z.object({
  sectionId: z.string(),
  tableIndex: z.number().int().min(0),
  expectedRevision: z.number().int().min(0),
  updates: z.array(z.object({
    row: z.number().int().min(0),
    column: z.number().int().min(0),
    tex: z.string(),
  })).min(1).max(1),
});

export const PAPER_MUTATION_SCHEMAS: Record<(typeof PAPER_MUTATION_TOOL_NAMES)[number], JsonSchemaObject> = {
  patch_paper_table: objectSchema(
    {
      sectionId: { type: "string", description: "Current section id from get_paper_outline." },
      tableIndex: { type: "integer", minimum: 0, description: "0-based tabular in this section." },
      expectedRevision: { type: "integer", minimum: 0, description: "Live editor revision from get_paper_state." },
      updates: {
        type: "array",
        minItems: 1,
        maxItems: 1,
        description: "Exactly one cell. Complex tables return capability_unavailable.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            row: { type: "integer", minimum: 0, description: "0-based row, including the header." },
            column: { type: "integer", minimum: 0, description: "0-based column." },
            tex: { type: "string", description: "Replacement cell TeX." },
          },
          required: ["row", "column", "tex"],
        },
      },
    },
    ["sectionId", "tableIndex", "expectedRevision", "updates"],
  ),
};
