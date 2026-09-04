import { z } from "zod";

import { safeUrl } from "@/lib/safe-url";

const isoDateTime = z.string().datetime({ offset: true });

export const artifactRefSchema = z
  .object({
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
    todoId: z.string().optional(),
    parentId: z.string().nullable(),
    shape: z.enum(["root", "branch", "leaf", "note", "callout"]).optional(),
    collapsed: z.boolean().optional(),
    metadata: z.record(z.unknown()).optional(),
    contentFormat: z.enum(["plain", "markdown", "tex"]).optional(),
    color: z.string().optional(),
    tags: z.array(z.string()).optional(),
    progress: z.number().int().min(0).max(6).optional(),
    refs: z.array(artifactRefSchema).optional(),
    order: z.number().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .strip();
