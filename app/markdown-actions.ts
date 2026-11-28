"use server";

import path from "node:path";
import { existsSync } from "node:fs";
import { projectContentDir, getProjectMetadata, getMindmap } from "@/lib/store";
import { MARKDOWN_MANUSCRIPT_PATH, type MarkdownAnchor } from "@/lib/markdown-manuscript";
import { prepareMarkdownAnnotation, prepareNoteChange, readManuscriptFile, readMarkdownNotes, type ManuscriptFile, type ManuscriptNote } from "@/lib/research/markdown-workspace";
import { requireProjectAccess } from "@/lib/server/project-access";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { isViewOnlyMode } from "@/lib/server/view-only";
import { applyProjectEditsAction } from "./actions";

export async function openMarkdownAction(slug: string, file: string) {
  await requireProjectAccess(slug);
  if (!MARKDOWN_MANUSCRIPT_PATH.test(file)) throw new Error("Choose a project-relative Markdown filename.");
  const project = getProjectMetadata(slug);
  if (!project || ((isPublicDemoMode() || isViewOnlyMode()) && file !== project.markdownFile)) throw new Error("This manuscript is unavailable.");
  const root = projectContentDir(slug);
  const post = existsSync(path.join(root, file)) ? readManuscriptFile(root, file) : { path: file, source: "", hash: null };
  const cards = (getMindmap(slug)?.nodes ?? []).flatMap(n => n.todoId ? [{ todoId: n.todoId, id: n.id }] : []);
  return { post, notes: readMarkdownNotes(root), cards, projectHash: project.diskHash };
}

export async function annotateMarkdownAction(slug: string, post: ManuscriptFile, at: number, kind: MarkdownAnchor["kind"], text: string) {
  await requireProjectAccess(slug);
  if (isPublicDemoMode() || isViewOnlyMode()) throw new Error("Annotations require an editable workspace.");
  const prepared = prepareMarkdownAnnotation(projectContentDir(slug), post, at, kind, text);
  const result = await applyProjectEditsAction(slug, { edits: prepared.edits });
  if (!result.ok) throw new Error(result.message);
  return { id: prepared.id, source: prepared.source, hash: result.value.files.find(f => f.path === post.path)!.hash! };
}

export async function updateMarkdownNoteAction(slug: string, before: ManuscriptNote, text: string, completed?: boolean) {
  await requireProjectAccess(slug);
  if (isPublicDemoMode() || isViewOnlyMode()) throw new Error("Annotations require an editable workspace.");
  const edit = prepareNoteChange(projectContentDir(slug), before.id, before.text, before.completed, text, completed);
  const r = await applyProjectEditsAction(slug, { edits: [edit] });
  if (!r.ok) throw new Error(r.message);
}
