/** Shared command inputs. Transport adapters add identity and concurrency fields. */
import { z } from "zod";
import { MAX_MINDMAP_LABEL_CHARS, MAX_MINDMAP_LABELS, normalizeMindmapLabels } from "@/lib/mindmap/node-metadata";
import { MIN_CARD_WIDTH, MAX_CARD_WIDTH } from "@/lib/mindmap/card-width";
import { APPLY_PROJECT_EDITS_INPUT,READ_PROJECT_FILES_INPUT } from "./project-files-contract";

const projectId = z.string().min(1).describe("Project slug from list_projects or the /p/<slug>/ URL.");
const mapId = z.string().min(1).describe("Map id from get_project_state. draft identifies the Primary map.");
const diskHash = z.string().regex(new RegExp("^[a-f0-9]{64}$")).describe("Disk hash returned by the last read.");
const revision = z.number().int().min(0).describe("Current map revision returned by get_mindmap or a map preview.");

export const SHARED_INPUTS = {
  sync_project: z.strictObject({ action: z.enum(["inspect", "review_pull", "apply_pull", "cancel_pull"]).describe("inspect reads status. review_pull checkpoints saved local files and prepares an isolated merge. apply_pull applies reviewed whole-file resolutions. cancel_pull removes the review checkout."), refresh: z.boolean().describe("Fetch Git before inspecting status.").optional(), token: z.string().describe("Exact review token returned by review_pull.").optional(), resolutions: z.array(z.strictObject({ path: z.string(), choice: z.enum(["local", "remote", "merged"]), text: z.string().max(1000000).describe("Complete merged file contents when choice=merged.").optional() })).optional() }),
  get_project_state: z.strictObject({ detail: z.enum(["summary", "full"]).describe("summary includes shared User / workspace instructions. full also includes project AGENTS.md bodies and every TODO by default.").optional(), todoLimit: z.number().int().min(0).max(200).describe("Max TODO rows to include. Default 8 for summary; full includes all unless set.").optional() }),
  update_workspace_instructions: z.strictObject({ body: z.string().max(200_000).describe("Complete replacement of the User / workspace instructions shared across every project. Preserve existing preferences and add only comments the user has asked to share across projects."), expectedHash: diskHash.describe("workspaceAgentsMd.hash from get_project_state, including the empty-file hash before first save.") }),
  navigate_project: z.strictObject({ id: z.string().describe("An id returned by get_project_state or search_project.").optional(), href: z.string().describe("A project href returned by get_project_state or search_project.").optional() }),
  read_project_skill: z.strictObject({ id: z.string().describe("Skill id from get_project_state."), source: z.enum(["project", "workspace", "openbar"]).describe("Catalog scope for matching skill ids.").optional() }),
  update_project: z.strictObject({ expectedHash: z.string().describe("Project hash from get_project_state.project.hash."), title: z.string().optional(), venue: z.string().optional(), tagline: z.string().optional(), overview: z.string().optional(), researchKind: z.string().optional(), color: z.string().optional(), icon: z.string().optional(), label: z.string().optional(), links: z.array(z.strictObject({ label: z.string(), url: z.string(), kind: z.enum(["overleaf", "latex", "arxiv", "web", "repo"]) })).max(50).optional(), collaborators: z.array(z.string()).max(100).optional(), archivedAt: z.string().nullable().optional(), engine: z.enum(["pdflatex", "xelatex", "lualatex"]).optional(), mainFile: z.string().optional(), texliveVersion: z.string().optional() })
};

export const WORKSPACE_INPUTS = {
  list_projects: z.strictObject({  }),
  get_workspace_layout: z.strictObject({}),
  move_project: z.strictObject({ slug: projectId, archived: z.boolean(), beforeSlug: projectId.optional(), afterSlug: projectId.optional(), expectedHash: diskHash }),
  open_project: z.strictObject({ slug: z.string().describe("Project slug from list_projects or search_projects.") })
};

export const INBOX_INPUTS = {
  check_inbox: z.strictObject({ limit: z.number().int().min(1).max(50).optional(), includeAcknowledged: z.boolean().optional() }),
  acknowledge_inbox: z.strictObject({ ids: z.array(diskHash).min(1).max(50), acknowledged: z.boolean().optional() }),
};

export const PAPER_INPUTS = {
  get_paper_state: z.strictObject({  }),
  navigate_paper_section: z.strictObject({ sectionId: z.string().regex(new RegExp("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")).describe("Current section id from get_paper_state.outline. The open page supplies the project.") }),
  set_paper_reader_mode: z.strictObject({ mode: z.enum(["document", "pdf"]).describe("Show the live document or the compiled PDF in the paper reader.") }),
  compile_paper: z.strictObject({  }),
  get_paper_compile: z.strictObject({ jobId: z.string().describe("Optional compile job id to compare with the live result.").optional() })
};

const mindmapLabel = z.string().refine(value => {
  const length = value.trim().length;
  return length > 0 && length <= MAX_MINDMAP_LABEL_CHARS;
}, `Each label must be 1–${MAX_MINDMAP_LABEL_CHARS} characters.`);
export const MINDMAP_LABELS_INPUT = z.array(mindmapLabel).max(MAX_MINDMAP_LABELS)
  .transform(normalizeMindmapLabels)
  .describe("Up to 50 labels, each 1–80 UTF-16 code units after trimming. Repeated labels are combined.");
const mindmapMetadata = z.record(z.string(), z.json())
  .refine(value => JSON.stringify(value).length <= 20_000, "metadata must be at most 20,000 JSON characters.")
  .nullable().describe("Card-owned JSON object. Limit 20,000 UTF-16 code units when serialized. Pass an empty object or null to clear it.");

const MINDMAP_PRESENTATION_INPUT = z.strictObject({ contentFormat: z.enum(["plain", "markdown", "tex", "html"]).optional(), tableLayout: z.enum(["wide", "scroll"]).optional(), cardWidth: z.number().int().min(MIN_CARD_WIDTH).max(MAX_CARD_WIDTH).nullable().describe("Card width in canvas CSS pixels. Height follows the content. null restores automatic width.").optional(), shape: z.enum(["branch", "leaf", "callout"]).optional(), color: z.string().optional(), progress: z.union([z.number().int().min(0).max(6), z.literal("ditched")]).nullable().describe("Map-local progress from 0 to 6, ditched for the yellow circle-slash status, or null to hide.").optional() });

export const MINDMAP_INPUTS = {
  get_mindmap: z.strictObject({  }),
  focus_mindmap_node: z.strictObject({ id: z.string() }),
  add_mindmap_node: z.strictObject({ parentId: z.string().describe("Existing parent card id from get_mindmap."), title: z.string().describe("Visible card title.").optional(), text: z.string().describe("Visible card body.").optional(), caption: z.string().describe("Collapsed Notes for reasoning, why an answer holds, methods, context, and supporting detail. Use this field for new notes and longer explanations.").optional(), caution: z.strictObject({ critical: z.string().describe("Existing note text displayed in the shared collapsed Notes. Prefer caption for new notes.").optional(), important: z.string().describe("Existing note text displayed in the shared collapsed Notes. Prefer caption for new notes.").optional(), background: z.string().describe("Existing supporting text displayed with caption in the shared collapsed Notes. Prefer caption for new notes. Keep consequential risks and factual uncertainty visible.").optional() }).describe("Replaces all caution fields. An empty object clears them.").optional(), presentation: MINDMAP_PRESENTATION_INPUT.optional(), expectedRevision: z.number().int().min(0).describe("Current map revision from get_mindmap.") }),
  move_mindmap_node: z.strictObject({ id: z.string(), parentId: z.string(), beforeId: z.string().optional(), afterId: z.string().optional(), expectedRevision: z.number().int().min(0) }),
  delete_mindmap_node: z.strictObject({ id: z.string(), expectedRevision: z.number().int().min(0) }),
  delete_mindmap_branch: z.strictObject({ id: z.string(), expectedRevision: z.number().int().min(0) }),
  set_mindmap_collapsed: z.strictObject({ id: z.string(), collapsed: z.boolean(), expectedRevision: z.number().int().min(0) }),
  patch_mindmap_node: z.strictObject({ agentDraft: z.literal(true).describe("Mark this card for human review. Human Save clears Agent draft.").optional(), id: z.string().describe("Existing card id from get_mindmap."), expectedRevision: z.number().int().min(0).describe("Current map revision from get_mindmap."), title: z.string().describe("Visible title for an ordinary card.").optional(), text: z.string().describe("Visible card body.").optional(), caption: z.string().describe("Collapsed Notes for reasoning, why an answer holds, methods, context, and supporting detail. Use this field for new notes and longer explanations.").optional(), caution: z.strictObject({ critical: z.string().describe("Existing note text displayed in the shared collapsed Notes. Prefer caption for new notes.").optional(), important: z.string().describe("Existing note text displayed in the shared collapsed Notes. Prefer caption for new notes.").optional(), background: z.string().describe("Existing supporting text displayed with caption in the shared collapsed Notes. Prefer caption for new notes. Keep consequential risks and factual uncertainty visible.").optional() }).describe("Replaces all caution fields. An empty object clears them.").optional(), labels: MINDMAP_LABELS_INPUT.optional(), refs: z.array(z.strictObject({ kind: z.enum(["project", "paper-section", "paper-todo", "paper-comment", "wiki-page", "mindmap-node", "figure", "web", "external"]), id: z.string(), label: z.string().optional(), url: z.string().optional(), imageWidth: z.number().int().min(25).max(100).describe("Image width as a percentage of card content width.").optional(), mapId: z.string().regex(new RegExp("^[A-Za-z0-9][A-Za-z0-9._-]*$")).describe("Map identity for mindmap-node references.").optional(), sectionContext: z.strictObject({ file: z.string().optional(), title: z.string().optional(), level: z.number().int().min(1).max(6).optional(), headingPath: z.array(z.string()).optional(), bodyHash: z.string().optional(), label: z.string().optional(), sourceHash: z.string().optional(), sourceRange: z.strictObject({ from: z.number().int().min(0), to: z.number().int().min(0) }).optional(), order: z.number().int().min(0).optional() }).optional() })).optional(), metadata: mindmapMetadata.optional(), presentation: MINDMAP_PRESENTATION_INPUT.optional(), priority: z.enum(["P0", "P1", "P2", "P3"]).nullable().optional() }),
  attach_mindmap_image: z.strictObject({ id: z.string(), assetId: z.string().min(1).describe("Existing project image path from read_project_files."), label: z.string().optional(), expectedRevision: z.number().int().min(0) }),
  detach_mindmap_image: z.strictObject({ id: z.string(), assetId: z.string(), expectedRevision: z.number().int().min(0) }),
  caption_mindmap_image: z.strictObject({ id: z.string(), assetId: z.string(), label: z.string(), expectedRevision: z.number().int().min(0) }),
  highlight_mindmap_activity: z.strictObject({ since: z.string().describe("ISO calendar date (YYYY-MM-DD). Omit for the past seven days.").optional(), clear: z.boolean().describe("Clear the activity highlight from the open map.").optional() }),
  link_todo_card: z.strictObject({ id: z.string().min(1), todoId: z.string().min(1), expectedRevision: revision }),
  place_todo_card: z.strictObject({ todoId: z.string().describe("Stable TODO id from the current paper."), parentId: z.string().describe("The existing card that should own this TODO card."), expectedRevision: z.number().int().min(0) }),
  convert_card_to_todo: z.strictObject({ id: z.string(), sectionId: z.string().describe("Optional current section id from the paper outline. Omit to place the TODO at a neutral location in the manuscript root.").optional(), expectedRevision: z.number().int().min(0), requestId: z.string().describe("Stable retry key. Reusing it returns the original local result.").optional() }),
  focus_todo_in_paper: z.strictObject({ todoId: z.string() }),
  set_mindmap_font_size: z.strictObject({ fontSize: z.number().int().min(10).max(20), expectedRevision: z.number().int().min(0) }),
  rename_mindmap: z.strictObject({ title: z.string(), expectedRevision: z.number().int().min(0) })
};

export const MINDMAP_EDIT_INPUT = z.strictObject({
  expectedRevision: revision,
  expectedDiskHash: diskHash.optional(),
  requestId: z.string().optional(),
  edit: z.strictObject({
    operation: z.string().min(1).max(64).describe("Managed map operation listed in the tool description."),
    args: z.record(z.string(), z.unknown()).refine(value => Object.keys(value).length <= 32 && JSON.stringify(value).length <= 200_000, "Use up to 32 fields and 200000 JSON characters.").describe("Operation fields. Bounded to 32 keys and 200000 JSON characters, with exact operation-specific validation."),
  }),
});

/** Exact private validators used by the compact native managed-map adapter. */
export const NATIVE_MINDMAP_INPUTS = {
  add_mindmap_node: MINDMAP_INPUTS.add_mindmap_node.extend({ project: projectId, mapId: mapId, id: z.string().describe("Optional unique card id. Omit to generate one.").optional(), expectedDiskHash: diskHash.optional(), requestId: z.string().optional() }),
  patch_mindmap_node: MINDMAP_INPUTS.patch_mindmap_node.extend({ project: projectId, mapId: mapId, expectedDiskHash: diskHash.optional(), requestId: z.string().optional() }),
  move_mindmap_node: MINDMAP_INPUTS.move_mindmap_node.extend({ project: projectId, mapId: mapId, expectedDiskHash: diskHash.optional(), requestId: z.string().optional() }),
  preview_mindmap_batch: z.strictObject({ project: projectId, mapId: mapId, selectedIds: z.array(z.string()).min(1).max(2000), expectedRevision: revision, expectedDiskHash: diskHash.optional(), previewToken: z.string().optional(), changes: z.record(z.string(), z.unknown()).optional(), deleteMode: z.enum(["cards", "branches"]).optional(), move: z.record(z.string(), z.unknown()).optional(), requestId: z.string().optional() }),
  apply_mindmap_batch: z.strictObject({ project: projectId, mapId: mapId, selectedIds: z.array(z.string()).min(1).max(2000), expectedRevision: revision, expectedDiskHash: diskHash.optional(), previewToken: z.string(), changes: z.record(z.string(), z.unknown()).optional(), deleteMode: z.enum(["cards", "branches"]).optional(), move: z.record(z.string(), z.unknown()).optional(), requestId: z.string().optional() }),
  link_todo_card: MINDMAP_INPUTS.link_todo_card.extend({ project: projectId, mapId, expectedDiskHash: diskHash.optional(), requestId: z.string().optional() }),
  place_todo_card: MINDMAP_INPUTS.place_todo_card.extend({ project: projectId, mapId: mapId, expectedDiskHash: diskHash.optional(), requestId: z.string().optional() }),
  rename_mindmap: MINDMAP_INPUTS.rename_mindmap.extend({ project: projectId, mapId: mapId, title: z.string().min(1).max(500), expectedDiskHash: diskHash.optional(), requestId: z.string().optional() }),
  set_mindmap_font_size: MINDMAP_INPUTS.set_mindmap_font_size.extend({ project: projectId, mapId: mapId, expectedDiskHash: diskHash.optional(), requestId: z.string().optional() }),
  attach_mindmap_image: MINDMAP_INPUTS.attach_mindmap_image.extend({ project: projectId, mapId: mapId, id: z.string().min(1), label: z.string().max(240).optional(), expectedDiskHash: diskHash.optional(), requestId: z.string().optional() }),
  detach_mindmap_image: MINDMAP_INPUTS.detach_mindmap_image.extend({ project: projectId, mapId: mapId, id: z.string().min(1), assetId: z.string().min(1), label: z.string().max(240).optional(), expectedDiskHash: diskHash.optional(), requestId: z.string().optional() }),
  caption_mindmap_image: MINDMAP_INPUTS.caption_mindmap_image.extend({ project: projectId, mapId: mapId, id: z.string().min(1), assetId: z.string().min(1), label: z.string().max(240), expectedDiskHash: diskHash.optional(), requestId: z.string().optional() }),
  set_activity_window: z.strictObject({ project: projectId, mapId: mapId, days: z.number().int().min(1).max(365), expectedRevision: revision, requestId: z.string().optional() }),
};

export const MCP_INPUTS = {
  list_projects: WORKSPACE_INPUTS.list_projects,
  get_workspace_layout: WORKSPACE_INPUTS.get_workspace_layout,
  move_project: WORKSPACE_INPUTS.move_project,
  get_project_state: SHARED_INPUTS.get_project_state.extend({ project: projectId }),
  update_workspace_instructions: SHARED_INPUTS.update_workspace_instructions,
  check_inbox: INBOX_INPUTS.check_inbox.extend({ project: projectId.optional() }),
  acknowledge_inbox: INBOX_INPUTS.acknowledge_inbox.extend({ project: projectId.optional() }),
  read_project_skill: SHARED_INPUTS.read_project_skill.extend({ project: projectId }),
  get_mindmap: MINDMAP_INPUTS.get_mindmap.extend({ project: projectId, mapId: mapId, offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(200).optional() }),
  update_project: SHARED_INPUTS.update_project.extend({ project: projectId, requestId: z.string().optional() }),
  sync_project: SHARED_INPUTS.sync_project.extend({ project: projectId }),
  compile_paper: PAPER_INPUTS.compile_paper.extend({ project: projectId }),
  get_paper_compile: PAPER_INPUTS.get_paper_compile.omit({ jobId: true }).extend({ project: projectId }),
  get_activity: z.strictObject({ project: projectId, days: z.number().int().min(1).max(365).optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(200).optional() }),
  read_project_files: READ_PROJECT_FILES_INPUT.extend({ project: projectId }),
  apply_project_edits: APPLY_PROJECT_EDITS_INPUT.extend({ project: projectId, requestId: z.string().optional() }),
  apply_mindmap_edits: MINDMAP_EDIT_INPUT.extend({ project: projectId, mapId }),
};
