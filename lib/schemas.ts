import { z } from "zod";

import { claimAssessmentSchema } from "@/lib/research/claim-model";
import { tagSchema } from "@/lib/research/claim-tags";
import { safeUrl } from "@/lib/safe-url";

const isoDateTime = z.string().datetime({ offset: true });
const nonnegativeInteger = z.number().int().nonnegative();

export const artifactRefSchema = z
  .object({
    kind: z.enum([
      "project",
      "draft-section",
      "draft-claim",
      "draft-todo",
      "wiki-page",
      "daily-note",
      "mindmap-node",
      "slide",
      "figure",
      "dataset",
      "experiment",
      "web",
      "html-document",
      "markdown-document",
      "custom",
      "external",
    ]),
    id: z.string(),
    label: z.string().optional(),
    url: z.string().max(2_000).optional(),
  })
  .strict()
  .superRefine((ref, context) => {
    const validHttpUrl = (value: string | undefined) => Boolean(value && /^https?:\/\//i.test(value.trim()) && safeUrl(value));
    if (ref.url && !validHttpUrl(ref.url)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "Reference URLs require http(s)." });
    }
    if (ref.kind === "web" && !validHttpUrl(ref.url || ref.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["id"], message: "Web references require an http(s) URL." });
    }
  });

export const maturitySchema = z.enum(["empty", "hypothesized", "draft", "review", "final"]);
export const claimStateSchema = z.enum([
  "seed",
  "hypothesis",
  "weak-evidence",
  "moderate-evidence",
  "strong-evidence",
  "paper-ready",
  "submitted",
  "killed",
]);

export const projectModeSchema = z.string().min(1).max(64);

export const projectSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    mode: projectModeSchema.optional(),
    researchKind: z.string().optional(),
    tagline: z.string(),
    overview: z.string(),
    status: z.enum(["active", "incubating", "paused", "submitted", "archived"]),
    venue: z.string().optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    color: z.string().optional(),
    icon: z.string().optional(),
    links: z.array(
      z
        .object({
          label: z.string(),
          url: z.string(),
          kind: z.enum(["overleaf", "latex", "gdoc", "gslides", "repo", "arxiv", "web", "colab"]),
        })
        .strict(),
    ),
    collaborators: z.array(z.string()).optional(),
    milestones: z
      .array(
        z
          .object({
            id: z.string(),
            title: z.string(),
            due: z.string().optional(),
            status: z.enum(["open", "done"]).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export const claimCardSchema = z
  .object({
    title: z.string().optional(),
    claim: z.string().optional(),
    paperSection: z.string().optional(),
    state: claimStateSchema.optional(),
    maturity: maturitySchema.optional(),
    confidence: z.enum(["low", "medium", "high"]).optional(),
    scope: z.string().optional(),
    owner: z.string().optional(),
    evidenceIds: z.array(z.string()).optional(),
    objectionIds: z.array(z.string()).optional(),
    challengeIds: z.array(z.string()).optional(),
    tags: z.array(tagSchema).optional(),
    assessments: z.array(claimAssessmentSchema).optional(),
    notes: z.array(z.string()).optional(),
    refs: z.array(artifactRefSchema).optional(),
    currentWeakness: z.string().optional(),
    nextAction: z.string().optional(),
    lastCheckedAt: isoDateTime.optional(),
    createdAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
  })
  .strict();

export const evidenceSourceKindSchema = z.enum([
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

export const evidenceReceiptSchema = z
  .object({
    title: z.string().optional(),
    sourceKind: evidenceSourceKindSchema.optional(),
    source: z.string().optional(),
    summary: z.string().optional(),
    claimIds: z.array(z.string()).optional(),
    rawInputRefs: z.array(artifactRefSchema).optional(),
    intermediateRefs: z.array(artifactRefSchema).optional(),
    outputRefs: z.array(artifactRefSchema).optional(),
    metricRefs: z.array(artifactRefSchema).optional(),
    excerpts: z.array(z.string().max(4000)).optional(),
    sampleCount: nonnegativeInteger.optional(),
    reviewer: z.string().optional(),
    reviewedAt: isoDateTime.optional(),
    verdict: z.enum(["supports", "weakens", "mixed", "inconclusive"]).optional(),
    limitations: z.string().optional(),
    refs: z.array(artifactRefSchema).optional(),
    createdAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
  })
  .strict();

export const sourceManifestEntrySchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    kind: z.union([evidenceSourceKindSchema, z.enum(["drive", "chat-export"])]),
    label: z.string(),
    uri: z.string(),
    sha256: z.string().optional(),
    sizeBytes: nonnegativeInteger.optional(),
    mtime: isoDateTime.optional(),
    fetchedAt: isoDateTime.optional(),
    selectedExcerpt: z.string().max(4000).optional(),
    anchors: z
      .array(
        z
          .object({
            label: z.string().optional(),
            selector: z.string(),
            excerpt: z.string().max(4000).optional(),
          })
          .strict(),
      )
      .optional(),
    metadata: z.record(z.unknown()).optional(),
    tags: z.array(z.string()).optional(),
    linkedWikiPages: z.array(z.string()).optional(),
    linkedClaimIds: z.array(z.string()).optional(),
    notes: z.string().optional(),
  })
  .strict();

export const paperSectionPatchSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  baseHash: z.string().regex(/^[a-f0-9]{64}$/i),
  tex: z.string().max(1_000_000),
  level: z.number().int().min(1).max(6).optional(),
  appendix: z.boolean().optional(),
});

export const wikiMetadataPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    summary: z.string().max(4_000),
    tags: z.array(z.string().trim().min(1).max(80)).max(50),
    refs: z.array(artifactRefSchema).max(100),
    pinnedForAgents: z.boolean(),
    htmlMode: z.enum(["static", "interactive"]).optional(),
  })
  .strict();
