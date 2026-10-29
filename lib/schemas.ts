import { z } from "zod";

import { safeUrl } from "@/lib/safe-url";
import { captionWithinLimit } from "@/lib/mindmap/card-content";

const isoDateTime = z.string().datetime({ offset: true });

const paperSectionRefContextSchema = z.object({
  file: z.string().max(1_000).optional(),
  title: z.string().max(2_000).optional(),
  level: z.number().int().min(1).max(6).optional(),
  headingPath: z.array(z.string().max(2_000)).max(32).optional(),
  bodyHash: z.string().max(200).optional(),
  label: z.string().max(1_000).optional(),
  sourceHash: z.string().max(200).optional(),
  sourceRange: z.object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
  }).optional(),
  order: z.number().int().min(0).optional(),
}).strip();

export const artifactRefSchema = z
  .object({
    imageWidth: z.number().int().min(25).max(100).optional(),
    kind: z.enum([
      "project",
      "paper-section",
      "paper-todo",
      "paper-comment",
      "wiki-page",
      "mindmap-node",
      "figure",
      "web",
      "external",
    ]),
    id: z.string(),
    label: z.string().optional(),
    url: z.string().max(2_000).optional(),
    mapId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).optional(),
    sectionContext: paperSectionRefContextSchema.optional(),
  })
  .strip()
  .superRefine((ref, context) => {
    const validHttpUrl = (value: string | undefined) => Boolean(value && /^https?:\/\//i.test(value.trim()) && safeUrl(value));
    if (ref.url && !validHttpUrl(ref.url)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["url"], message: "Reference URLs require http(s)." });
    }
    if (ref.kind === "web" && !validHttpUrl(ref.url || ref.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["id"], message: "Web references require an http(s) URL." });
    }
  });

export const projectSchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    title: z.string(),
    researchKind: z.string().optional(),
    tagline: z.string().default(""),
    overview: z.string().default(""),
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
          kind: z.enum(["overleaf", "latex", "arxiv", "web", "repo"]),
        })
        .strip(),
    ).default([]),
    collaborators: z.array(z.string()).optional(),
    archivedAt: isoDateTime.optional(),
    label: z.string().optional(),
    engine: z.enum(["pdflatex", "xelatex", "lualatex"]).optional(),
    mainFile: z.string().regex(/^[A-Za-z0-9._/-]+$/).optional(),
    texliveVersion: z.string().max(120).optional(),
  })
  .strip();

export const paperSectionPatchSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  baseHash: z.string().regex(/^[a-f0-9]{64}$/i),
  tex: z.string().max(1_000_000),
  level: z.number().int().min(1).max(6).optional(),
  appendix: z.boolean().optional(),
});

export const wikiMetadataPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  })
  .strip();

export const mindmapNodeSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    text: z.string().default(""),
    caption: z.string().max(20_000).refine(captionWithinLimit, "Card notes must be 500 words or fewer.").optional(),
    caution: z.object({
      critical: z.string().optional(),
      important: z.string().optional(),
      minor: z.string().optional(),
      background: z.string().optional(),
    }).strict().optional(),
    todoId: z.string().optional(),
    parentId: z.string().nullable(),
    shape: z.enum(["root", "branch", "leaf", "note", "callout"]).optional(),
    agentDraft: z.boolean().optional(),
    metadata: z.record(z.unknown()).optional(),
    contentFormat: z.enum(["plain", "markdown", "tex"]).optional(),
    tableLayout: z.enum(["wide", "scroll"]).optional(),
    color: z.string().optional(),
    tags: z.array(z.string()).optional(),
    progress: z.number().int().min(0).max(6).optional(),
    priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
    refs: z.array(artifactRefSchema).refine(refs => refs.filter(ref => ref.kind === "figure").length <= 1, "Each card holds one image. Add child cards for additional images.").optional(),
    order: z.number().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .strip();
