#!/usr/bin/env node
/**
 * OpenBarry MCP server.
 *
 * Gives a coding/writing agent faithful, always-current context about the
 * active research workspace and keeps it honest: the agent sees the
 * explicit "what is NOT done" inventory and the research working-agreement
 * guardrails, so it cannot mistake a scaffold for a finished paper or claim the
 * work is complete while markers remain.
 *
 * It also exposes bundled working skills (anti-sycophancy, lean research
 * coder, rigorous researcher, draft maturation, status report, grill-me,
 * fresh-eyes review) as MCP prompts, and lets the agent append daily notes and
 * mindmap nodes as it works.
 *
 * Primary runtime: HTTP at /api/mcp through the Next.js app.
 * Content root defaults to ./content; override with OPENBARRY_CONTENT.
 *
 * Deployed agent config should point to:
 *   http://127.0.0.1:3001/api/mcp
 *
 * The direct stdio entrypoint remains below only for local fallback and
 * development checks.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import {
  listProjects,
  getProject,
  listContentDiagnostics,
  listDrafts,
  getDraft,
  getEditableTexPaper,
  patchEditableTexPaperSection,
  saveDraft,
  getBibliography,
  getBibliographyRaw,
  saveBibliographyRaw,
  getMindmap,
  saveMindmap,
  listWiki,
  getWikiPage,
  saveWikiPage,
  listNotes,
  saveNote,
  getNote,
  listPreregs,
  listClaims,
  getClaim,
  saveClaim,
  listEvidence,
  saveEvidence,
  listSourceManifest,
  saveSourceManifestEntry,
  listChallenges,
  listMonthlyReviews,
  projectContentDir,
} from "../lib/store";
import { getRuntimeCapabilities } from "../lib/research/capabilities";
import { inspectRepository } from "../lib/tex-project/source-graph";
import { buildSourceBundle } from "../lib/tex-project/source-bundle";
import { persistVirtualRange, applyConversionWrite } from "../lib/tex-project/source-persist";
import { texPaths, patchDocument, readDocument } from "../lib/tex-project/project";
import { requestPaperCompile } from "../lib/tex-project/compile";
import { normalizeMindmap, mindmapDiskHash } from "../lib/mindmap/v2";
import { applyRepositoryMigration, planRepositoryMigration } from "../lib/research/migration";
import { getProjectState, searchProject } from "../lib/research/project-state";
import { discoverSkillsInDir, readBundledSkill, readSkillFile } from "../lib/research/project-skills";
import { projectAgenda } from "../lib/research/project-agenda";
import { artifactHref, isArtifactKind } from "../lib/research/artifact-link";
import { failResult, okResult } from "../lib/research/operation-result";
import { safeUrl } from "../lib/safe-url";
import { applySourceOperation } from "../lib/research/operation-service";
import { applyMindmapAction } from "../features/mindmap/mindmap-state";
import { previewManuscriptConversion, getConversionPlan, proposedTableRepair, suspiciousTexSequences } from "../lib/tex-project/pandoc";
import { lintProsePercentages } from "../lib/tex-project/tex-lint";
import { escapeTexText } from "../lib/tex-project/tex-encode";
import { buildContextBundle, renderContextMarkdown } from "../lib/context-bundle";
import {
  asEvaluableClaim,
  buildProjectPaperGraph,
  summarizePaperClaims,
  type PaperGraphClaim,
  type PaperGraphEvidence,
} from "../lib/paper-graph";
import { parseBibtex } from "../lib/bibtex";
import { parseBibtexCitationJs } from "../lib/citation";
import { analyzeDraft } from "../lib/maturity";
import { lintDraft, transparencyScore } from "../lib/transparency-lint";
import { methodologyDigest, principlesFor } from "../lib/methodology";
import { sourceGroundingMarkdown } from "../lib/source-grounding";
import { LLM_WIKI_PROTOCOL } from "../lib/llm-wiki-protocol";
import { renderPaperSourceScanMarkdown, scanPaperSource } from "../lib/paper-source-scan";
import { buildWeeklyReview, renderWeeklyReviewMarkdown } from "../lib/weekly-review";
import { renderResolvedSourceMarkdown, resolveSourceLocator } from "../lib/source-locators";
import { SKILLS, getSkill } from "../lib/skills";
import { GUARDRAILS_TLDR, RESEARCH_GUARDRAILS } from "../lib/guardrails";
import { shortId } from "../lib/utils";
import { composeObtodo, parseTodoDate, parseTodoPriority, todayStamp } from "../lib/todo-meta";
import { inspectTexGitRepo, initializeMinimalTexRepo, initOverleafGit } from "../lib/tex-project/overleaf-git";
import { explainTexRepoSetup } from "../lib/tex-project/tex-repo-setup-guide";
import { evaluateClaimForPurpose, isReadyPaperGraphEvidence } from "../lib/research-policy";
import { isPathAllowed, resolveAllowedCreationPath, resolveAllowedPath } from "../lib/server/path-policy";
import type { ArtifactRef, EvidenceReceipt, EvidenceSourceKind, SourceManifestEntry } from "../lib/types";

export { isPathAllowed, resolveAllowedCreationPath, resolveAllowedPath } from "../lib/server/path-policy";
export { isReadyPaperGraphEvidence } from "../lib/research-policy";

import { isCredentialFreeGitRemote } from "../lib/server/git-url";
export { isCredentialFreeGitRemote };

export function missingPaperClaimMessage(project: string, claimId: string): string {
  return (
    `Claim "${claimId}" is missing from the paper for "${project}". ` +
    `Add it with add_claim or an \\obclaim in the manuscript.`
  );
}

export function findPaperClaim(project: string, claimId: string): PaperGraphClaim | undefined {
  return buildProjectPaperGraph(project).claims.find((claim) => claim.id === claimId);
}

export function evidenceLinkedToClaim(
  claim: PaperGraphClaim,
  graphEvidence: PaperGraphEvidence[],
  receipts: EvidenceReceipt[] = [],
): { paper: PaperGraphEvidence[]; receipts: EvidenceReceipt[] } {
  const paper = graphEvidence.filter(
    (item) => item.claimIds.includes(claim.id) || claim.evidenceIds.includes(item.id),
  );
  const linkedReceipts = receipts.filter(
    (item) => item.claimIds.includes(claim.id) || claim.evidenceIds.includes(item.id),
  );
  return { paper, receipts: linkedReceipts };
}

export function paperEvidenceForClaim(project: string, claimId: string): {
  claim: PaperGraphClaim | undefined;
  paper: PaperGraphEvidence[];
  receipts: EvidenceReceipt[];
} {
  const graph = buildProjectPaperGraph(project);
  const claim = graph.claims.find((item) => item.id === claimId);
  if (!claim) return { claim: undefined, paper: [], receipts: [] };
  return { claim, ...evidenceLinkedToClaim(claim, graph.evidence, listEvidence(project)) };
}

function claimPurposeBlockers(claim: PaperGraphClaim, purpose: string): string[] {
  const evaluation = evaluateClaimForPurpose(asEvaluableClaim(claim), purpose);
  if (evaluation.assessment === "ready") return [];
  return evaluation.considerations
    .filter((item) => item.severity === "medium" || item.severity === "high")
    .map((item) => `${item.code}: ${item.message}`);
}

export function createOpenBarryMcpServer() {
const server = new McpServer(
  { name: "openbarry", version: "0.1.0" },
  {
    instructions:
      "OpenBarry exposes the active research workspace. ALWAYS call `project_context` " +
      "for the relevant project before doing research work, and honor the working " +
      "agreement it returns. Call `source_grounding` and `llm_wiki_protocol` before " +
      "changing research workflow, wiki behavior, source-ingest behavior, or paper-gate behavior. " +
      "Treat the open-items list as ground truth about what is " +
      "unfinished: never claim a draft, experiment, or paper is complete while items " +
      "remain, and never fabricate results — mark unverified claims with {?hypothesized:}. " +
      "Call `research_methodology` to load the working " +
      "principles (Hamming, Christiano, Nanda, Carlini, reasoning transparency, " +
      "measurement validity) and `lint_draft` before calling any draft done. " +
      "The per-project DRAFT is the source of truth for manuscript claims, evidence, TODOs, and citations: read it with " +
      "`get_draft`, see what's open with `list_todos`, and edit the paper itself with `update_draft`/" +
      "`edit_draft` or the `add_claim`/`add_todo` helpers. The editable mindmap is a separate planning " +
      "canvas: use it for questions, structure, and next steps, but never treat a map node as evidence or " +
      "as permission to remove a draft TODO. Manage citations with `get_bibliography`/" +
      "`add_reference` (a separate references.bib) and cite with \\cite{key}. " +
      "Preserve single source of truth: keep experiment dashboards in their source system, " +
      "compute logs with their runs, shared notes in their source location, and repo artifacts in the repo. " +
      "Add the smallest useful source anchor, manifest, hash, or excerpt, then let OpenBarry link and challenge it. " +
      "The research team provides source access and strategic direction. Agents fill links, excerpts, wiki updates, and evidence checks from those sources. " +
      "Prioritize the why-chain over feature usage: why this project, why this claim matters, " +
      "why the evidence changes belief, why the next move has high information gain, and why a collaborator, advisor, or reviewer should care. " +
      "Maintain the LLM Wiki: update interlinked Markdown wiki pages from raw sources so agents build durable project memory instead of re-reading everything from scratch. " +
      GUARDRAILS_TLDR,
  },
);

// ---------------------------------------------------------------------------
// Helper: text content result
// ---------------------------------------------------------------------------
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const op = (result: unknown) => text(JSON.stringify(result, null, 2));

// The SDK exposes annotations as hints to clients. Keep them consistent for
// every tool even when a future tool registration forgets to add them.
const WRITE_TOOLS = new Set([
  "append_daily_note",
  "upsert_wiki_page",
  "ingest_source_note",
  "add_mindmap_node",
  "record_external_source",
  "record_source_ref",
  "record_local_file_source",
  "record_evidence_receipt",
  "record_source_pack",
  "update_draft",
  "edit_draft",
  "add_claim",
  "add_comment",
  "add_todo",
  "update_todo",
  "complete_todo",
  "add_reference",
  "replace_source_range",
  "apply_conversion",
  "apply_repository_migration",
  "rename_mindmap_node",
  "move_mindmap_node",
  "delete_mindmap_node",
  "set_mindmap_collapsed",
  "set_mindmap_node_presentation",
  "link_mindmap_artifact",
  "patch_document",
  "compile_document",
  "initialize_minimal_tex_repo",
  "configure_overleaf_remote",
]);
const ADDITIVE_WRITE_TOOLS = new Set([
  "append_daily_note",
  "ingest_source_note",
  "add_mindmap_node",
  "add_claim",
  "add_comment",
  "add_todo",
  "add_reference",
]);
const OPEN_WORLD_TOOLS = new Set(["record_external_source", "record_source_ref"]);
const originalRegisterTool = server.registerTool.bind(server);
server.registerTool = ((name: string, config: any, handler: any) => {
  const writes = WRITE_TOOLS.has(name);
  return originalRegisterTool(
    name,
    {
      ...config,
      annotations: {
        readOnlyHint: !writes,
        destructiveHint: writes && !ADDITIVE_WRITE_TOOLS.has(name),
        idempotentHint: !writes || name === "update_draft" || name === "upsert_wiki_page",
        openWorldHint: OPEN_WORLD_TOOLS.has(name),
        ...(config.annotations || {}),
      },
    },
    handler,
  );
}) as typeof server.registerTool;

const artifactRefSchema = z.object({
  kind: z.enum(["project", "draft-section", "draft-claim", "draft-todo", "wiki-page", "daily-note", "mindmap-node", "slide", "external"]),
  id: z.string(),
  label: z.string().optional(),
  url: z.string().optional(),
}).strict();

const evidenceSourceKindSchema = z.enum([
  "github",
  "wandb",
  "local",
  "remote",
  "google-doc",
  "google-slide",
  "overleaf",
  "codex-memory",
  "slack",
  "external",
]);

const sourceRoleSchema = z.enum(["raw-input", "intermediate", "output", "metric", "source"]);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const nonnegativeIntegerSchema = z.number().int().nonnegative();

function sourceArtifactRef(entry: SourceManifestEntry): ArtifactRef {
  return {
    kind: "external",
    id: entry.id,
    label: entry.label,
    url: /^https?:\/\//.test(entry.uri) ? entry.uri : undefined,
  };
}

function sourceRefIdsFor(project: string): Set<string> {
  return new Set(listSourceManifest(project).map((entry) => entry.id));
}

function refsExist(project: string, refs: ArtifactRef[] = []): string[] {
  const ids = sourceRefIdsFor(project);
  return refs.filter((ref) => ref.kind === "external" && !ids.has(ref.id)).map((ref) => ref.id);
}

function evidenceSourceExists(project: string, source: string): boolean {
  if (sourceRefIdsFor(project).has(source)) return true;
  const safePath = resolveAllowedPath(source);
  if (!safePath) return false;
  try {
    return fs.statSync(safePath).isFile();
  } catch {
    return false;
  }
}

function clipText(value: string | undefined, max = 700): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function hasRawEvidence(item: {
  rawInputRefs?: unknown[];
  intermediateRefs?: unknown[];
  outputRefs?: unknown[];
}): boolean {
  return Boolean(
    (item.rawInputRefs?.length ?? 0) > 0 ||
      (item.intermediateRefs?.length ?? 0) > 0 ||
      (item.outputRefs?.length ?? 0) > 0,
  );
}

function hasMetricEvidence(item: { metricRefs?: unknown[] }): boolean {
  return (item.metricRefs?.length ?? 0) > 0;
}

function needsRawInspection(item: {
  rawInputRefs?: unknown[];
  intermediateRefs?: unknown[];
  outputRefs?: unknown[];
  metricRefs?: unknown[];
  sampleCount?: number;
  limitations?: string;
}): boolean {
  return (
    !hasRawEvidence(item) ||
    (item.sampleCount ?? 0) < 10 ||
    /not a raw|missing raw|raw artifacts? (are )?missing|needs .*raw/i.test(item.limitations || "")
  );
}

function saysRawMissing(item: { limitations?: string }): boolean {
  return /not a raw|missing raw|raw artifacts? (are )?missing|needs .*raw/i.test(item.limitations || "");
}

function isReadyEvidenceReceipt(item: {
  rawInputRefs?: unknown[];
  intermediateRefs?: unknown[];
  outputRefs?: unknown[];
  metricRefs?: unknown[];
  sampleCount?: number;
  limitations?: string;
  verdict?: string;
  source?: string;
  reviewer?: string;
  reviewedAt?: string;
}): boolean {
  return (
    hasRawEvidence(item) &&
    hasMetricEvidence(item) &&
    (item.sampleCount ?? 0) >= 10 &&
    Boolean(item.source) &&
    Boolean(item.reviewer) &&
    Boolean(item.reviewedAt) &&
    (item.verdict === "supports" || item.verdict === "mixed") &&
    !saysRawMissing(item)
  );
}

function isReadyEvidenceReceiptForProject(project: string, item: EvidenceReceipt): boolean {
  return (
    isReadyEvidenceReceipt(item) &&
    evidenceSourceExists(project, item.source) &&
    refsExist(project, [
      ...(item.rawInputRefs || []),
      ...(item.intermediateRefs || []),
      ...(item.outputRefs || []),
      ...(item.metricRefs || []),
      ...(item.refs || []),
    ]).length === 0 &&
    (!item.reviewedAt || isoDateTimeSchema.safeParse(item.reviewedAt).success)
  );
}

function relevantGateChallenges(
  project: string,
  {
    claimIds = [],
    targetSection,
  }: {
    claimIds?: string[];
    targetSection?: string;
  } = {},
) {
  return listChallenges(project).filter((challenge) => {
    if (challenge.status !== "active" || challenge.severity !== "gate") return false;
    if (!challenge.targetRef) return true;
    if (challenge.targetRef.kind === "draft-section") return challenge.targetRef.id === targetSection;
    return claimIds.includes(challenge.targetRef.id);
  });
}

function wikiSourceRef(entry: ReturnType<typeof listSourceManifest>[number]) {
  return {
    kind: "external" as const,
    id: entry.id,
    label: entry.label,
    url: /^https?:\/\//.test(entry.uri) ? entry.uri : undefined,
  };
}

function sourceUpdateBlock({
  sourceId,
  summary,
  contradictions,
  questionsForTeam,
}: {
  sourceId: string;
  summary: string;
  contradictions?: string[];
  questionsForTeam?: string[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [`## Source update ${today}: ${sourceId}`, "", summary.trim()];
  if (contradictions?.length) {
    lines.push("", "### Contradictions or stale claims");
    for (const item of contradictions) lines.push(`- ${item}`);
  }
  if (questionsForTeam?.length) {
    lines.push("", "### Questions for the research team");
    for (const item of questionsForTeam) lines.push(`- ${item}`);
  }
  return `${lines.join("\n")}\n`;
}

function appendWikiPage({
  project,
  page,
  title,
  summary,
  body,
  sourceRef,
  tags,
}: {
  project: string;
  page: string;
  title: string;
  summary: string;
  body: string;
  sourceRef: ReturnType<typeof listSourceManifest>[number];
  tags?: string[];
}) {
  const existing = getWikiPage(project, page);
  saveWikiPage({
    projectId: project,
    slug: page,
    title: existing?.title || title,
    summary: existing?.summary || summary,
    body: [existing?.body.trim(), body].filter(Boolean).join("\n\n"),
    tags: Array.from(new Set([...(existing?.tags || []), ...(tags || []), "llm-wiki"])),
    refs: Array.from(
      new Map([...(existing?.refs || []), wikiSourceRef(sourceRef)].map((ref) => [ref.id, ref])).values(),
    ),
    pinnedForAgents: existing?.pinnedForAgents ?? true,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function regenerateWikiIndex(project: string) {
  const pages = listWiki(project).filter((page) => page.slug !== "index");
  const body = [
    "# LLM Wiki Index",
    "",
    "Agent-maintained map of compiled project knowledge. Start here, then open source refs only when needed.",
    "",
    ...pages.map((page) => {
      const refs = page.refs.length ? ` Sources: ${page.refs.map((ref) => ref.label || ref.id).join(", ")}.` : "";
      return `- [[${page.slug}]] — ${page.summary || page.title}.${refs}`;
    }),
    "",
  ].join("\n");
  const existing = getWikiPage(project, "index");
  saveWikiPage({
    projectId: project,
    slug: "index",
    title: "LLM Wiki Index",
    summary: "Agent-maintained map of compiled project knowledge.",
    body,
    tags: ["llm-wiki", "index"],
    refs: [],
    pinnedForAgents: true,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

function sha256File(file: string): string {
  const hash = createHash("sha256");
  const data = fs.readFileSync(file);
  hash.update(data);
  return hash.digest("hex");
}

function excerptLines(file: string, startLine = 1, lineCount = 20): string | undefined {
  if (lineCount <= 0) return undefined;
  const raw = fs.readFileSync(file, "utf8");
  return raw
    .split(/\r?\n/)
    .slice(Math.max(0, startLine - 1), Math.max(0, startLine - 1) + lineCount)
    .join("\n")
    .slice(0, 4000);
}

function localSourceEntry({
  project,
  filePath,
  id,
  label,
  tags,
  linkedWikiPages,
  linkedClaimIds,
  excerptStartLine,
  excerptLineCount,
  notes,
  metadata,
}: {
  project: string;
  filePath: string;
  id?: string;
  label?: string;
  tags?: string[];
  linkedWikiPages?: string[];
  linkedClaimIds?: string[];
  excerptStartLine?: number;
  excerptLineCount?: number;
  notes?: string;
  metadata?: Record<string, unknown>;
}): { entry?: SourceManifestEntry; error?: string } {
  const safePath = resolveAllowedPath(filePath);
  if (!safePath) {
    return { error: `Access denied: path "${filePath}" is outside allowed content/workspace roots.` };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(safePath);
  } catch {
    return { error: `File not found: ${filePath}` };
  }
  if (!stat.isFile()) return { error: `Path is not a file: ${filePath}` };
  const sourceId = id || safePath.split(/[\\/]/).filter(Boolean).slice(-2).join("-").replace(/[^A-Za-z0-9._-]+/g, "-");
  const selectedExcerpt = excerptLines(safePath, excerptStartLine, excerptLineCount);
  return {
    entry: {
      projectId: project,
      id: sourceId,
      kind: "local",
      label: label || sourceId,
      uri: safePath,
      sha256: sha256File(safePath),
      sizeBytes: stat.size,
      mtime: stat.mtime.toISOString(),
      fetchedAt: new Date().toISOString(),
      selectedExcerpt,
      anchors: selectedExcerpt
        ? [{ label: "selected excerpt", selector: `L${excerptStartLine || 1}:L${(excerptStartLine || 1) + (excerptLineCount || 20) - 1}`, excerpt: selectedExcerpt }]
        : undefined,
      metadata,
      tags,
      linkedWikiPages,
      linkedClaimIds,
      notes,
    },
  };
}

function linkEvidenceToClaims(project: string, evidenceId: string, claimIds: string[]) {
  for (const claimId of claimIds) {
    const claim = getClaim(project, claimId);
    if (!claim || claim.evidenceIds.includes(evidenceId)) continue;
    saveClaim({ ...claim, evidenceIds: [...claim.evidenceIds, evidenceId] });
  }
}

function refreshEvidenceClaimLinks(project: string, evidenceId: string, nextClaimIds: string[]) {
  for (const claim of listClaims(project)) {
    const shouldLink = nextClaimIds.includes(claim.id);
    const hasLink = claim.evidenceIds.includes(evidenceId);
    if (shouldLink && !hasLink) {
      saveClaim({ ...claim, evidenceIds: [...claim.evidenceIds, evidenceId] });
    }
    if (!shouldLink && hasLink) {
      saveClaim({ ...claim, evidenceIds: claim.evidenceIds.filter((id) => id !== evidenceId) });
    }
  }
}

function lintWikiProject(project: string): string[] {
  const findings: string[] = [];
  const pages = listWiki(project);
  const pageIds = new Set(pages.map((page) => page.slug));
  const sourceRefs = listSourceManifest(project);
  for (const page of pages) {
    const wikiLinks = Array.from(page.body.matchAll(/\[\[([^\]]+)\]\]/g)).map((match) => match[1].split("|")[0].trim());
    for (const link of wikiLinks) {
      if (!pageIds.has(link)) findings.push(`wiki/${page.slug} links to missing wiki/${link}.`);
    }
    if (page.pinnedForAgents && page.slug !== "index" && page.refs.length === 0) {
      findings.push(`wiki/${page.slug} is pinned for agents but has no source refs.`);
    }
  }
  for (const source of sourceRefs) {
    for (const page of source.linkedWikiPages || []) {
      if (!pageIds.has(page)) findings.push(`source/${source.id} links to missing wiki/${page}.`);
      const wiki = pages.find((item) => item.slug === page);
      if (wiki && !wiki.refs.some((ref) => ref.id === source.id)) {
        findings.push(`source/${source.id} lists wiki/${page}, but that page frontmatter does not reference the source.`);
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// TOOLS
// ---------------------------------------------------------------------------

function validateMindmapToolInput(project: string, mapId?: string): string | null {
  if (!getProject(project)) return `Unknown project "${project}".`;
  if (mapId && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(mapId)) return `Invalid mindmap id "${mapId}".`;
  return null;
}

server.registerTool(
  "list_projects",
  {
    title: "List research projects",
    description:
      "List all research projects in the current workspace with status, tagline, and venue. Start here to find the project slug you need.",
    inputSchema: {},
  },
  async () => {
    const projects = listProjects();
    if (!projects.length) return text("No projects found.");
    const body = projects
      .map(
        (p) =>
          `- **${p.slug}** — ${p.title} (${p.status}${p.venue ? `, ${p.venue}` : ""})\n  ${p.tagline}`,
      )
      .join("\n");
    return text(`# Projects\n\n${body}`);
  },
);

server.registerTool(
  "get_capabilities",
  {
    title: "Get runtime capabilities",
    description: "Report Git, Pandoc, LaTeX, writable paths, document modes, and Cloudflare Access status.",
    inputSchema: {},
  },
  async () => text(JSON.stringify(getRuntimeCapabilities(), null, 2)),
);

server.registerTool(
  "inspect_repository",
  {
    title: "Inspect TeX repository graph",
    description: "Traverse the declared TeX root and report include diagnostics and whether a migration is required.",
    inputSchema: { project: z.string().describe("project slug") },
  },
  async ({ project }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const dir = projectContentDir(project);
    const inspection = inspectRepository(texPaths(dir).manuscriptDir);
    return text(JSON.stringify(inspection, null, 2));
  },
);

server.registerTool(
  "get_source_bundle",
  {
    title: "Get continuous TeX source bundle",
    description: "Return the concatenated include graph with virtual offsets, file hashes, and diagnostics.",
    inputSchema: { project: z.string().describe("project slug") },
  },
  async ({ project }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const dir = projectContentDir(project);
    const bundle = buildSourceBundle(texPaths(dir).manuscriptDir);
    return text(JSON.stringify({
      rootFile: bundle.rootFile,
      revision: bundle.revision,
      bundleHash: bundle.bundleHash,
      segments: bundle.segments,
      diagnostics: bundle.diagnostics,
      source: bundle.source,
      sourceLength: bundle.source.length,
    }, null, 2));
  },
);

server.registerTool(
  "get_project_context",
  {
    title: "Get project context",
    description: "Alias of project_context. Return the working agreement, overview, and open-item inventory.",
    inputSchema: { project: z.string().describe("project slug") },
  },
  async ({ project }) => {
    if (!getProject(project)) return text(`Unknown project "${project}". Call list_projects first.`);
    const md = renderContextMarkdown(project);
    if (!md) return text(`Unknown project "${project}". Call list_projects first.`);
    return text(md);
  },
);

server.registerTool(
  "get_agenda",
  {
    title: "Get project agenda",
    description: "Combine open TODOs, deadlines, milestones, and conversion warnings.",
    inputSchema: { project: z.string() },
  },
  async ({ project }) => {
    if (!getProject(project)) return op(failResult("invalid_path", `Unknown project "${project}".`, { retryable: false }));
    return op(okResult(projectAgenda(project)));
  },
);

server.registerTool(
  "navigate_artifact",
  {
    title: "Resolve an artifact deep link",
    description: "Return the in-app href for a generic artifact reference.",
    inputSchema: {
      project: z.string(),
      kind: z.string(),
      id: z.string(),
    },
  },
  async ({ project, kind, id }) => {
    if (!getProject(project)) return op(failResult("invalid_path", `Unknown project "${project}".`, { retryable: false }));
    if (!isArtifactKind(kind)) return op(failResult("invalid_arguments", `Unknown artifact kind "${kind}".`, { retryable: false }));
    if (!id.trim()) return op(failResult("invalid_arguments", "id must be a non-empty string.", { retryable: false }));
    return op(okResult({ href: artifactHref(project, { kind, id }) }));
  },
);

server.registerTool(
  "plan_repository_migration",
  {
    title: "Plan openbarry/project@2 migration",
    description: "Inspect the TeX include graph and return a migration plan. Apply requires the plan id, expected hash, and confirm=true.",
    inputSchema: { project: z.string() },
  },
  async ({ project }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const plan = planRepositoryMigration(texPaths(projectContentDir(project)).manuscriptDir, project);
    return text(JSON.stringify(plan, null, 2));
  },
);

server.registerTool(
  "apply_repository_migration",
  {
    title: "Apply an inspected repository migration",
    description: "Write openbarry/project@2 comment metadata. Does not rewrite paper.tex or style files. Approval comes from the human or controlling agent.",
    inputSchema: {
      project: z.string(),
      planId: z.string(),
      expectedRepositoryHash: z.string(),
      confirm: z.boolean(),
    },
  },
  async ({ project, planId, expectedRepositoryHash, confirm }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const result = applyRepositoryMigration(texPaths(projectContentDir(project)).manuscriptDir, {
      planId,
      expectedRepositoryHash,
      confirm,
    });
    return text(JSON.stringify(result, null, 2));
  },
);

server.registerTool(
  "read_source_range",
  {
    title: "Read a virtual source range",
    description: "Slice the include-graph source bundle. Multi-file ranges are rejected on write.",
    inputSchema: {
      project: z.string(),
      from: z.number().int().nonnegative(),
      to: z.number().int().nonnegative(),
    },
  },
  async ({ project, from, to }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const bundle = buildSourceBundle(texPaths(projectContentDir(project)).manuscriptDir);
    if (to < from || to > bundle.source.length) return text(JSON.stringify({ ok: false, code: "stale_selection" }));
    return text(JSON.stringify({ from, to, text: bundle.source.slice(from, to), bundleHash: bundle.bundleHash }, null, 2));
  },
);

server.registerTool(
  "replace_source_range",
  {
    title: "Replace a virtual source range",
    description: "Patch the owning include-graph file. Spans that cross files are rejected.",
    inputSchema: {
      project: z.string(),
      from: z.number().int().nonnegative(),
      to: z.number().int().nonnegative(),
      text: z.string(),
      expectedBundleHash: z.string().optional(),
      dryRun: z.boolean().optional(),
    },
  },
  async ({ project, from, to, text: next, expectedBundleHash, dryRun }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const result = persistVirtualRange({
      manuscriptDir: texPaths(projectContentDir(project)).manuscriptDir,
      from,
      to,
      text: next,
      expectedBundleHash,
      dryRun,
    });
    return text(JSON.stringify(result, null, 2));
  },
);

server.registerTool(
  "lint_document",
  {
    title: "Lint a project manuscript",
    description: "Report prose-percentage quick fixes and possible table syntax issues.",
    inputSchema: { project: z.string() },
  },
  async ({ project }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const bundle = buildSourceBundle(texPaths(projectContentDir(project)).manuscriptDir);
    return text(JSON.stringify({
      percentages: lintProsePercentages(bundle.source),
      suspicious: suspiciousTexSequences(bundle.source),
      proposedRepair: suspiciousTexSequences(bundle.source).length ? proposedTableRepair(bundle.source) : null,
    }, null, 2));
  },
);

server.registerTool(
  "preview_conversion",
  {
    title: "Preview a Pandoc conversion",
    description: "Convert a manuscript file through Pandoc without writing. Apply is a separate confirmed operation.",
    inputSchema: {
      project: z.string(),
      filePath: z.string().describe("Path relative to the manuscript directory"),
      to: z.string().optional(),
      expandProject: z.boolean().optional(),
    },
  },
  async ({ project, filePath, to, expandProject }) => {
    if (!getProject(project)) return op(failResult("invalid_path", `Unknown project "${project}".`, { retryable: false }));
    const manuscriptDir = texPaths(projectContentDir(project)).manuscriptDir;
    const preview = await previewManuscriptConversion({
      projectId: project,
      manuscriptDir,
      filePath,
      to,
      expandProject: expandProject === true,
      requireExistingFile: true,
    });
    if (!preview.ok) return op(failResult("invalid_path", preview.message, { retryable: false }));
    const plan = preview.plan;
    return op(okResult({
      planId: plan.id,
      loss: plan.artifact.loss,
      diagnostics: plan.artifact.diagnostics,
      unsupported: plan.artifact.unsupported,
      sourceHash: plan.artifact.sourceHash,
      outputHash: plan.artifact.outputHash,
      outputPreview: plan.artifact.output.slice(0, 4000),
    }));
  },
);

server.registerTool(
  "apply_conversion",
  {
    title: "Apply a previewed Pandoc conversion",
    description: "Write the conversion sidecar after acknowledging loss. Requires the plan id and source hash.",
    inputSchema: {
      project: z.string(),
      planId: z.string(),
      expectedHash: z.string(),
      acknowledgeLoss: z.boolean(),
      dryRun: z.boolean().optional(),
    },
  },
  async ({ project, planId, expectedHash, acknowledgeLoss, dryRun }) => {
    if (!getProject(project)) return op(failResult("invalid_path", `Unknown project "${project}".`, { retryable: false }));
    const manuscriptDir = texPaths(projectContentDir(project)).manuscriptDir;
    const plan = getConversionPlan(planId, manuscriptDir);
    if (!plan || plan.projectId !== project) return op(failResult("invalid_arguments", "Unknown conversion plan.", { retryable: false }));
    if (plan.artifact.sourceHash !== expectedHash) {
      return op(failResult("stale_disk_state", "Conversion plan is stale.", { retryable: true, currentHash: plan.artifact.sourceHash }));
    }
    const result = await applyConversionWrite({
      manuscriptDir,
      filePath: plan.filePath,
      output: plan.artifact.output,
      loss: plan.artifact.loss,
      acknowledgeLoss,
      expectedSourceFileHash: plan.artifact.sourceFileHash,
      expectedSourceBundleHash: plan.artifact.sourceBundleHash,
      expectedExpandedSourceHash: plan.artifact.sourceHash,
      expandProject: plan.artifact.expandMethod !== "none",
      dryRun,
    });
    return op(result);
  },
);

server.registerTool(
  "compile_document",
  {
    title: "Compile the TeX manuscript",
    description: "Start latexmk for the project paper and return the compile status.",
    inputSchema: { project: z.string() },
  },
  async ({ project }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const status = requestPaperCompile(projectContentDir(project));
    return text(JSON.stringify(status, null, 2));
  },
);

server.registerTool(
  "read_document",
  {
    title: "Read a wiki, note, or slides document",
    description: "Return stored document bytes without implicit format conversion.",
    inputSchema: {
      project: z.string(),
      kind: z.enum(["wiki", "notes", "slides"]),
      id: z.string(),
    },
  },
  async ({ project, kind, id }) => {
    if (!getProject(project)) return op(failResult("invalid_path", `Unknown project "${project}".`, { retryable: false }));
    const document = readDocument(projectContentDir(project), kind, id);
    if (!document) return op(failResult("invalid_path", `Unknown ${kind} document "${id}".`, { retryable: false }));
    return op(okResult({
      format: document.format,
      htmlMode: document.htmlMode,
      hash: document.stateHash,
      bodyHash: document.hash,
      body: document.markdown,
    }, { diskHash: document.stateHash }));
  },
);

server.registerTool(
  "patch_document",
  {
    title: "Patch a wiki, note, or slides document",
    description: "Write source bytes for the declared format. Requires the current hash.",
    inputSchema: {
      project: z.string(),
      kind: z.enum(["wiki", "notes", "slides"]),
      id: z.string(),
      baseHash: z.string(),
      body: z.string(),
    },
  },
  async ({ project, kind, id, baseHash, body }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    try {
      const next = patchDocument(projectContentDir(project), kind, id, baseHash, body);
      return op(okResult({ hash: next.stateHash, bodyHash: next.hash, format: next.format }, { diskHash: next.stateHash }));
    } catch (error) {
      return op(failResult("stale_disk_state", error instanceof Error ? error.message : String(error), { retryable: true }));
    }
  },
);

server.registerTool(
  "render_preview",
  {
    title: "Render a document preview payload",
    description: "Return format, html mode, and stored body for the wiki viewer.",
    inputSchema: {
      project: z.string(),
      kind: z.enum(["wiki", "notes", "slides"]),
      id: z.string(),
    },
  },
  async ({ project, kind, id }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const document = readDocument(projectContentDir(project), kind, id);
    if (!document) return text(`Unknown ${kind} document "${id}".`);
    return text(JSON.stringify({
      format: document.format,
      htmlMode: document.htmlMode,
      body: document.markdown,
      hash: document.stateHash,
    }, null, 2));
  },
);

server.registerTool(
  "get_mindmap",
  {
    title: "Get a mindmap",
    description: "Return the stored mindmap tree, revision, and disk hash.",
    inputSchema: {
      project: z.string(),
      mapId: z.string().optional(),
    },
  },
  async ({ project, mapId }) => {
    const invalid = validateMindmapToolInput(project, mapId);
    if (invalid) return text(invalid);
    const map = getMindmap(project, mapId);
    if (!map) return text(`No mindmap found for "${project}".`);
    return text(JSON.stringify({
      id: map.id,
      rootId: map.rootId,
      revision: map.revision,
      diskHash: mindmapDiskHash(map),
      nodes: map.nodes.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        text: node.text,
        collapsed: node.collapsed,
        order: node.order,
        contentFormat: node.contentFormat,
        maturity: node.maturity,
        shape: node.shape,
        color: node.color,
        refs: node.refs || [],
        metadata: node.metadata || {},
        derivedKind: node.derivedKind,
        createdAt: node.createdAt,
      })),
    }, null, 2));
  },
);

server.registerTool(
  "focus_mindmap_node",
  {
    title: "Focus a mindmap node",
    description: "Return the deep link for a mindmap node. Focusing is a live UI operation on the mindmap page.",
    inputSchema: { project: z.string(), id: z.string(), mapId: z.string().optional() },
  },
  async ({ project, id, mapId }) => {
    const invalid = validateMindmapToolInput(project, mapId);
    if (invalid) return text(invalid);
    if (!id.trim()) return text("Mindmap node id cannot be empty.");
    const map = getMindmap(project, mapId);
    if (!map) return text(`No mindmap found for "${project}".`);
    if (!map.nodes.some((node) => node.id === id)) return text(`Unknown mindmap node "${id}".`);
    return text(JSON.stringify({ href: artifactHref(project, { kind: "mindmap-node", id }) }, null, 2));
  },
);

server.registerTool(
  "rename_mindmap_node",
  {
    title: "Rename a mindmap node",
    description: "Update node text with compare-and-swap on disk hash.",
    inputSchema: {
      project: z.string(),
      id: z.string(),
      text: z.string(),
      expectedDiskHash: z.string(),
      mapId: z.string().optional(),
    },
  },
  async ({ project, id, text: nodeText, expectedDiskHash, mapId }) => {
    const invalid = validateMindmapToolInput(project, mapId);
    if (invalid) return text(invalid);
    const map = getMindmap(project, mapId);
    if (!map) return text(`No mindmap found.`);
    if (!map.nodes.some((node) => node.id === id)) return text(`Unknown mindmap node "${id}".`);
    if (!nodeText.trim()) return text("Mindmap node text cannot be empty.");
    const currentHash = mindmapDiskHash(map);
    if (currentHash !== expectedDiskHash) return text(JSON.stringify({ ok: false, code: "stale_disk_state", currentHash }));
    const next = normalizeMindmap({
      ...map,
      revision: (map.revision ?? 0) + 1,
      nodes: map.nodes.map((node) => node.id === id ? { ...node, text: nodeText } : node),
    });
    saveMindmap(project, { ...next, diskHash: mindmapDiskHash(next) }, currentHash);
    return text(`Renamed ${id}.`);
  },
);

server.registerTool(
  "move_mindmap_node",
  {
    title: "Move or reparent a mindmap node",
    description: "Set parentId with compare-and-swap. Rejects moves into descendants.",
    inputSchema: {
      project: z.string(),
      id: z.string(),
      parentId: z.string(),
      beforeId: z.string().optional(),
      afterId: z.string().optional(),
      expectedDiskHash: z.string(),
      mapId: z.string().optional(),
    },
  },
  async ({ project, id, parentId, beforeId, afterId, expectedDiskHash, mapId }) => {
    const invalid = validateMindmapToolInput(project, mapId);
    if (invalid) return op(failResult("invalid_path", invalid, { retryable: false }));
    const map = getMindmap(project, mapId);
    if (!map) return op(failResult("invalid_path", "No mindmap found.", { retryable: false }));
    const currentHash = mindmapDiskHash(map);
    if (currentHash !== expectedDiskHash) {
      return op(failResult("stale_disk_state", "Mindmap hash does not match.", { retryable: true, currentHash }));
    }
    if (!map.nodes.some((node) => node.id === parentId)) {
      return op(failResult("invalid_arguments", `Unknown parent "${parentId}".`, { retryable: false }));
    }
    if (!map.nodes.some((node) => node.id === id)) {
      return op(failResult("invalid_arguments", `Unknown node "${id}".`, { retryable: false }));
    }
    if (id === map.rootId) {
      return op(failResult("invalid_arguments", "The root topic cannot be moved.", { retryable: false }));
    }
    if (id === parentId) {
      return op(failResult("invalid_arguments", "A node cannot be its own parent.", { retryable: false }));
    }
    if (beforeId && afterId) {
      return op(failResult("invalid_arguments", "Provide beforeId or afterId, not both.", { retryable: false }));
    }
    if (beforeId && !map.nodes.some((node) => node.id === beforeId && node.parentId === parentId)) {
      return op(failResult("invalid_arguments", `Unknown sibling "${beforeId}" under "${parentId}".`, { retryable: false }));
    }
    if (afterId && !map.nodes.some((node) => node.id === afterId && node.parentId === parentId)) {
      return op(failResult("invalid_arguments", `Unknown sibling "${afterId}" under "${parentId}".`, { retryable: false }));
    }
    const moved = applyMindmapAction(map, { type: "reparent", id, parentId, beforeId, afterId });
    if (moved.mindmap === map) {
      return op(failResult("invalid_arguments", "The requested move would create an invalid mindmap tree.", { retryable: false }));
    }
    const next = normalizeMindmap({ ...moved.mindmap, revision: (map.revision ?? 0) + 1 });
    saveMindmap(project, { ...next, diskHash: mindmapDiskHash(next) }, currentHash);
    return op(okResult({ id, parentId, beforeId, afterId }, { diskHash: mindmapDiskHash(next), revision: next.revision }));
  },
);

server.registerTool(
  "delete_mindmap_node",
  {
    title: "Delete a mindmap subtree",
    description: "Remove a node and its descendants. The root cannot be deleted.",
    inputSchema: {
      project: z.string(),
      id: z.string(),
      expectedDiskHash: z.string(),
      mapId: z.string().optional(),
    },
  },
  async ({ project, id, expectedDiskHash, mapId }) => {
    const invalid = validateMindmapToolInput(project, mapId);
    if (invalid) return text(invalid);
    const map = getMindmap(project, mapId);
    if (!map) return text(`No mindmap found.`);
    if (id === map.rootId) return text("The root topic cannot be deleted.");
    if (!map.nodes.some((node) => node.id === id)) return text(`Unknown mindmap node "${id}".`);
    const currentHash = mindmapDiskHash(map);
    if (currentHash !== expectedDiskHash) return text(JSON.stringify({ ok: false, code: "stale_disk_state", currentHash }));
    const remove = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of map.nodes) {
        if (node.parentId && remove.has(node.parentId) && !remove.has(node.id)) {
          remove.add(node.id);
          grew = true;
        }
      }
    }
    const next = normalizeMindmap({
      ...map,
      revision: (map.revision ?? 0) + 1,
      nodes: map.nodes.filter((node) => !remove.has(node.id)),
    });
    saveMindmap(project, { ...next, diskHash: mindmapDiskHash(next) }, currentHash);
    return text(`Deleted ${id}.`);
  },
);

server.registerTool(
  "set_mindmap_collapsed",
  {
    title: "Collapse or expand a mindmap node",
    inputSchema: {
      project: z.string(),
      id: z.string(),
      collapsed: z.boolean(),
      expectedDiskHash: z.string(),
      mapId: z.string().optional(),
    },
  },
  async ({ project, id, collapsed, expectedDiskHash, mapId }) => {
    const invalid = validateMindmapToolInput(project, mapId);
    if (invalid) return text(invalid);
    const map = getMindmap(project, mapId);
    if (!map) return text(`No mindmap found.`);
    if (!map.nodes.some((node) => node.id === id)) return text(`Unknown mindmap node "${id}".`);
    const currentHash = mindmapDiskHash(map);
    if (currentHash !== expectedDiskHash) return text(JSON.stringify({ ok: false, code: "stale_disk_state", currentHash }));
    const next = normalizeMindmap({
      ...map,
      revision: (map.revision ?? 0) + 1,
      nodes: map.nodes.map((node) => node.id === id ? { ...node, collapsed } : node),
    });
    saveMindmap(project, { ...next, diskHash: mindmapDiskHash(next) }, currentHash);
    return text(`Set collapsed=${collapsed} on ${id}.`);
  },
);

server.registerTool(
  "set_mindmap_node_presentation",
  {
    title: "Set mindmap node presentation",
    description: "Update an editable node's content format, maturity, style, or accent with compare-and-swap.",
    inputSchema: {
      project: z.string(),
      id: z.string(),
      contentFormat: z.enum(["plain", "markdown", "tex", "html"]).optional(),
      maturity: z.enum(["empty", "hypothesized", "draft", "review", "final"]).optional(),
      shape: z.enum(["branch", "leaf", "note", "callout"]).optional(),
      color: z.string().max(80).optional(),
      expectedDiskHash: z.string(),
      mapId: z.string().optional(),
    },
  },
  async ({ project, id, contentFormat, maturity, shape, color, expectedDiskHash, mapId }) => {
    const invalid = validateMindmapToolInput(project, mapId);
    if (invalid) return op(failResult("invalid_path", invalid, { retryable: false }));
    if (contentFormat === undefined && maturity === undefined && shape === undefined && color === undefined) {
      return op(failResult("invalid_arguments", "Provide at least one presentation property.", { retryable: false }));
    }
    const map = getMindmap(project, mapId);
    if (!map) return op(failResult("invalid_path", "No mindmap found.", { retryable: false }));
    const node = map.nodes.find((item) => item.id === id);
    if (!node) return op(failResult("invalid_arguments", `Unknown mindmap node "${id}".`, { retryable: false }));
    if (node.id === map.rootId && shape !== undefined) {
      return op(failResult("invalid_arguments", "The root topic keeps the root style.", { retryable: false }));
    }
    const currentHash = mindmapDiskHash(map);
    if (currentHash !== expectedDiskHash) {
      return op(failResult("stale_disk_state", "Mindmap hash does not match.", { retryable: true, currentHash }));
    }
    const next = normalizeMindmap({
      ...map,
      updatedAt: new Date().toISOString(),
      revision: (map.revision ?? 0) + 1,
      nodes: map.nodes.map((item) => item.id !== id ? item : {
        ...item,
        ...(contentFormat === undefined ? {} : { contentFormat }),
        ...(maturity === undefined ? {} : { maturity }),
        ...(shape === undefined ? {} : { shape }),
        ...(color === undefined ? {} : { color: color || undefined }),
      }),
    });
    const diskHash = mindmapDiskHash(next);
    saveMindmap(project, { ...next, diskHash }, currentHash);
    return op(okResult({ id, contentFormat, maturity, shape, color: color || undefined }, { diskHash, revision: next.revision }));
  },
);

server.registerTool(
  "link_mindmap_artifact",
  {
    title: "Link an artifact to a mindmap node",
    inputSchema: {
      project: z.string(),
      id: z.string(),
      kind: z.string(),
      artifactId: z.string(),
      label: z.string().max(240).optional(),
      url: z.string().max(2_000).optional(),
      expectedDiskHash: z.string(),
      mapId: z.string().optional(),
    },
  },
  async ({ project, id, kind, artifactId, label, url, expectedDiskHash, mapId }) => {
    const invalid = validateMindmapToolInput(project, mapId);
    if (invalid) return text(invalid);
    if (!isArtifactKind(kind)) return text(`Unknown artifact kind "${kind}".`);
    if (!artifactId.trim()) return text("Artifact id cannot be empty.");
    const isRemote = kind === "web" || kind === "external";
    const validUrl = (value: string | undefined) => Boolean(value && /^https?:\/\//i.test(value.trim()) && safeUrl(value));
    if (isRemote && !validUrl(artifactId)) return text("Web artifacts require an http(s) artifact id.");
    if (url !== undefined && !validUrl(url)) return text("Artifact url must be an http(s) URL.");
    const map = getMindmap(project, mapId);
    if (!map) return text(`No mindmap found.`);
    if (!map.nodes.some((node) => node.id === id)) return text(`Unknown mindmap node "${id}".`);
    const currentHash = mindmapDiskHash(map);
    if (currentHash !== expectedDiskHash) return text(JSON.stringify({ ok: false, code: "stale_disk_state", currentHash }));
    const next = normalizeMindmap({
      ...map,
      revision: (map.revision ?? 0) + 1,
      nodes: map.nodes.map((node) => {
        if (node.id !== id) return node;
        const refs = [
          ...(node.refs || []).filter((ref) => !(ref.kind === kind && ref.id === artifactId)),
          {
            kind,
            id: artifactId,
            ...(label?.trim() ? { label: label.trim() } : {}),
            ...(url ? { url } : isRemote ? { url: artifactId } : {}),
          },
        ];
        return { ...node, refs };
      }),
    });
    saveMindmap(project, { ...next, diskHash: mindmapDiskHash(next) }, currentHash);
    return text(`Linked ${kind}:${artifactId} to ${id}.`);
  },
);

server.registerTool(
  "project_context",
  {
    title: "Get full project context",
    description:
      "Return the complete research context for a project as markdown: the working " +
      "agreement (guardrails), overview, mindmap outline, every draft with its explicit " +
      "OPEN-ITEMS inventory (what is NOT done), pre-registered experiments, pinned wiki, " +
      "and recent notes. Call this before doing any work on a project so you don't " +
      "mistake a scaffold for a finished result.",
    inputSchema: { project: z.string().describe("project slug, e.g. example-project") },
  },
  async ({ project }) => {
    if (!getProject(project)) return text(`Unknown project "${project}". Call list_projects first.`);
    const md = renderContextMarkdown(project);
    if (!md) return text(`Unknown project "${project}". Call list_projects first.`);
    return text(md);
  },
);

server.registerTool(
  "draft_status",
  {
    title: "Draft maturity & open items",
    description:
      "For one draft, return its maturity, completion %, marker counts, and the full " +
      "list of open items (empty sections, TODOs, unverified claims, missing figures, unresolved " +
      "citations). Use this to know exactly what remains before anything can be called done.",
    inputSchema: {
      project: z.string(),
      draft: z.string().optional().describe("draft slug; omit to list drafts"),
    },
  },
  async ({ project, draft }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    if (!draft) {
      const drafts = listDrafts(project);
      return text(
        drafts.length
          ? `Drafts in ${project}:\n${drafts.map((d) => `- ${d}`).join("\n")}`
          : `No drafts in ${project}.`,
      );
    }
    const doc = getDraft(project, draft);
    if (!doc) return text(`Unknown draft "${draft}" in ${project}.`);
    const a = analyzeDraft(doc.source);
    const counts = Object.entries(a.markerCounts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}: ${n}`)
      .join(", ");
    const items = a.openItems.length
      ? a.openItems.map((o) => `- [${o.kind}] (${o.section}) ${o.text}`).join("\n")
      : "_none detected — still verify before claiming done_";
    return text(
      `# ${doc.title}\n\n**Maturity:** ${a.overallMaturity} · **Completion:** ${Math.round(
        a.completion * 100,
      )}%\n**Markers:** ${counts || "none"}\n\n## Open items (unfinished by definition)\n${items}`,
    );
  },
);

server.registerTool(
  "check_claim_readiness",
  {
    title: "Check whether work can be called done",
    description:
      "Before you report a draft/experiment as finished, call this. It returns a verdict " +
      "and the blocking open items. Use it to avoid the classic failure of claiming " +
      "completion while scaffolds, unverified claims, or TODOs remain.",
    inputSchema: { project: z.string(), draft: z.string() },
  },
  async ({ project, draft }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const doc = getDraft(project, draft);
    if (!doc) return text(`Unknown draft "${draft}" in ${project}.`);
    const a = analyzeDraft(doc.source);
    const blocking = a.openItems;
    if (blocking.length === 0 && a.overallMaturity === "final") {
      return text(
        `✅ "${doc.title}" is marked final with no open items. You may describe it as complete — but still cite the evidence for each claim.`,
      );
    }
    return text(
      `🚫 Do NOT claim "${doc.title}" is done.\n\nMaturity: ${a.overallMaturity} (${Math.round(
        a.completion * 100,
      )}%). ${blocking.length} open item(s) block completion:\n\n${blocking
        .map((o) => `- [${o.kind}] (${o.section}) ${o.text}`)
        .join(
          "\n",
        )}\n\nResolve these with real evidence, or leave the markers in place and report the work as still maturing.`,
    );
  },
);

server.registerTool(
  "append_daily_note",
  {
    title: "Append to today's daily note",
    description:
      "Record progress in the project's daily lab notebook (process narration belongs " +
      "here, NOT in the draft). Appends to today's note, creating it if needed.",
    inputSchema: {
      project: z.string(),
      did: z.array(z.string()).optional().describe("what was done"),
      next: z.array(z.string()).optional().describe("planned next steps"),
      blockers: z.array(z.string()).optional(),
      body: z.string().optional().describe("free-form markdown/LaTeX"),
    },
  },
  async ({ project, did, next, blockers, body }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const date = new Date().toISOString().slice(0, 10);
    const existing = getNote(project, date);
    saveNote({
      projectId: project,
      date,
      body: [existing?.body, body].filter(Boolean).join("\n\n"),
      did: [...(existing?.did || []), ...(did || [])],
      next: [...(existing?.next || []), ...(next || [])],
      blockers: [...(existing?.blockers || []), ...(blockers || [])],
      refs: existing?.refs || [],
      updatedAt: new Date().toISOString(),
    });
    return text(`Appended to ${project} daily note ${date}.`);
  },
);

server.registerTool(
  "upsert_wiki_page",
  {
    title: "Update an LLM Wiki page",
    description:
      "Create or replace a project wiki page from inspected sources. Use this as the agent-maintained LLM Wiki path: compile raw sources into durable Markdown pages, link source refs, note contradictions, and pin pages that future agents should always read.",
    inputSchema: {
      project: z.string(),
      page: z.string().describe("wiki page slug, e.g. threat-model or raw-artifact-map"),
      title: z.string(),
      summary: z.string().describe("one-line summary used in search and agent context"),
      body: z.string().describe("Markdown + LaTeX body. Keep source links and why-chain visible."),
      tags: z.array(z.string()).optional(),
      sourceRefIds: z.array(z.string()).optional().describe("source manifest ids used to create or update this page"),
      pinnedForAgents: z.boolean().optional(),
    },
  },
  async ({ project, page, title, summary, body, tags, sourceRefIds, pinnedForAgents }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const manifestRefs = listSourceManifest(project).filter((entry) => sourceRefIds?.includes(entry.id));
    if (pinnedForAgents === true && manifestRefs.length === 0) {
      return text("Refusing to pin wiki page without valid source refs. Record a source ref first, or leave pinnedForAgents false.");
    }
    const shouldPin = pinnedForAgents ?? manifestRefs.length > 0;
    saveWikiPage({
      projectId: project,
      slug: page,
      title,
      summary,
      body,
      tags: tags || [],
      refs: manifestRefs.map((entry) => ({
        kind: "external",
        id: entry.id,
        label: entry.label,
        url: /^https?:\/\//.test(entry.uri) ? entry.uri : undefined,
      })),
      pinnedForAgents: shouldPin,
      createdAt: getWikiPage(project, page)?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return text(`Updated wiki/${page} for ${project}. ${shouldPin ? "Pinned for future agents." : "Not pinned because no source refs were supplied."}`);
  },
);

server.registerTool(
  "ingest_source_note",
  {
    title: "Ingest a source into the LLM Wiki",
    description:
      "Append a source-grounded update to one or more LLM Wiki pages, append the project wiki log, and regenerate the wiki index. Use this after inspecting a primary source such as a W&B table, GPU log, Overleaf file, Drive doc, repo file, or chat export.",
    inputSchema: {
      project: z.string(),
      sourceRefId: z.string(),
      summary: z.string().describe("What the source changes or clarifies. Keep the why-chain visible."),
      affectedPages: z.array(z.string()).describe("Wiki page slugs to update, e.g. overview, artifact-map, central-claim"),
      contradictions: z.array(z.string()).optional(),
      questionsForTeam: z.array(z.string()).optional().describe("Questions for the research team, collaborators, or advisors."),
      questionsForBarry: z.array(z.string()).optional().describe("Legacy alias for questionsForTeam."),
      tags: z.array(z.string()).optional(),
    },
  },
  async ({ project, sourceRefId, summary, affectedPages, contradictions, questionsForTeam, questionsForBarry, tags }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const sourceRef = listSourceManifest(project).find((entry) => entry.id === sourceRefId);
    if (!sourceRef) return text(`Unknown source ref "${sourceRefId}" in ${project}. Call source_manifest first.`);
    const pages = affectedPages.length ? affectedPages : ["overview"];
    const block = sourceUpdateBlock({ sourceId: sourceRefId, summary, contradictions, questionsForTeam: questionsForTeam || questionsForBarry });
    for (const page of pages) {
      appendWikiPage({
        project,
        page,
        title: page.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "),
        summary: `Compiled source notes for ${page}.`,
        body: block,
        sourceRef,
        tags,
      });
    }
    appendWikiPage({
      project,
      page: "log",
      title: "LLM Wiki Log",
      summary: "Chronological source ingestion log.",
      body: block,
      sourceRef,
      tags: ["log", ...(tags || [])],
    });
    regenerateWikiIndex(project);
    return text(`Ingested source "${sourceRefId}" into wiki pages: ${pages.join(", ")}. Updated wiki/log and wiki/index.`);
  },
);

server.registerTool(
  "lint_wiki",
  {
    title: "Lint LLM Wiki source backing",
    description:
      "Check a project's LLM Wiki for broken wiki links, pinned pages without source refs, and source manifest/page reference mismatches.",
    inputSchema: { project: z.string() },
  },
  async ({ project }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const findings = lintWikiProject(project);
    if (!findings.length) return text(`✅ LLM Wiki for ${project} has no broken links or source-ref mismatches detected.`);
    return text(`🚫 LLM Wiki findings for ${project}:\n\n${findings.map((finding) => `- ${finding}`).join("\n")}`);
  },
);

server.registerTool(
  "add_mindmap_node",
  {
    title: "Add an editable mindmap node",
    description:
      "Add an idea, question, or next step to the editable project-planning canvas. This does not " +
      "create a paper claim or resolve a draft TODO; use add_claim/add_todo for manuscript state.",
    inputSchema: {
      project: z.string(),
      text: z.string().describe("the idea / question / next step to capture"),
      parentId: z.string().optional().describe("parent topic id; defaults to the map root"),
      mapId: z.string().optional().describe("mindmap id; defaults to the paper-linked draft map"),
      maturity: z.enum(["empty", "hypothesized", "draft", "review", "final"]).optional(),
    },
  },
  async ({ project, text: nodeText, parentId, mapId, maturity }) => {
    const invalid = validateMindmapToolInput(project, mapId);
    if (invalid) return text(invalid);
    const map = getMindmap(project, mapId);
    if (!map) return text(`No editable mindmap found for "${project}"${mapId ? ` (${mapId})` : ""}. Open the Mindmap tab once to seed one.`);
    const parent = parentId || map.rootId;
    if (!map.nodes.some((node) => node.id === parent)) return text(`Mindmap parent "${parent}" was not found.`);
    const body = nodeText.trim();
    if (!body) return text("Mindmap node text cannot be empty.");
    const currentHash = mindmapDiskHash(map);
    const siblingOrders = map.nodes.filter((node) => node.parentId === parent).map((node) => node.order ?? 0);
    const id = shortId("node");
    saveMindmap(project, {
      ...map,
      updatedAt: new Date().toISOString(),
      nodes: [
        ...map.nodes,
        {
          id,
          text: body,
          parentId: parent,
          shape: "leaf",
          ...(maturity ? { maturity } : {}),
          order: siblingOrders.length ? Math.max(...siblingOrders) + 1 : 0,
          createdAt: new Date().toISOString(),
        },
      ],
    }, currentHash);
    return text(`Added mindmap/${id} under ${parent}. This is a planning node only; draft claim/evidence state is unchanged.`);
  },
);

server.registerTool(
  "get_skill",
  {
    title: "Get a research working skill",
    description:
      "Fetch one of the bundled research skills to adopt its behavior: anti-sycophancy, " +
      "lean-research-coder, rigorous-researcher, maturation-writing, status-report, " +
      "grill-me, fresh-eyes-review. Call with no id to list them.",
    inputSchema: { id: z.string().optional() },
  },
  async ({ id }) => {
    if (!id) {
      return text(
        `Available skills:\n${SKILLS.map((s) => `- **${s.id}** — ${s.title}. ${s.when}`).join("\n")}\n\nPrefer read_project_skill when a project lists local skills in get_project_state.`,
      );
    }
    const skill = getSkill(id);
    if (!skill) return text(`Unknown skill "${id}".`);
    return text(`# ${skill.title}\n\n_${skill.when}_\n\n${skill.body}\n\n— ${skill.source}`);
  },
);

server.registerTool(
  "research_methodology",
  {
    title: "Load research working principles",
    description:
      "Return the distilled principles for how good research happens — from Hamming " +
      "(important problems, attack), Christiano (propose→find failure story→fix), Nanda " +
      "(process stages, prediction, post-mortem), Carlini (one idea, de-risk early, " +
      "preempt objections), Muehlhauser (reasoning transparency: summary-first, mark " +
      "load-bearing evidence, calibrated confidence, source every claim, open questions), " +
      "and the measurement-validity essay (you are not measuring what you think). Honor " +
      "these when doing research work.",
    inputSchema: {},
  },
  async () => text(methodologyDigest()),
);

server.registerTool(
  "source_grounding",
  {
    title: "Load source grounding for OpenBarry principles",
    description:
      "Return the named sources behind OpenBarry's research principles, why each source matters, and how it should shape agent and product behavior. Call before changing research workflow or platform design.",
    inputSchema: {},
  },
  async () => text(sourceGroundingMarkdown()),
);

server.registerTool(
  "content_diagnostics",
  {
    title: "List content validation diagnostics",
    description:
      "Return content files that failed runtime validation while loading projects, claims, evidence, source manifests, or other validated content.",
    inputSchema: {},
  },
  async () => {
    const diagnostics = listContentDiagnostics();
    if (!diagnostics.length) return text("✅ No content validation diagnostics recorded in this server process.");
    return text(`# Content diagnostics\n\n${diagnostics.map((item) => `- ${item.file}: ${item.issue}`).join("\n")}`);
  },
);

server.registerTool(
  "llm_wiki_protocol",
  {
    title: "Load LLM Wiki maintenance protocol",
    description:
      "Return the practical protocol for maintaining OpenBarry's Karpathy-style LLM Wiki: page types, source-ref rules, link style, stale-claim handling, and required agent behavior.",
    inputSchema: {},
  },
  async () => text(LLM_WIKI_PROTOCOL),
);

server.registerTool(
  "lint_draft",
  {
    title: "Lint a draft for transparency & rigor",
    description:
      "Check a draft against the reasoning-transparency and measurement-validity rubric: " +
      "missing takeaways summary, claims without pointable support, metrics with no " +
      "validity note, no confidence signals, missing open-questions/limitations, no " +
      "failure story, unaddressed reviewer objections. Returns a transparency score and " +
      "actionable findings. Run this before reporting a draft as improved or done.",
    inputSchema: { project: z.string(), draft: z.string() },
  },
  async ({ project, draft }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const doc = getDraft(project, draft);
    if (!doc) return text(`Unknown draft "${draft}" in ${project}.`);
    const { score, lints, counts } = transparencyScore(doc.source);
    if (!lints.length)
      return text(
        `# ${doc.title} — transparency ${Math.round(score * 100)}%\n\nNo transparency lints. Still verify claims have real evidence.`,
      );
    const body = lints
      .map(
        (l) =>
          `- **[${l.severity}] ${l.title}**${l.section ? ` (${l.section})` : ""}\n  ${l.detail}`,
      )
      .join("\n");
    return text(
      `# ${doc.title} — transparency ${Math.round(
        score * 100,
      )}%\n${counts.blocker} blocker · ${counts.warn} warn · ${counts.nudge} nudge\n\n${body}`,
    );
  },
);

server.registerTool(
  "search",
  {
    title: "Search project content",
    description:
      "Full-text search across a project's wiki, drafts, and mindmap for a query string.",
    inputSchema: { project: z.string(), query: z.string() },
  },
  async ({ project, query }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const q = query.toLowerCase();
    const hits: string[] = [];
    for (const w of listWiki(project)) {
      if ((w.title + w.summary + w.body).toLowerCase().includes(q))
        hits.push(`- wiki/${w.slug}: ${w.title}`);
    }
    for (const d of listDrafts(project)) {
      const doc = getDraft(project, d);
      if (doc && doc.source.toLowerCase().includes(q))
        hits.push(`- draft/${d}: ${doc.title}`);
    }
    for (const n of listNotes(project)) {
      if ([n.date, n.body, ...(n.did || []), ...(n.next || []), ...(n.blockers || [])].join(" ").toLowerCase().includes(q))
        hits.push(`- note/${n.date}`);
    }
    for (const pr of listPreregs(project)) {
      if ([pr.title, pr.question, pr.motivation, pr.prediction.text, pr.prediction.expected, pr.method, pr.decisionRule || ""].join(" ").toLowerCase().includes(q))
        hits.push(`- prereg/${pr.id}: ${pr.title}`);
    }
    for (const claim of listClaims(project)) {
      if ([claim.id, claim.title, claim.claim, claim.scope || "", claim.currentWeakness || "", claim.nextAction || ""].join(" ").toLowerCase().includes(q))
        hits.push(`- claim/${claim.id}: ${claim.title}`);
    }
    for (const item of listEvidence(project)) {
      if ([item.id, item.title, item.source, item.summary, item.limitations || "", ...(item.excerpts || [])].join(" ").toLowerCase().includes(q))
        hits.push(`- evidence/${item.id}: ${item.title}`);
    }
    for (const source of listSourceManifest(project)) {
      if ([source.id, source.label, source.uri, source.selectedExcerpt || "", source.notes || "", ...(source.tags || [])].join(" ").toLowerCase().includes(q))
        hits.push(`- source/${source.id}: ${source.label}`);
    }
    for (const challenge of listChallenges(project)) {
      if ([challenge.id, challenge.type, challenge.question, challenge.whyNow, challenge.expectedArtifact, challenge.recommendedAnswer || ""].join(" ").toLowerCase().includes(q))
        hits.push(`- challenge/${challenge.id}: ${challenge.question}`);
    }
    for (const review of listMonthlyReviews(project)) {
      if ([review.month, review.discussionAsk || "", review.taste, review.evidence, review.paper, review.momentum, ...review.decisions, ...review.nextBets].join(" ").toLowerCase().includes(q))
        hits.push(`- monthly/${review.month}`);
    }
    const mm = getMindmap(project);
    for (const n of mm?.nodes || []) {
      if (n.text.toLowerCase().includes(q))
        hits.push(`- mindmap/${n.id}: ${n.text.split("\n")[0]}`);
    }
    return text(hits.length ? `Matches for "${query}":\n${hits.join("\n")}` : `No matches for "${query}".`);
  },
);

server.registerTool(
  "get_project_state",
  {
    title: "Read project state",
    description:
      "Read this first when entering an OpenBar project or after losing context. Returns the manuscript outline, open paper TODOs, available mindmaps, recent project activity, and project-local skills. Does not modify files.",
    inputSchema: { project: z.string() },
  },
  async ({ project }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    return text(JSON.stringify(getProjectState(project), null, 2));
  },
);

server.registerTool(
  "search_project",
  {
    title: "Search the project",
    description:
      "Search paper headings, TeX source, TODO and comment text, mindmap nodes, and wiki notes. Returns ids and hrefs for navigation.",
    inputSchema: { project: z.string(), query: z.string() },
  },
  async ({ project, query }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    return text(JSON.stringify({ results: searchProject(project, query) }, null, 2));
  },
);

server.registerTool(
  "read_project_skill",
  {
    title: "Read a project skill",
    description: "Read a project-local SKILL.md or bundled OpenBar skill by id from get_project_state.",
    inputSchema: { project: z.string().optional(), id: z.string() },
  },
  async ({ project, id }) => {
    if (project) {
      const local = readSkillFile(projectContentDir(project), id);
      if (local) return text(`# ${local.skill.name}\n\n${local.body}`);
    }
    const bundled = readBundledSkill(id);
    if (bundled) return text(`# ${bundled.skill.name}\n\n${bundled.body}`);
    const available = [
      ...(project ? discoverSkillsInDir(projectContentDir(project)) : []),
    ].map((skill) => skill.id);
    return text(`Unknown skill "${id}".${available.length ? ` Project skills: ${available.join(", ")}.` : ""}`);
  },
);

server.registerTool(
  "claim_status",
  {
    title: "List claim state",
    description:
      "Return the project's claims parsed from the draft (\\obclaim anchors) with purpose evaluation, " +
      "section, current weakness, and next action. A stored state= tag is a display hint, not readiness. " +
      "The draft is the single source of truth. Use this before writing paper-like prose.",
    inputSchema: { project: z.string(), claimId: z.string().optional() },
  },
  async ({ project, claimId }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const graph = buildProjectPaperGraph(project);
    const claims = claimId ? graph.claims.filter((c) => c.id === claimId) : graph.claims;
    if (!claims.length) return text(`No claims found in the draft for "${project}"${claimId ? ` (id "${claimId}")` : ""}. Add one with add_claim.`);
    return text(
      `# Claims (from draft): ${project}\n\n${claims
        .map((claim) => {
          const evaluation = evaluateClaimForPurpose(asEvaluableClaim(claim), "paper-synthesis");
          return (
            `- **${claim.id}** (${evaluation.assessment} for ${evaluation.purpose}${claim.section ? `, ${claim.section}` : ""}${claim.state ? `; hint ${claim.state}` : ""})\n` +
            `  ${claim.text}\n` +
            `  weakness: ${claim.weakness || "none recorded"}\n` +
            `  next: ${claim.next || "none recorded"}\n` +
            `  in draft at ${claim.source}:${claim.line}`
          );
        })
        .join("\n")}`,
    );
  },
);

server.registerTool(
  "list_evidence",
  {
    title: "List evidence receipts",
    description:
      "Return the project's evidence parsed from the draft (\\obevidence anchors): summary, linked " +
      "claims, raw-sample count, and raw-inspection status. The draft is the single source of truth.",
    inputSchema: { project: z.string(), claimId: z.string().optional() },
  },
  async ({ project, claimId }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const graph = buildProjectPaperGraph(project);
    const evidence = graph.evidence.filter((item) => !claimId || item.claimIds.includes(claimId));
    if (!evidence.length) return text(`No evidence anchors found in the draft for "${project}"${claimId ? ` claim "${claimId}"` : ""}.`);
    return text(
      `# Evidence (from draft): ${project}\n\n${evidence
        .map((item) => {
          const inspected = (item.sampleCount ?? 0) >= 10;
          return (
            `- **${item.id}** (${inspected ? "raw-inspected" : "needs raw inspection"})\n` +
            `  ${item.summary}\n` +
            `  claims: ${item.claimIds.length ? item.claimIds.join(", ") : "unlinked"}\n` +
            `  samples: ${item.sampleCount ?? 0}\n` +
            `  limits: ${item.limitations || "none recorded"}`
          );
        })
        .join("\n")}`,
    );
  },
);

server.registerTool(
  "source_manifest",
  {
    title: "List source refs",
    description:
      "List source-manifest entries for a project. These are lightweight pointers to primary sources such as W&B tables, GPU logs, Overleaf files, Drive docs, repo artifacts, chat exports, and local files.",
    inputSchema: { project: z.string() },
  },
  async ({ project }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const entries = listSourceManifest(project);
    if (!entries.length) return text(`No source refs recorded for "${project}".`);
    return text(
      `# Source manifest: ${project}\n\n${entries
        .map(
          (entry) =>
            `- **${entry.id} — ${entry.label}** (${entry.kind})\n` +
            `  uri: ${entry.uri}\n` +
            `  hash: ${entry.sha256 || "not recorded"}\n` +
            `  excerpt: ${clipText(entry.selectedExcerpt) || "not recorded"}\n` +
            `  anchors: ${entry.anchors?.map((anchor) => `${anchor.label || anchor.selector}${anchor.excerpt ? `=${clipText(anchor.excerpt, 240)}` : ""}`).join(" | ") || "none"}\n` +
            `  linked wiki: ${entry.linkedWikiPages?.join(", ") || "none"}\n` +
            `  linked claims: ${entry.linkedClaimIds?.join(", ") || "none"}\n` +
            `  notes: ${entry.notes || "none"}`,
        )
        .join("\n")}`,
    );
  },
);


server.registerTool(
  "resolve_source",
  {
    title: "Resolve source ref",
    description:
      "Resolve a source manifest entry into a typed locator and inspection instructions. Use before reading Overleaf, W&B, Drive, Google Docs, Slides, or local artifacts.",
    inputSchema: { project: z.string(), sourceRefId: z.string() },
  },
  async ({ project, sourceRefId }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const entry = listSourceManifest(project).find((item) => item.id === sourceRefId);
    if (!entry) return text(`Unknown source ref "${sourceRefId}" in ${project}.`);
    return text(renderResolvedSourceMarkdown(resolveSourceLocator(entry)));
  },
);

server.registerTool(
  "record_external_source",
  {
    title: "Record external source locator",
    description:
      "Record a source ref for Overleaf, W&B, Google Docs, Google Slides, Drive, GitHub, or external URLs with typed locator metadata. This stores pointers, excerpts, and anchors, not copied artifacts.",
    inputSchema: {
      project: z.string(),
      id: z.string(),
      kind: z.enum(["github", "wandb", "remote", "google-doc", "google-slide", "overleaf", "external", "drive", "chat-export"]),
      label: z.string(),
      uri: z.string(),
      locator: z.record(z.unknown()).optional(),
      selectedExcerpt: z.string().max(4000).optional(),
      anchors: z.array(z.object({ label: z.string().optional(), selector: z.string(), excerpt: z.string().max(4000).optional() }).strict()).optional(),
      tags: z.array(z.string()).optional(),
      linkedWikiPages: z.array(z.string()).optional(),
      linkedClaimIds: z.array(z.string()).optional(),
      notes: z.string().optional(),
    },
  },
  async ({ project, id, kind, label, uri, locator, selectedExcerpt, anchors, tags, linkedWikiPages, linkedClaimIds, notes }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    saveSourceManifestEntry(project, {
      projectId: project,
      id,
      kind,
      label,
      uri,
      fetchedAt: new Date().toISOString(),
      selectedExcerpt,
      anchors,
      metadata: locator ? { locator } : undefined,
      tags,
      linkedWikiPages,
      linkedClaimIds,
      notes,
    });
    return text(`Recorded external source "${id}" for ${project}. ${locator ? "Typed locator saved." : "Add locator metadata when available."}`);
  },
);

server.registerTool(
  "record_source_ref",
  {
    title: "Record a source ref",
    description:
      "Record a lightweight pointer to a primary source. Keep experiment dashboards, compute logs, manuscript text, shared documents, and repository artifacts in their source systems while OpenBar stores the link.",
    inputSchema: {
      project: z.string(),
      id: z.string(),
      kind: z.enum(["github", "wandb", "local", "remote", "google-doc", "google-slide", "overleaf", "codex-memory", "slack", "external", "drive", "chat-export"]),
      label: z.string(),
      uri: z.string(),
      sha256: z.string().optional(),
      sizeBytes: nonnegativeIntegerSchema.optional(),
      mtime: isoDateTimeSchema.optional(),
      selectedExcerpt: z.string().optional(),
      anchors: z.array(z.object({
        label: z.string().optional(),
        selector: z.string(),
        excerpt: z.string().optional(),
      }).strict()).optional(),
      metadata: z.record(z.unknown()).optional(),
      tags: z.array(z.string()).optional(),
      linkedWikiPages: z.array(z.string()).optional(),
      linkedClaimIds: z.array(z.string()).optional(),
      notes: z.string().optional(),
    },
  },
  async ({ project, id, kind, label, uri, sha256, sizeBytes, mtime, selectedExcerpt, anchors, metadata, tags, linkedWikiPages, linkedClaimIds, notes }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    saveSourceManifestEntry(project, {
      projectId: project,
      id,
      kind,
      label,
      uri,
      sha256,
      sizeBytes,
      mtime,
      fetchedAt: new Date().toISOString(),
      selectedExcerpt,
      anchors,
      metadata,
      tags,
      linkedWikiPages,
      linkedClaimIds,
      notes,
    });
    return text(`Recorded source ref "${id}" for ${project}. Keep the source artifact at ${uri}.`);
  },
);

server.registerTool(
  "record_local_file_source",
  {
    title: "Record a local file source with hash",
    description:
      "Record a local source file such as a GPU log, W&B export, Overleaf Git mirror file, repo artifact, result JSON, or table. Computes size, mtime, sha256, and an optional small excerpt without copying the full artifact.",
    inputSchema: {
      project: z.string(),
      filePath: z.string(),
      id: z.string().optional(),
      label: z.string().optional(),
      tags: z.array(z.string()).optional(),
      linkedWikiPages: z.array(z.string()).optional(),
      linkedClaimIds: z.array(z.string()).optional(),
      excerptStartLine: z.number().optional(),
      excerptLineCount: z.number().optional(),
      notes: z.string().optional(),
    },
  },
  async ({ project, filePath, id, label, tags, linkedWikiPages, linkedClaimIds, excerptStartLine, excerptLineCount, notes }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const result = localSourceEntry({
      project,
      filePath,
      id,
      label,
      tags,
      linkedWikiPages,
      linkedClaimIds,
      excerptStartLine,
      excerptLineCount,
      notes,
    });
    if (result.error || !result.entry) return text(result.error || `Could not register ${filePath}.`);
    saveSourceManifestEntry(project, result.entry);
    return text(`Recorded local source "${result.entry.id}" for ${project}. sha256=${result.entry.sha256}`);
  },
);

server.registerTool(
  "scan_current_project_draft",
  {
    title: "Scan the current project paper",
    description:
      "Scan this OpenBar project's primary paper draft for claims, evidence, comments, and TODOs. " +
      "Accepts only project and draft identifiers — never a filesystem path.",
    inputSchema: {
      project: z.string(),
      draft: z.string().optional().describe("Draft slug. Defaults to paper."),
      maxHits: z.number().optional().describe("Maximum hits to print. Defaults to 60."),
    },
  },
  async ({ project, draft, maxHits }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const draftSlug = draft || "paper";
    const doc = getDraft(project, draftSlug);
    if (!doc) return text(`Unknown draft "${draftSlug}" in ${project}.`);
    return text(renderPaperSourceScanMarkdown(scanPaperSource({ label: `${project}/drafts/${draftSlug}`, source: doc.source }), maxHits));
  },
);

server.registerTool(
  "scan_paper_source",
  {
    title: "Scan paper source for claims and evidence",
    description:
      "Read a local LaTeX/Markdown paper source, source-manifest entry, or OpenBarry draft and report claim, evidence, raw-artifact, source, question, and TODO markers with line numbers. Use this to derive work from source artifacts instead of asking a researcher to duplicate content into web cards.",
    inputSchema: {
      project: z.string(),
      filePath: z.string().optional().describe("Local .tex/.md path to scan."),
      sourceRefId: z.string().optional().describe("Source manifest id whose local URI should be scanned."),
      draft: z.string().optional().describe("OpenBarry draft slug to scan."),
      maxHits: z.number().optional().describe("Maximum hits to print. Defaults to 60."),
    },
  },
  async ({ project, filePath, sourceRefId, draft, maxHits }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const modes = [filePath, sourceRefId, draft].filter(Boolean).length;
    if (modes !== 1) {
      return text("Provide exactly one of filePath, sourceRefId, or draft.");
    }

    if (draft) {
      const doc = getDraft(project, draft);
      if (!doc) return text(`Unknown draft "${draft}" in ${project}.`);
      return text(renderPaperSourceScanMarkdown(scanPaperSource({ label: `${project}/drafts/${draft}`, source: doc.source }), maxHits));
    }

    let targetPath = filePath;
    let label = filePath || "paper source";
    if (sourceRefId) {
      const sourceRef = listSourceManifest(project).find((entry) => entry.id === sourceRefId);
      if (!sourceRef) return text(`Unknown source ref "${sourceRefId}" in ${project}.`);
      targetPath = sourceRef.uri;
      label = `${sourceRef.id} — ${sourceRef.label}`;
    }

    if (!targetPath) return text("No paper source path resolved.");
    const safePath = resolveAllowedPath(targetPath);
    if (!safePath) {
      return text(`Access denied: path "${targetPath}" is outside allowed content/workspace roots.`);
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(safePath);
    } catch {
      return text(`File not found: ${targetPath}`);
    }
    if (!stat.isFile()) return text(`Path is not a file: ${targetPath}`);
    if (stat.size > 2_000_000) {
      return text(`File is ${stat.size} bytes. Register a selected excerpt or scan a narrower paper source file.`);
    }
    const source = fs.readFileSync(safePath, "utf8");
    return text(renderPaperSourceScanMarkdown(scanPaperSource({ label, filePath: safePath, source }), maxHits));
  },
);

server.registerTool(
  "record_evidence_receipt",
  {
    title: "Record an evidence receipt",
    description:
      "Write a source-backed evidence receipt and link it to existing claim cards. Use this after inspecting LaTeX, W&B exports, GPU logs, raw examples, or repo artifacts. This is the MCP path for agents to fill evidence from primary sources.",
    inputSchema: {
      project: z.string(),
      id: z.string(),
      title: z.string(),
      sourceKind: evidenceSourceKindSchema,
      source: z.string().describe("Primary source URI/path or source manifest id."),
      summary: z.string(),
      claimIds: z.array(z.string()).default([]),
      rawInputRefs: z.array(artifactRefSchema).optional(),
      intermediateRefs: z.array(artifactRefSchema).optional(),
      outputRefs: z.array(artifactRefSchema).optional(),
      metricRefs: z.array(artifactRefSchema).optional(),
      excerpts: z.array(z.string()).optional(),
      sampleCount: nonnegativeIntegerSchema.optional(),
      reviewer: z.string().optional(),
      reviewedAt: isoDateTimeSchema.optional(),
      verdict: z.enum(["supports", "weakens", "mixed", "inconclusive"]).optional(),
      limitations: z.string().optional(),
      refs: z.array(artifactRefSchema).optional(),
      overwrite: z.boolean().optional(),
    },
  },
  async ({ project, id, title, sourceKind, source, summary, claimIds, rawInputRefs, intermediateRefs, outputRefs, metricRefs, excerpts, sampleCount, reviewer, reviewedAt, verdict, limitations, refs, overwrite }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const missingClaims = claimIds.filter((claimId) => !getClaim(project, claimId));
    if (missingClaims.length) return text(`Unknown claim id(s): ${missingClaims.join(", ")}.`);
    const existing = listEvidence(project).find((item) => item.id === id);
    if (existing && !overwrite) return text(`Evidence receipt "${id}" already exists. Pass overwrite=true to replace it.`);
    if (!evidenceSourceExists(project, source)) {
      return text(`Evidence source must be an existing source manifest id or local file path: ${source}`);
    }
    if (reviewedAt) {
      const parsedReviewedAt = isoDateTimeSchema.safeParse(reviewedAt);
      if (!parsedReviewedAt.success) return text(`reviewedAt must be an ISO datetime with timezone, e.g. 2026-07-04T00:00:00.000Z.`);
    }
    const allRefs = [
      ...(rawInputRefs || []),
      ...(intermediateRefs || []),
      ...(outputRefs || []),
      ...(metricRefs || []),
      ...(refs || []),
    ];
    const missingRefs = refsExist(project, allRefs);
    if (missingRefs.length) return text(`Unknown external source ref id(s): ${Array.from(new Set(missingRefs)).join(", ")}.`);
    const receipt: EvidenceReceipt = {
      projectId: project,
      id,
      title,
      sourceKind,
      source,
      summary,
      claimIds,
      rawInputRefs: rawInputRefs || [],
      intermediateRefs: intermediateRefs || [],
      outputRefs: outputRefs || [],
      metricRefs: metricRefs || [],
      excerpts: excerpts || [],
      sampleCount,
      reviewer,
      reviewedAt,
      verdict,
      limitations,
      refs: refs || [],
      updatedAt: new Date().toISOString(),
    };
    saveEvidence(receipt);
    refreshEvidenceClaimLinks(project, id, claimIds);
    const readiness = isReadyEvidenceReceipt(receipt)
      ? "This receipt passes the single-receipt evidence readiness shape."
      : "This receipt is saved as evidence, but it does not pass paper-readiness by itself.";
    return text(`Recorded evidence receipt "${id}" for ${project}. ${readiness}`);
  },
);

server.registerTool(
  "record_source_pack",
  {
    title: "Record a source pack",
    description:
      "Register a small bundle of primary local files, then write one evidence receipt linking those source refs. Use for a LaTeX anchor plus W&B export plus GPU log/raw examples without custom storage.",
    inputSchema: {
      project: z.string(),
      evidenceId: z.string(),
      title: z.string(),
      summary: z.string(),
      claimIds: z.array(z.string()).default([]),
      sourceKind: evidenceSourceKindSchema.default("local"),
      source: z.string().optional().describe("Main primary source URI/path. Defaults to first registered source id."),
      sources: z.array(z.object({
        role: sourceRoleSchema,
        filePath: z.string(),
        id: z.string().optional(),
        label: z.string().optional(),
        excerptStartLine: z.number().optional(),
        excerptLineCount: z.number().optional(),
        tags: z.array(z.string()).optional(),
        notes: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      })).min(1),
      sampleCount: nonnegativeIntegerSchema.optional(),
      reviewer: z.string().optional(),
      reviewedAt: isoDateTimeSchema.optional(),
      verdict: z.enum(["supports", "weakens", "mixed", "inconclusive"]).optional(),
      limitations: z.string().optional(),
      linkedWikiPages: z.array(z.string()).optional(),
      overwrite: z.boolean().optional(),
    },
  },
  async ({ project, evidenceId, title, summary, claimIds, sourceKind, source, sources, sampleCount, reviewer, reviewedAt, verdict, limitations, linkedWikiPages, overwrite }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const missingClaims = claimIds.filter((claimId) => !getClaim(project, claimId));
    if (missingClaims.length) return text(`Unknown claim id(s): ${missingClaims.join(", ")}.`);
    if (listEvidence(project).some((item) => item.id === evidenceId) && !overwrite) {
      return text(`Evidence receipt "${evidenceId}" already exists. Pass overwrite=true to replace it.`);
    }
    if (reviewedAt) {
      const parsedReviewedAt = isoDateTimeSchema.safeParse(reviewedAt);
      if (!parsedReviewedAt.success) return text(`reviewedAt must be an ISO datetime with timezone, e.g. 2026-07-04T00:00:00.000Z.`);
    }

    const entries: { role: z.infer<typeof sourceRoleSchema>; entry: SourceManifestEntry }[] = [];
    const existingSourceIds = sourceRefIdsFor(project);
    const nextSourceIds = new Set<string>();
    for (const item of sources) {
      const sourceId = item.id || `${evidenceId}-${item.role}-${entries.length + 1}`;
      if (existingSourceIds.has(sourceId) && !overwrite) {
        return text(`Source ref "${sourceId}" already exists. Pass overwrite=true to replace it.`);
      }
      if (nextSourceIds.has(sourceId)) return text(`Duplicate source ref id in source pack: ${sourceId}.`);
      nextSourceIds.add(sourceId);
      const result = localSourceEntry({
        project,
        filePath: item.filePath,
        id: sourceId,
        label: item.label || sourceId,
        tags: Array.from(new Set([item.role, "source-pack", ...(item.tags || [])])),
        linkedWikiPages: linkedWikiPages || listWiki(project).filter((page) => page.slug === "artifact-map" || page.slug === "evidence").map((page) => page.slug),
        linkedClaimIds: claimIds,
        excerptStartLine: item.excerptStartLine,
        excerptLineCount: item.excerptLineCount,
        notes: item.notes,
        metadata: {
          ...(item.metadata || {}),
          locator: {
            role: item.role,
            filePath: item.filePath,
            lineRange: item.excerptStartLine
              ? {
                  start: item.excerptStartLine,
                  count: item.excerptLineCount || 20,
                }
              : undefined,
          },
        },
      });
      if (result.error || !result.entry) return text(result.error || `Could not register ${item.filePath}.`);
      entries.push({ role: item.role, entry: result.entry });
    }

    const rawInputRefs = entries.filter((item) => item.role === "raw-input").map((item) => sourceArtifactRef(item.entry));
    const intermediateRefs = entries.filter((item) => item.role === "intermediate").map((item) => sourceArtifactRef(item.entry));
    const outputRefs = entries.filter((item) => item.role === "output").map((item) => sourceArtifactRef(item.entry));
    const metricRefs = entries.filter((item) => item.role === "metric").map((item) => sourceArtifactRef(item.entry));
    const refs = entries.filter((item) => item.role === "source").map((item) => sourceArtifactRef(item.entry));
    const mainSource = source || entries[0]?.entry.id || "";
    if (source && !entries.some((item) => item.entry.id === source) && !evidenceSourceExists(project, source)) {
      return text(`source must be one of the new source ids or an existing source ref/local file: ${source}`);
    }
    for (const item of entries) saveSourceManifestEntry(project, item.entry);
    const receipt: EvidenceReceipt = {
      projectId: project,
      id: evidenceId,
      title,
      sourceKind: sourceKind as EvidenceSourceKind,
      source: mainSource,
      summary,
      claimIds,
      rawInputRefs,
      intermediateRefs,
      outputRefs,
      metricRefs,
      excerpts: entries.map((item) => item.entry.selectedExcerpt).filter((excerpt): excerpt is string => Boolean(excerpt)),
      sampleCount,
      reviewer,
      reviewedAt,
      verdict,
      limitations,
      refs,
      updatedAt: new Date().toISOString(),
    };
    saveEvidence(receipt);
    refreshEvidenceClaimLinks(project, evidenceId, claimIds);
    return text(
      `Recorded source pack "${evidenceId}" with ${entries.length} source ref(s): ${entries
        .map((item) => `${item.role}:${item.entry.id}`)
        .join(", ")}.`,
    );
  },
);

server.registerTool(
  "check_claim_evidence",
  {
    title: "Check claim evidence readiness",
    description:
      "Hard gate for empirical claims in the paper. Resolves \\obclaim from the manuscript graph " +
      "(not unused claim-card records), evaluates the claim for purpose \"paper\", and checks linked " +
      "\\obevidence inspectability plus evidence receipts. A stored state= tag is not readiness.",
    inputSchema: { project: z.string(), claimId: z.string() },
  },
  async ({ project, claimId }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const { claim, paper, receipts } = paperEvidenceForClaim(project, claimId);
    if (!claim) return text(missingPaperClaimMessage(project, claimId));
    const blockers: string[] = claimPurposeBlockers(claim, "paper");
    if (paper.length === 0 && receipts.length === 0) {
      blockers.push("No \\obevidence in the paper (and no evidence receipt) links to this claim.");
    }
    const rawPaper = paper.filter((item) => item.rawRefs.length > 0);
    const rawReceipts = receipts.filter(hasRawEvidence);
    if (rawPaper.length === 0 && rawReceipts.length === 0) {
      blockers.push("No linked \\obevidence or evidence receipt has raw refs.");
    }
    if (
      ![...rawPaper, ...rawReceipts].some((item) => (item.sampleCount ?? 0) >= 10)
    ) {
      blockers.push("No linked evidence records at least 10 inspected raw examples.");
    }
    if (paper.some(saysRawMissing) || receipts.some(saysRawMissing)) {
      blockers.push("At least one linked evidence item explicitly says raw artifacts are missing.");
    }
    const paperReady = paper.some(isReadyPaperGraphEvidence);
    const receiptReady = receipts.some((item) => isReadyEvidenceReceiptForProject(project, item));
    if (!paperReady && !receiptReady) {
      blockers.push(
        "No linked \\obevidence meets the inspectability bar (raw refs, metric refs, >=10 samples, source, clean limitations), and no fallback evidence receipt meets that bar.",
      );
    }
    if (!claim.scope) blockers.push("Claim has no scope.");
    if (!claim.weakness) blockers.push("Claim has no current weakness or likely objection.");

    const label = claim.title || claim.id;
    if (blockers.length) {
      return text(
        `🚫 Claim "${label}" is not ready for paper promotion. It is needs-work for purpose paper.\n\n${blockers
          .map((b) => `- ${b}`)
          .join("\n")}\n\nRecommended move: inspect raw input/intermediate/output and link \\obevidence on the claim.`,
      );
    }
    return text(`✅ Claim "${label}" is ready for purpose paper: evidence, raw inspection, scope, and weakness are recorded.`);
  },
);

server.registerTool(
  "paper_synthesis_gate",
  {
    title: "Gate paper prose synthesis",
    description:
      "Hard gate before writing paper prose from \\obclaim anchors in the manuscript. Fails on " +
      "claims missing from the paper, evaluateClaimForPurpose needs-work, missing inspectable evidence, active gate challenges, or draft open items. A stored state= tag is not readiness.",
    inputSchema: { project: z.string(), draft: z.string().optional(), claimId: z.string().optional() },
  },
  async ({ project, draft, claimId }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const challenges = relevantGateChallenges(project, { claimIds: claimId ? [claimId] : [], targetSection: draft });
    const blockers: string[] = [];

    if (!claimId) {
      blockers.push("Claim id is required. Use request_paper_synthesis with explicit claimIds and targetSection for paper prose.");
    }
    if (!draft) blockers.push("Draft slug is required for paper prose synthesis.");

    if (claimId) {
      const { claim, paper, receipts } = paperEvidenceForClaim(project, claimId);
      if (!claim) {
        blockers.push(missingPaperClaimMessage(project, claimId));
      } else {
        const purposeBlockers = claimPurposeBlockers(claim, "paper-synthesis");
        if (purposeBlockers.length) {
          blockers.push(`Claim ${claim.id} is seed, not paper-ready. It is needs-work for paper-synthesis. ${purposeBlockers.join(" ")}`);
        }
        const paperReady = paper.some(isReadyPaperGraphEvidence);
        const receiptReady = receipts.some((item) => isReadyEvidenceReceiptForProject(project, item));
        if (!paperReady && !receiptReady) {
          blockers.push(
            `Claim ${claim.id} lacks inspectable evidence: a linked \\obevidence with raw refs, metric refs, >=10 inspected examples, source, and clean limitations, or a fallback evidence receipt that meets that bar.`,
          );
        }
      }
    }

    if (draft) {
      const doc = getDraft(project, draft);
      if (!doc) blockers.push(`Draft "${draft}" not found.`);
      else {
        const analysis = analyzeDraft(doc.source);
        if (analysis.openItems.length > 0) blockers.push(`Draft ${draft} has ${analysis.openItems.length} open item(s).`);
      }
    }

    for (const challenge of challenges) {
      blockers.push(`Active gate challenge ${challenge.id}: ${challenge.question}`);
    }

    if (blockers.length) {
      return text(`🚫 Paper synthesis blocked.\n\n${blockers.map((b) => `- ${b}`).join("\n")}\n\nWrite to notes/wiki/evidence first, or resolve the gate challenge.`);
    }
    return text("✅ Paper synthesis gate passed. Keep prose scoped to linked claims and evidence.");
  },
);

server.registerTool(
  "request_paper_synthesis",
  {
    title: "Request scoped paper synthesis",
    description:
      "Strict paper-prose gate. Requires explicit claim ids, target section, and draft. Returns exact allowed claim text and evidence ids only when the request is safe. Use this instead of writing paper prose from summaries or wiki text.",
    inputSchema: {
      project: z.string(),
      draft: z.string(),
      claimIds: z.array(z.string()).min(1),
      targetSection: z.string(),
      proposedProse: z.string().optional(),
    },
  },
  async ({ project, draft, claimIds, targetSection, proposedProse }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const blockers: string[] = [];
    const claims = claimIds.map((claimId) => paperEvidenceForClaim(project, claimId));
    for (let i = 0; i < claims.length; i++) {
      const { claim, paper, receipts } = claims[i]!;
      const claimId = claimIds[i]!;
      if (!claim) {
        blockers.push(missingPaperClaimMessage(project, claimId));
        continue;
      }
      if (claim.section && claim.section.toLowerCase() !== targetSection.toLowerCase()) {
        blockers.push(`Claim ${claim.id} targets ${claim.section}, not requested section ${targetSection}.`);
      }
      const purposeBlockers = claimPurposeBlockers(claim, "paper-synthesis");
      if (purposeBlockers.length) {
        blockers.push(`Claim ${claim.id} is needs-work for paper-synthesis. ${purposeBlockers.join(" ")}`);
      }
      const paperReady = paper.some(isReadyPaperGraphEvidence);
      const receiptReady = receipts.some((item) => isReadyEvidenceReceiptForProject(project, item));
      if (!paperReady && !receiptReady) {
        blockers.push(`Claim ${claim.id} lacks inspectable evidence: a linked \\obevidence with raw refs, metric refs, >=10 inspected examples, source, and clean limitations, or a fallback evidence receipt that meets that bar.`);
      }
    }
    const doc = getDraft(project, draft);
    if (!doc) blockers.push(`Draft "${draft}" not found.`);
    else {
      const analysis = analyzeDraft(doc.source);
      if (analysis.openItems.length > 0) blockers.push(`Draft ${draft} has ${analysis.openItems.length} open item(s).`);
    }
    const gateChallenges = relevantGateChallenges(project, { claimIds, targetSection });
    for (const challenge of gateChallenges) blockers.push(`Active gate challenge ${challenge.id}: ${challenge.question}`);
    if (proposedProse?.trim()) {
      blockers.push("Proposed prose supplied. Treat it as a draft note until this tool returns allowed claims with no blockers.");
    }
    if (blockers.length) {
      return text(`🚫 Paper synthesis request blocked for ${targetSection}.\n\n${blockers.map((blocker) => `- ${blocker}`).join("\n")}\n\nSafer move: update the LLM Wiki, record source refs, or create evidence leads until the named claims pass.`);
    }
    return text(
      `✅ Paper synthesis request allowed for ${targetSection}.\n\nAllowed claims:\n${claims
        .filter((row): row is typeof row & { claim: PaperGraphClaim } => Boolean(row.claim))
        .map((row) => {
          const claim = row.claim;
          const readyEvidence = row.paper.filter(isReadyPaperGraphEvidence);
          const readyReceipts = row.receipts.filter((item) => isReadyEvidenceReceiptForProject(project, item));
          const evidenceLines = [
            ...readyEvidence.map((item) => `  - ${item.id}: samples=${item.sampleCount ?? 0}; raw=${item.rawRefs.join(", ") || "none"}; metrics=${item.metricRefs.join(", ") || "none"}; limits=${item.limitations || "none"}`),
            ...readyReceipts.map((item) => {
              const rawRefs = [
                ...(item.rawInputRefs || []),
                ...(item.intermediateRefs || []),
                ...(item.outputRefs || []),
              ].map((ref) => ref.label || ref.id).join(", ");
              const metricRefs = (item.metricRefs || []).map((ref) => ref.label || ref.id).join(", ");
              return `  - ${item.id}: samples=${item.sampleCount ?? 0}; raw=${rawRefs || "none"}; metrics=${metricRefs || "none"}; limits=${item.limitations || "none"}`;
            }),
          ].join("\n");
          return `- ${claim.id}: ${claim.text}\n  allowed evidence:\n${evidenceLines || "  - none"}`;
        })
        .join("\n")}\n\nKeep prose scoped to these claims only.`,
    );
  },
);

server.registerTool(
  "challenge_status",
  {
    title: "List active research challenges",
    description:
      "Return active or cooling micro-challenges. Call after project_context so agents push on the right missing research move without repeating stale prompts.",
    inputSchema: { project: z.string(), includeResolved: z.boolean().optional() },
  },
  async ({ project, includeResolved }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const challenges = listChallenges(project).filter((c) => includeResolved || c.status === "active" || c.status === "deferred");
    if (!challenges.length) return text(`No active challenges for "${project}".`);
    return text(
      `# Challenges: ${project}\n\n${challenges
        .map(
          (challenge) =>
            `- **${challenge.id} — ${challenge.type}** [${challenge.severity}, ${challenge.status}]\n` +
            `  Challenge: ${challenge.question}\n` +
            `  Why now: ${challenge.whyNow}\n` +
            `  Fastest artifact: ${challenge.expectedArtifact}\n` +
            `  Recommended answer: ${challenge.recommendedAnswer || "not recorded"}`,
        )
        .join("\n")}`,
    );
  },
);

server.registerTool(
  "weekly_review",
  {
    title: "Weekly research review",
    description:
      "Generate a source-backed weekly review packet across projects. Use this before advisor meetings to answer what changed since last meeting without manual copy-paste.",
    inputSchema: {
      since: z.string().optional().describe("ISO date or datetime. Defaults to seven days ago."),
      days: z.number().optional().describe("Lookback window when since is omitted. Defaults to 7."),
      maxItems: z.number().optional().describe("Maximum items per section. Defaults to 24."),
    },
  },
  async ({ since, days, maxItems }) => {
    return text(renderWeeklyReviewMarkdown(buildWeeklyReview({ since, days }), maxItems));
  },
);

server.registerTool(
  "monthly_review",
  {
    title: "Research postmortem",
    description:
      "Generate an overall research postmortem across all projects by default. Use this in MCP conversations to assess focus, momentum, and evidence quality. Pass a project slug only for a focused packet.",
    inputSchema: { project: z.string().optional() },
  },
  async ({ project }) => {
    if (!project) {
      const rows = listProjects().map((p) => {
        const claims = summarizePaperClaims(buildProjectPaperGraph(p.slug));
        const evidence = listEvidence(p.slug);
        const challenges = listChallenges(p.slug).filter((challenge) => challenge.status === "active");
        const reviews = listMonthlyReviews(p.slug);
        const rawGaps = evidence.filter(needsRawInspection);
        const gateChallenges = challenges.filter((challenge) => challenge.severity === "gate");
        const drafts = listDrafts(p.slug)
          .map((draftSlug) => getDraft(p.slug, draftSlug))
          .filter(Boolean);
        const openDraftItems = drafts.reduce((sum, doc) => sum + analyzeDraft(doc!.source).openItems.length, 0);
        return { p, claims, evidence, challenges, reviews, rawGaps, gateChallenges, openDraftItems };
      });
      const totals = rows.reduce(
        (acc, row) => ({
          projects: acc.projects + 1,
          needsWork: acc.needsWork + row.claims.needsWork.length,
          rawGaps: acc.rawGaps + row.rawGaps.length,
          gateChallenges: acc.gateChallenges + row.gateChallenges.length,
          openDraftItems: acc.openDraftItems + row.openDraftItems,
        }),
        { projects: 0, needsWork: 0, rawGaps: 0, gateChallenges: 0, openDraftItems: 0 },
      );
      const ranked = rows.sort(
        (a, b) =>
          b.gateChallenges.length * 6 +
          b.rawGaps.length * 4 +
          b.claims.needsWork.length * 3 +
          Math.min(b.openDraftItems, 10) -
          (a.gateChallenges.length * 6 + a.rawGaps.length * 4 + a.claims.needsWork.length * 3 + Math.min(a.openDraftItems, 10)),
      );

      return text(
        `# Research postmortem: all projects\n\n` +
          `## Current shape\n` +
          `- projects: ${totals.projects}\n` +
          `- claims needing work for paper-synthesis: ${totals.needsWork}\n` +
          `- raw evidence gaps: ${totals.rawGaps}\n` +
          `- active gate challenges: ${totals.gateChallenges}\n` +
          `- open draft items: ${totals.openDraftItems}\n\n` +
          `## Project ranking\n` +
          `${ranked.map((row) => {
            const latestReview = row.reviews[0];
            const leadClaim = row.claims.needsWork[0]?.claim || row.claims.rows[0]?.claim;
            const leadChallenge = row.gateChallenges[0] || row.challenges[0];
            return (
              `- **${row.p.title}** (${row.p.slug}, ${row.p.status})\n` +
              `  claims: ${row.claims.rows.length} total, ${row.claims.needsWork.length} needs-work, ${row.claims.ready.length} ready for paper-synthesis\n` +
              `  evidence: ${row.evidence.length} receipts, ${row.rawGaps.length} raw gaps\n` +
              `  gate challenges: ${row.gateChallenges.length}; open draft items: ${row.openDraftItems}\n` +
              `  current claim: ${leadClaim ? `${leadClaim.id} — ${leadClaim.text.slice(0, 80)}` : "none recorded"}\n` +
              `  hardest challenge: ${leadChallenge ? leadChallenge.question : "none recorded"}\n` +
              `  next bet: ${latestReview?.nextBets[0] || leadClaim?.next || "choose the next claim-changing move"}`
            );
          }).join("\n\n")}\n\n` +
          `## Mentor discussion\n` +
          `- Identify the project whose belief state changed most.\n` +
          `- Identify the evidence gap most limiting paper quality.\n` +
          `- Choose one continue, pivot, pause, or kill decision.\n` +
          `- Choose the one discussion point for the next 30-minute meeting.`,
      );
    }
    const p = getProject(project);
    if (!p) return text(`Unknown project "${project}".`);
    const reviews = listMonthlyReviews(project);
    const claims = summarizePaperClaims(buildProjectPaperGraph(project));
    const evidence = listEvidence(project);
    const challenges = listChallenges(project).filter((challenge) => challenge.status === "active");
    const drafts = listDrafts(project)
      .map((draftSlug) => getDraft(project, draftSlug))
      .filter(Boolean);
    const rawGaps = evidence.filter(needsRawInspection);
    const openDraftItems = drafts.reduce((sum, doc) => sum + analyzeDraft(doc!.source).openItems.length, 0);
    const latestReview = reviews[0];

    return text(
      `# Research postmortem: ${p.title}\n\n` +
        `## Current shape\n` +
        `- status: ${p.status}${p.venue ? `\n- venue: ${p.venue}` : ""}\n` +
        `- claims: ${claims.rows.length} total, ${claims.needsWork.length} needs-work, ${claims.ready.length} ready for paper-synthesis\n` +
        `- evidence receipts: ${evidence.length} total, ${rawGaps.length} needing raw inspection or sample counts\n` +
        `- active challenges: ${challenges.length}\n` +
        `- open draft items: ${openDraftItems}\n\n` +
        `## Claims that need work for paper-synthesis\n` +
        `${claims.needsWork.length ? claims.needsWork.slice(0, 6).map((row) => `- ${row.claim.id}: ${row.claim.text.slice(0, 80)} — next: ${row.claim.next || "record next action"}`).join("\n") : "- none recorded"}\n\n` +
        `## Raw inspection queue\n` +
        `${rawGaps.length ? rawGaps.slice(0, 6).map((item) => `- ${item.id}: ${item.title} — samples ${item.sampleCount ?? 0}; source ${item.sourceKind}`).join("\n") : "- none recorded"}\n\n` +
        `## Active challenges\n` +
        `${challenges.length ? challenges.slice(0, 6).map((challenge) => `- ${challenge.id} [${challenge.severity}]: ${challenge.question}\n  fastest artifact: ${challenge.expectedArtifact}`).join("\n") : "- none recorded"}\n\n` +
        `## Latest stored review\n` +
        `${latestReview ? `- month: ${latestReview.month}\n- what changed: ${latestReview.whatChanged || "not recorded"}\n- why it matters: ${latestReview.whyItMatters || "not recorded"}\n- Discussion point: ${latestReview.discussionAsk || "not recorded"}\n- taste: ${latestReview.taste}\n- evidence: ${latestReview.evidence}\n- paper: ${latestReview.paper}\n- momentum: ${latestReview.momentum}\n- decisions: ${latestReview.decisions.join(" | ") || "none"}\n- next bets: ${latestReview.nextBets.join(" | ") || "none"}` : "- no stored monthly review yet"}\n\n` +
        `## Recommended packet for the research team and agents\n` +
        `- Decide which needs-work claim deserves one raw-inspection batch this month.\n` +
        `- Pick one paper section whose evidence can become clearer.\n` +
        `- Choose continue, pivot, pause, or kill for any project with activity and no belief change.\n` +
        `- Record the strongest discussion point for the next 30-minute meeting.`,
    );
  },
);

server.registerTool(
  "advisor_brief",
  {
    title: "All-project advisor brief",
    description:
      "Generate a concise meeting packet across all projects: what changed, why it matters, discussion points, claims that need work, raw evidence gaps, and active gate challenges.",
    inputSchema: {
      month: z.string().optional().describe("YYYY-MM, optional. Defaults to latest review per project."),
    },
  },
  async ({ month }) => {
    const rows = listProjects().map((project) => {
      const reviews = listMonthlyReviews(project.slug);
      const review = month ? reviews.find((item) => item.month === month) : reviews[0];
      const claims = summarizePaperClaims(buildProjectPaperGraph(project.slug));
      const evidence = listEvidence(project.slug);
      const challenges = listChallenges(project.slug).filter((challenge) => challenge.status === "active");
      const rawGaps = evidence.filter(needsRawInspection);
      const gateChallenges = challenges.filter((challenge) => challenge.severity === "gate");
      const score = gateChallenges.length * 6 + rawGaps.length * 4 + claims.needsWork.length * 3;
      return { project, review, claims, rawGaps, gateChallenges, score };
    }).sort((a, b) => b.score - a.score || a.project.title.localeCompare(b.project.title));

    return text(
      `# Advisor brief${month ? ` — ${month}` : ""}\n\n` +
        rows.map(({ project, review, claims, rawGaps, gateChallenges }) => {
          const ask = review?.discussionAsk || gateChallenges[0]?.question || "No discussion ask recorded.";
          const lead = claims.needsWork[0]?.claim;
          const changed = review?.whatChanged || lead?.next || "No change note recorded.";
          const why = review?.whyItMatters || review?.taste || project.tagline;
          return (
            `## ${project.icon || ""} ${project.title}\n` +
            `- what changed: ${changed}\n` +
            `- why it matters: ${why}\n` +
            `- Discussion point: ${ask}\n` +
            `- needs-work claims: ${claims.needsWork.length}; raw gaps: ${rawGaps.length}; gate challenges: ${gateChallenges.length}\n` +
            `- next bet: ${review?.nextBets?.[0] || lead?.next || gateChallenges[0]?.expectedArtifact || "not recorded"}\n`
          );
        }).join("\n"),
    );
  },
);

// ---------------------------------------------------------------------------
// DRAFT TOOLS — the draft is the source of truth for manuscript claims, comments,
// TODOs, and citations. The mindmap is a separate editable planning canvas;
// agents must not treat it as a substitute for updating draft anchors.
// ---------------------------------------------------------------------------

function primaryDraftSlug(project: string): string {
  return listDrafts(project)[0] || "paper";
}

function sanitizeAnchorText(s: string): string {
  return escapeTexText(s.replace(/\s*\n\s*/g, " ").trim());
}

function normalizeAnchorText(s: string): string {
  return s.replace(/\s*\n\s*/g, " ").trim();
}

function sectionAttr(title?: string): string {
  if (!title) return "section";
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
}

function defaultAnchorSection(paper: NonNullable<ReturnType<typeof getEditableTexPaper>>) {
  return paper.sections.filter((section) => !section.appendix).at(-1) || paper.sections.at(-1)!;
}

function appendAnchorToDraft(project: string, anchorLine: string, sectionTitle?: string): string {
  if (!getProject(project)) return `Unknown project "${project}".`;
  const paper = getEditableTexPaper(project);
  if (!paper?.sections.length) return `No paper sections in ${project}.`;
  const wanted = (sectionTitle || "").toLowerCase();
  const target = wanted
    ? paper.sections.find((section) => section.title.toLowerCase() === wanted)
      || paper.sections.find((section) => section.title.toLowerCase().includes(wanted))
      || defaultAnchorSection(paper)
    : defaultAnchorSection(paper);
  const nextTex = `${target.tex.replace(/\s+$/u, "")}\n\n${anchorLine}\n`;
  patchEditableTexPaperSection(project, target.id, target.hash, nextTex);
  return `Appended into "${target.title}" of ${project}/paper.tex.`;
}

server.registerTool(
  "get_draft",
  {
    title: "Read the project draft (single source of truth)",
    description:
      "Return the composed TeX of a project's paper (\\title / \\section + TeX bodies). Claims, " +
      "comments, TODOs, and citations live inline as anchors (\\obclaim, \\obcomment, " +
      "\\obtodo, \\cite) and maturity markers ({?hypothesized:}, {?todo:} or \\obmarker). Read it before making " +
      "manuscript-state changes; the editable mindmap does not replace these anchors.",
    inputSchema: { project: z.string(), draft: z.string().optional() },
  },
  async ({ project, draft }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const draftSlug = draft || primaryDraftSlug(project);
    if (!listDrafts(project).includes(draftSlug)) {
      return text(`No draft "${draftSlug}" in ${project}. Drafts: ${listDrafts(project).join(", ") || "none"}.`);
    }
    const paper = getEditableTexPaper(project);
    if (!paper) return text(`No draft "${draftSlug}" in ${project}. Drafts: ${listDrafts(project).join(", ") || "none"}.`);
    return text(`# ${paper.title} (${project}/${draftSlug}.tex)\n\n\`\`\`tex\n${paper.source}\n\`\`\``);
  },
);

server.registerTool(
  "update_draft",
  {
    title: "Replace the project draft",
    description:
      "Overwrite a project's composed TeX paper (\\title / \\section + TeX bodies). Because the draft is the single source of truth for " +
      "manuscript state, preserve existing \\obclaim / \\obcomment / " +
      "\\obtodo anchors and {?...} markers. Resolve open items with source-backed content before " +
      "describing the draft as complete.",
    inputSchema: {
      project: z.string(),
      draft: z.string().optional(),
      source: z.string().describe("the full composed TeX paper (\\title / \\section, no YAML front matter)"),
    },
  },
  async ({ project, draft, source }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const draftSlug = draft || primaryDraftSlug(project);
    const existing = getEditableTexPaper(project);
    try {
      saveDraft(project, draftSlug, source, { title: existing?.title || project });
    } catch (error) {
      return text(error instanceof Error ? error.message : String(error));
    }
    const a = analyzeDraft(source);
    return text(
      `Saved ${project}/${draftSlug}.tex. Maturity ${a.overallMaturity}, ${Math.round(a.completion * 100)}% mature, ${a.openItems.length} open items remain.`,
    );
  },
);

server.registerTool(
  "edit_draft",
  {
    title: "Find-and-replace in the draft",
    description:
      "Apply a single exact find-and-replace edit to a project's draft. Safer than update_draft for " +
      "small changes. Fails if the search text is missing or not unique.",
    inputSchema: {
      project: z.string(),
      draft: z.string().optional(),
      find: z.string().describe("exact text to find (must be unique in the draft)"),
      replace: z.string(),
    },
  },
  async ({ project, draft, find, replace }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const draftSlug = draft || primaryDraftSlug(project);
    const paper = getEditableTexPaper(project);
    if (!paper || (draft && !listDrafts(project).includes(draftSlug))) return text(`No draft "${draftSlug}" in ${project}.`);
    const count = paper.source.split(find).length - 1;
    if (count === 0) return text(`Search text not found in ${draftSlug}. No change made.`);
    if (count > 1) return text(`Search text appears ${count} times; add context to make it unique. No change made.`);
    const hit = paper.sections.filter((section) => section.tex.includes(find));
    if (hit.length === 1 && hit[0]!.tex.split(find).length === 2) {
      try {
        patchEditableTexPaperSection(project, hit[0]!.id, hit[0]!.hash, hit[0]!.tex.replace(find, replace));
      } catch (error) {
        return text(error instanceof Error ? error.message : String(error));
      }
      return text(`Applied edit to ${project}/${draftSlug}.tex.`);
    }
    return text(
      `Search text is not unique to one paper section. Use more context, or an explicit section operation for title/structure changes. No change made.`,
    );
  },
);

server.registerTool(
  "add_claim",
  {
    title: "Add a claim to the draft",
    description:
      "Append an \\obclaim anchor to a draft section. Claims are text + links + tags + assessments. " +
      "`state=` is a deprecated display hint, not readiness. Use tags (and later assessments) instead of promoting a status ladder.",
    inputSchema: {
      project: z.string(),
      id: z.string().describe("stable claim id, e.g. layer-sweep-transfer"),
      text: z.string().describe("the claim sentence"),
      state: z.string().optional().describe("deprecated display hint only; not claim identity"),
      tags: z.array(z.string()).optional().describe("open-ended claim tags, not a status ladder"),
      section: z.string().optional().describe("draft section heading to append under"),
    },
  },
  async ({ project, id, text: claimText, state, tags, section }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const paper = getEditableTexPaper(project);
    const parts = [`id=${id}`, `section=${sectionAttr(section)}`];
    if (state) parts.push(`state=${state}`);
    if (tags?.length) parts.push(`tags=${tags.join(",")}`);
    const anchor = `\\obclaim[${parts.join(", ")}]{${sanitizeAnchorText(claimText)}}`;
    return text(appendAnchorToDraft(project, anchor, section || paper?.sections[0]?.title || "Introduction"));
  },
);

server.registerTool(
  "add_comment",
  {
    title: "Add a collaborator comment",
    description:
      "Append a simple \\obcomment note to a paper section. The comment lives in the TeX source, appears gently in the live reader, and disappears from final PDF mode.",
    inputSchema: {
      project: z.string(),
      text: z.string().describe("the concise collaborator note"),
      section: z.string().optional().describe("draft section heading; defaults to the last main-matter section"),
    },
  },
  async ({ project, text: commentText, section }) => {
    const anchor = `\\obcomment{${sanitizeAnchorText(commentText)}}`;
    return text(appendAnchorToDraft(project, anchor, section));
  },
);

server.registerTool(
  "add_todo",
  {
    title: "Add a TODO to the draft",
    description:
      "Append an \\obtodo anchor to a draft section. TODOs are the paper's open items and status " +
      "comments; they appear inline and block 'done' until genuinely resolved.",
    inputSchema: {
      project: z.string(),
      text: z.string().describe("the open item / next step"),
      claim: z.string().optional().describe("claim id this TODO is about"),
      section: z.string().optional().describe("draft section heading; defaults to the last main-matter section"),
      owner: z.string().optional().describe("optional person or agent responsible for the item"),
      priority: z.enum(["p0", "p1", "p2", "p3"]).optional().describe("optional priority"),
      due: z.string().optional().describe("optional target date YYYY-MM-DD"),
    },
  },
  async ({ project, text: todoText, claim, section, owner, priority, due }) => {
    const anchor = composeObtodo({
      id: shortId("t"),
      text: normalizeAnchorText(todoText),
      claim,
      owner,
      priority: parseTodoPriority(priority),
      due: parseTodoDate(due),
      createdAt: todayStamp(),
    });
    return text(appendAnchorToDraft(project, anchor, section));
  },
);

server.registerTool(
  "update_todo",
  {
    title: "Update a draft TODO",
    description: "Patch an \\obtodo by stable id. Completion uses complete_todo to retain status=done.",
    inputSchema: {
      project: z.string(),
      id: z.string(),
      text: z.string().optional(),
      owner: z.string().nullable().optional(),
      due: z.string().nullable().optional(),
      priority: z.enum(["p0", "p1", "p2", "p3"]).nullable().optional(),
      status: z.enum(["open", "in_progress", "blocked", "done"]).optional(),
    },
  },
  async ({ project, id, text: todoText, owner, due, priority, status }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const paper = getEditableTexPaper(project);
    if (!paper) return text(`No paper in ${project}.`);
    for (const section of paper.sections) {
      const result = applySourceOperation(section.tex, {
        type: "update_todo",
        id,
        text: todoText,
        owner,
        due,
        priority,
        status,
      });
      if (result.ok && result.value.source !== section.tex) {
        patchEditableTexPaperSection(project, section.id, section.hash, result.value.source);
        return text(JSON.stringify({ ok: true, sectionId: section.id, id }));
      }
      if (!result.ok && result.code !== "unknown_todo") return text(JSON.stringify(result));
    }
    return text(JSON.stringify({ ok: false, code: "unknown_todo", message: `Unknown TODO "${id}".` }));
  },
);

server.registerTool(
  "complete_todo",
  {
    title: "Complete a draft TODO",
    description: "Retain the \\obtodo with status=done and completedAt instead of deleting it.",
    inputSchema: { project: z.string(), id: z.string() },
  },
  async ({ project, id }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const paper = getEditableTexPaper(project);
    if (!paper) return text(`No paper in ${project}.`);
    for (const section of paper.sections) {
      const result = applySourceOperation(section.tex, { type: "complete_todo", id });
      if (result.ok && result.value.source !== section.tex) {
        patchEditableTexPaperSection(project, section.id, section.hash, result.value.source);
        return text(JSON.stringify({ ok: true, sectionId: section.id, id, status: "done" }));
      }
    }
    return text(JSON.stringify({ ok: false, code: "unknown_todo", message: `Unknown TODO "${id}".` }));
  },
);

server.registerTool(
  "list_todos",
  {
    title: "List open items from the draft",
    description:
      "Return the project's open items derived from the draft: empty sections, {?todo/verify/cite/" +
      "hypothesized} markers, and \\obtodo anchors, grouped by section. This is the ground-truth " +
      "checklist of what is not done — do not report the paper as complete while items remain.",
    inputSchema: { project: z.string() },
  },
  async ({ project }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const draftSlug = primaryDraftSlug(project);
    const doc = getDraft(project, draftSlug);
    if (!doc) return text(`No draft in ${project}.`);
    const a = analyzeDraft(doc.source);
    const graph = buildProjectPaperGraph(project);
    const lines = [`# Open items: ${project} (${a.openItems.length} markers, ${graph.todos.length} \\obtodo)`, ""];
    if (a.openItems.length) {
      for (const o of a.openItems) lines.push(`- [${o.kind}] (${o.section}) ${o.text}`);
    } else {
      lines.push("_No marker-level open items detected — still verify before claiming done._");
    }
    if (graph.todos.length) {
      lines.push("", "## \\obtodo anchors");
      for (const t of graph.todos) {
        const bits = [
          t.id,
          t.priority,
          t.due ? `due ${t.due}` : "",
          t.owner ? `owner ${t.owner}` : "",
          t.createdAt ? `created ${t.createdAt}` : "",
          t.claimId ? `claim ${t.claimId}` : "",
        ].filter(Boolean);
        lines.push(`- ${bits.join(" · ")}: ${t.text}`);
      }
    }
    return text(lines.join("\n"));
  },
);

server.registerTool(
  "get_bibliography",
  {
    title: "Read the project bibliography",
    description:
      "Return the parsed entries from the project's separate references.bib file (keys, types, " +
      "fields). Cite an entry in the draft with \\cite{key}; the paper compiles numbered references.",
    inputSchema: {
      project: z.string(),
      raw: z.boolean().optional().describe("return the raw .bib text instead of a parsed list"),
    },
  },
  async ({ project, raw }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    if (raw) {
      const rawText = getBibliographyRaw(project);
      return text(rawText ? `\`\`\`bibtex\n${rawText}\n\`\`\`` : `No references.bib for ${project}.`);
    }
    const entries = getBibliography(project);
    if (!entries.length) return text(`No references.bib entries for ${project}. Add one with add_reference.`);
    return text(
      `# Bibliography: ${project} (${entries.length})\n\n${entries
        .map((e) => `- **${e.key}** (${e.type}) — ${e.fields.author || "?"}. ${e.fields.title || "?"}. ${e.fields.year || ""}`)
        .join("\n")}`,
    );
  },
);

server.registerTool(
  "add_reference",
  {
    title: "Add a BibTeX entry",
    description:
      "Append a complete BibTeX entry to the project's separate references.bib, then cite it in the " +
      "draft with \\cite{key}. Provide a full @type{key, field={...}, ...} block. Do not invent " +
      "references — use real, verifiable ones.",
    inputSchema: {
      project: z.string(),
      bibtex: z.string().describe("a complete BibTeX entry, e.g. @article{key, author={...}, title={...}, year={2024}}"),
    },
  },
  async ({ project, bibtex }) => {
    if (!getProject(project)) return text(`Unknown project "${project}".`);
    const parsed = parseBibtexCitationJs(bibtex) || parseBibtex(bibtex);
    if (!parsed.length) return text("Could not parse a BibTeX entry. Provide a complete @type{key, ...} block.");
    const existingRaw = getBibliographyRaw(project);
    const existing = parseBibtex(existingRaw);
    const dupes = parsed.filter((p) => existing.some((e) => e.key === p.key));
    if (dupes.length) {
      return text(`Refusing to add duplicate key(s): ${dupes.map((item) => item.key).join(", ")}.`);
    }
    const next = (existingRaw.trim() ? `${existingRaw.trim()}\n\n` : "") + `${bibtex.trim()}\n`;
    saveBibliographyRaw(project, next);
    return text(
      `Added ${parsed.map((p) => p.key).join(", ")} to ${project}/references.bib. Cite with \\cite{${parsed[0]!.key}}.`,
    );
  },
);

server.registerTool(
  "explain_tex_repo_setup",
  {
    title: "Explain TeX repository setup",
    description:
      "Return the safe, agent-ready setup flow for an existing arXiv-style TeX Git repository, a new empty paper, or an Overleaf and other Git remote. " +
      "Use this before requesting a path, remote URL, or credential choice. This is an MCP coding-agent tool, not a live paper-page WebMCP tool.",
    inputSchema: {
      kind: z.enum(["existing", "empty", "overleaf", "other-git"]).describe("The repository setup path the user wants."),
    },
  },
  async ({ kind }) => {
    const guide = explainTexRepoSetup(kind);
    if (!guide.ok) return text(guide.message);
    return text(JSON.stringify(guide, null, 2));
  },
);

server.registerTool(
  "inspect_tex_git_repo",
  {
    title: "Inspect a TeX Git repository",
    description:
      "Read-only onboarding check for an existing arXiv-style or OpenBarry TeX Git repository. " +
      "Reports Git state and TeX source files without copying, changing, fetching, or exposing credentials. " +
      "Pass a local path already inside the configured allowed roots. Attach/import remains a user-facing choice when the repository is ready.",
    inputSchema: { repositoryPath: z.string().describe("Existing local repository directory inside an allowed root.") },
  },
  async ({ repositoryPath }) => {
    const safePath = resolveAllowedPath(repositoryPath);
    if (!safePath) return text(`Access denied: repository path "${repositoryPath}" is outside allowed roots or does not exist.`);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(safePath);
    } catch {
      return text(`Repository not found: ${repositoryPath}`);
    }
    if (!stat.isDirectory()) return text(`Repository path is not a directory: ${repositoryPath}`);
    const inspection = await inspectTexGitRepo(safePath);
    const status = inspection.status;
    return text(
      `# TeX Git repository\n\n` +
        `- path: ${safePath}\n` +
        `- Git repository: ${status.isGitRepo ? "yes" : "no"}\n` +
        `- paper source detected: ${inspection.hasPaperSource ? "yes" : "no"}\n` +
        `- branch: ${status.branch || "unknown"}\n` +
        `- remote: ${status.remoteUrl || "none configured"}\n` +
        `- working tree: ${status.isClean === undefined ? "unknown" : status.isClean ? "clean" : "has changes"}\n` +
        `- TeX files: ${inspection.texFiles.length ? inspection.texFiles.join(", ") : "none detected"}\n\n` +
        `Credentials stay in the OS Git credential helper or SSH configuration. This inspection returns no credential material.`,
    );
  },
);

server.registerTool(
  "initialize_minimal_tex_repo",
  {
    title: "Initialize an empty minimal TeX repository",
    description:
      "Create a new minimal OpenBarry TeX manuscript and local Git repository at an empty path inside the configured allowed roots. " +
      "The operation refuses non-empty directories, writes only TeX/comment-backed state, and never accepts credentials or remote URLs.",
    inputSchema: {
      repositoryPath: z.string().describe("New or empty local directory inside an allowed root."),
      title: z.string().min(1).max(200).describe("Paper title for the starter manuscript."),
    },
  },
  async ({ repositoryPath, title }) => {
    const safePath = resolveAllowedCreationPath(repositoryPath);
    if (!safePath) return text(`Access denied: repository path "${repositoryPath}" is outside allowed roots.`);
    const result = await initializeMinimalTexRepo(safePath, title);
    return text(result.ok ? `${result.message}\nPath: ${safePath}` : result.message);
  },
);

server.registerTool(
  "configure_overleaf_remote",
  {
    title: "Configure a credential-free Overleaf remote",
    description:
      "Set a Git remote for an existing local TeX repository. The remote URL must contain no username, password, token, or embedded secret. " +
      "Use the operating system Git credential helper or SSH keys for authentication. The tool returns a redacted status message and never accepts credentials as separate arguments.",
    inputSchema: {
      repositoryPath: z.string().describe("Existing local TeX Git repository inside an allowed root."),
      remoteUrl: z.string().refine(isCredentialFreeGitRemote, "Use a credential-free HTTPS, ssh://, or git@host:path remote."),
    },
  },
  async ({ repositoryPath, remoteUrl }) => {
    const safePath = resolveAllowedPath(repositoryPath);
    if (!safePath) return text(`Access denied: repository path "${repositoryPath}" is outside allowed roots or does not exist.`);
    try {
      if (!fs.statSync(safePath).isDirectory()) return text(`Repository path is not a directory: ${repositoryPath}`);
    } catch {
      return text(`Repository not found: ${repositoryPath}`);
    }
    const result = await initOverleafGit(safePath, remoteUrl);
    return text(result.message);
  },
);

// ---------------------------------------------------------------------------
// RESOURCES — browsable content the agent can read directly.
// ---------------------------------------------------------------------------

server.registerResource(
  "guardrails",
  "openbarry://guardrails",
  {
    title: "Research working agreement",
    description: "The academic-integrity guardrails every agent must honor.",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: `# Research working agreement\n\n${RESEARCH_GUARDRAILS.map((g) => `- ${g}`).join("\n")}`,
      },
    ],
  }),
);

server.registerResource(
  "methodology",
  "openbarry://methodology",
  {
    title: "How good research happens",
    description:
      "Distilled working principles from Hamming, Christiano, Nanda, Carlini, reasoning transparency, and measurement validity.",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [
      { uri: uri.href, mimeType: "text/markdown", text: methodologyDigest() },
    ],
  }),
);

server.registerResource(
  "source-grounding",
  "openbarry://source-grounding",
  {
    title: "Source grounding for OpenBarry principles",
    description: "Named sources, motivations, and product implications behind the research workflow.",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [
      { uri: uri.href, mimeType: "text/markdown", text: sourceGroundingMarkdown() },
    ],
  }),
);

server.registerResource(
  "llm-wiki-protocol",
  "openbarry://llm-wiki-protocol",
  {
    title: "OpenBarry LLM Wiki protocol",
    description: "Agent-facing rules for maintaining source-backed interlinked project wiki pages.",
    mimeType: "text/markdown",
  },
  async (uri) => ({
    contents: [
      { uri: uri.href, mimeType: "text/markdown", text: LLM_WIKI_PROTOCOL },
    ],
  }),
);

server.registerResource(
  "project",
  new ResourceTemplate("openbarry://project/{slug}", {
    list: async () => ({
      resources: listProjects().map((p) => ({
        uri: `openbarry://project/${p.slug}`,
        name: p.title,
        description: p.tagline,
        mimeType: "text/markdown",
      })),
    }),
  }),
  {
    title: "Project context",
    description: "Full research context for a project.",
    mimeType: "text/markdown",
  },
  async (uri, { slug }) => {
    const md = renderContextMarkdown(String(slug));
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: md || `Unknown project "${slug}".`,
        },
      ],
    };
  },
);

// ---------------------------------------------------------------------------
// PROMPTS — bundled research skills, invocable as slash-style prompts.
// ---------------------------------------------------------------------------

for (const skill of SKILLS) {
  server.registerPrompt(
    skill.id,
    {
      title: skill.title,
      description: skill.when,
      argsSchema: { project: z.string().optional() },
    },
    async ({ project }) => {
      let context = "";
      if (project) {
        const bundle = buildContextBundle(project);
        if (bundle) {
          context = `\n\n---\nActive project: **${bundle.project.title}**. Call project_context("${project}") for the full picture and honor its working agreement.`;
        }
      }
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Adopt this skill for the rest of our work.\n\n# ${skill.title}\n\n${skill.body}${context}`,
            },
          },
        ],
      };
    },
  );
}

// A prompt that injects the full project context directly.
server.registerPrompt(
  "load-project",
  {
    title: "Load project context",
    description: "Inject a project's full research context and working agreement.",
    argsSchema: { project: z.string() },
  },
  async ({ project }) => {
    const md = renderContextMarkdown(project) || `Unknown project "${project}".`;
    return {
      messages: [
        {
          role: "user" as const,
          content: { type: "text" as const, text: md },
        },
      ],
    };
  },
);

return server;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function main() {
  const server = createOpenBarryMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is the JSON-RPC channel.
  console.error(
    `OpenBarry MCP server ready. ${listProjects().length} project(s), ${SKILLS.length} skills.`,
  );
}

function isDirectStdioEntry() {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(resolve(entry)).href);
}

if (isDirectStdioEntry()) {
  main().catch((err) => {
    console.error("OpenBarry MCP fatal:", err);
    process.exit(1);
  });
}
