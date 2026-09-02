/**
 * OpenBar — TeX-backed content store.
 *
 * All research content lives as human-readable, primary TeX documents and
 * comment-envelope records under `content/projects/<slug>/manuscript/`.
 *
 * This module is server-only (uses node:fs). It is imported by server
 * components, route handlers, and the MCP server — never by client code.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { analyzeDraft } from "./maturity";
import { type BibEntry } from "./bibtex";
import { Idea, Preregistration } from "./research";
import {
  hasTexProject,
  listDocumentIds,
  listRecords,
  readBibliography,
  readBibliographyRaw,
  readDocument,
  readDocumentTex,
  readMindmapRecord,
  listMindmapRecords,
  deleteMindmapRecord,
  readProjectRecord,
  readRecord,
  renamePaperSection,
  setPaperSectionHeading,
  addPaperSection,
  removePaperSection,
  texPaths,
  writeDocument,
  writeMindmapRecord,
  writePaperProject,
  writeProjectRecord,
  writeRecord,
  type PaperSection,
  type TexPaper,
  DRAFT_MINDMAP_ID,
} from "./tex-project/project";
import { TexEnvelopeError, withWriteLock } from "./tex-project/codec";
import { mindmapDiskHash } from "./mindmap/v2";
import { readPaper } from "./research/paper-service";
import { buildSourceBundle } from "./tex-project/source-bundle";
import type { ClientSourceBundle } from "./tex-project/source-bundle-format";
import {
  projectSchema,
} from "./schemas";
import { emptyMindmap, slugifyMindmapId } from "./mindmap-index";
import { composeObtodo } from "./todo-meta";
import { mindmapOutline } from "@/features/mindmap/mindmap-state";
import {
  DailyNote,
  ClaimCard,
  EvidenceReceipt,
  Maturity,
  MaturedDraft,
  Mindmap,
  MicroChallenge,
  MonthlyReview,
  Project,
  SourceManifestEntry,
  SlideDeck,
  WikiPage,
} from "./types";

const CONTENT_ROOT =
  process.env.OPENBARRY_CONTENT || path.join(process.cwd(), "content");

const projectsDir = () => path.join(CONTENT_ROOT, "projects");
const projectDir = (slug: string) => path.join(projectsDir(), safeSegment(slug, "project slug"));

function parseTexRecord<T>(file: string, raw: unknown, schema: z.ZodType<T>): T | null {
  try {
    return schema.parse(raw);
  } catch (error) {
    recordContentDiagnostic(file, error);
    return null;
  }
}

function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`Unsafe ${label}: ${value}`);
  }
  return value;
}

function recordContentDiagnostic(file: string, error: unknown) {
  const issue = error instanceof z.ZodError
    ? error.issues.map((item) => `${item.path.join(".") || "root"}: ${item.message}`).join("; ")
    : error instanceof Error
      ? error.message
      : String(error);
  console.warn(`Invalid content ${file}: ${issue}`);
}

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function fileMtime(file: string): string {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function nowISO(): string {
  return new Date().toISOString();
}

function withCreatedAt<T extends { createdAt?: string; updatedAt?: string }>(
  incoming: T,
  existing?: { createdAt?: string; updatedAt?: string } | null,
  fallback?: string,
): T & { createdAt: string; updatedAt: string } {
  return {
    ...incoming,
    createdAt: incoming.createdAt || existing?.createdAt || existing?.updatedAt || incoming.updatedAt || fallback || nowISO(),
    updatedAt: nowISO(),
  };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function listProjects(): Project[] {
  const dir = projectsDir();
  const slugs = listDir(dir).filter((slug) => hasTexProject(path.join(dir, slug)));
  const projects = slugs
    .map((slug) => getProject(slug))
    .filter((p): p is Project => p != null);
  const order: Record<Project["status"], number> = {
    active: 0,
    incubating: 1,
    submitted: 2,
    paused: 3,
    archived: 4,
  };
  return projects.sort(
    (a, b) =>
      order[a.status] - order[b.status] ||
      (b.updatedAt || "").localeCompare(a.updatedAt || ""),
  );
}

export function getProject(slug: string): Project | null {
  if (typeof slug !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) return null;
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return null;
  return parseTexRecord(texPaths(dir).projectFile, readProjectRecord<unknown>(dir), projectSchema);
}

/** Drop blank optional identity fields so they can be removed from the web UI. */
function persistableProject(project: Project): Project {
  const next: Project = {
    id: project.id,
    slug: project.slug,
    title: project.title.trim() || project.slug,
    tagline: project.tagline.trim(),
    overview: project.overview.trim(),
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    links: Array.isArray(project.links) ? project.links : [],
  };
  if (project.mode) next.mode = project.mode;
  if (project.venue?.trim()) next.venue = project.venue.trim();
  if (project.color?.trim()) next.color = project.color.trim();
  if (project.icon?.trim()) next.icon = project.icon.trim();
  const collaborators = (project.collaborators ?? []).map((name) => name.trim()).filter(Boolean);
  if (collaborators.length) next.collaborators = collaborators;
  if (project.researchKind?.trim()) next.researchKind = project.researchKind.trim();
  if (project.milestones?.length) next.milestones = project.milestones;
  return next;
}

export function saveProject(project: Project): void {
  const dir = projectDir(project.slug);
  const persisted = projectSchema.parse(persistableProject(project));
  writeProjectRecord(dir, persisted);
}

function slugifyProjectId(title: string): string {
  const slug = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug || !/^[a-z0-9]/.test(slug)) throw new Error("Could not make a project slug from that title.");
  return slug;
}

/** Create a new TeX project under content/projects. Web and MCP both use this. */
export function createProject(input: { title: string; slug?: string; tagline?: string }): Project {
  const title = input.title.trim();
  if (!title) throw new Error("A project needs a title.");
  const slug = safeSegment(input.slug?.trim() || slugifyProjectId(title), "project slug");
  const dir = projectDir(slug);
  if (getProject(slug) || (fs.existsSync(dir) && fs.readdirSync(dir).length > 0)) {
    throw new Error(`Project "${slug}" already exists.`);
  }
  const now = nowISO();
  const project: Project = {
    id: slug,
    slug,
    title,
    tagline: (input.tagline || "").trim(),
    overview: "",
    status: "incubating",
    createdAt: now,
    updatedAt: now,
    links: [],
  };
  writeProjectRecord(dir, persistableProject(project));
  writePaperProject(dir, title, [{
    id: "introduction",
    title: "Introduction",
    level: 2,
    order: 0,
    label: "sec-introduction",
    tex: composeObtodo({ text: "Write the opening motivation." }),
  }]);
  writeMindmapRecord(dir, emptyMindmap(slug, {
    id: DRAFT_MINDMAP_ID,
    title: title,
    role: "draft",
    rootText: title,
  }));
  const created = getProject(slug);
  if (!created) throw new Error("Created project could not be read back.");
  return created;
}

// ---------------------------------------------------------------------------
// Mindmap
// ---------------------------------------------------------------------------

export function getMindmap(slug: string, id = DRAFT_MINDMAP_ID): Mindmap | null {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return null;
  return readMindmapRecord(dir, id);
}

export function listMindmaps(slug: string): Mindmap[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  return listMindmapRecords(dir);
}

export function saveMindmap(slug: string, mindmap: Mindmap, expectedDiskHash?: string): void {
  const dir = projectDir(slug);
  const id = mindmap.id || DRAFT_MINDMAP_ID;
  const paths = texPaths(dir);
  const file = id === DRAFT_MINDMAP_ID || id === "mindmap"
    ? paths.mindmapFile
    : path.join(paths.mindmapsDir, `${safeSegment(id, "mindmap id")}.tex`);
  withWriteLock(file, () => {
    if (expectedDiskHash) {
      const current = readMindmapRecord(dir, id);
      const currentHash = current ? mindmapDiskHash(current) : undefined;
      if (!current || currentHash !== expectedDiskHash) {
        throw new TexEnvelopeError(`Mindmap changed on disk${currentHash ? ` (hash ${currentHash})` : ""}. Reload before saving.`);
      }
    }
    writeMindmapRecord(dir, { ...mindmap, projectId: slug });
  });
}

export function createMindmap(slug: string, title: string): Mindmap {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) throw new Error(`Project ${slug} has no primary TeX manuscript.`);
  const base = slugifyMindmapId(title);
  const existing = new Set(listMindmapRecords(dir).map((map) => map.id));
  let id = base === DRAFT_MINDMAP_ID || base === "mindmap" ? `${base}-map` : base;
  let n = 2;
  while (existing.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  const map = emptyMindmap(slug, { id, title: title.trim() || id, role: "planning" });
  writeMindmapRecord(dir, map);
  return readMindmapRecord(dir, id)!;
}

export function deleteMindmap(slug: string, id: string): void {
  deleteMindmapRecord(projectDir(slug), id);
}

export { mindmapOutline, DRAFT_MINDMAP_ID };

// ---------------------------------------------------------------------------
// Drafts (maturing documents)
// ---------------------------------------------------------------------------

export function listDrafts(slug: string): string[] {
  const dir = projectDir(slug);
  return hasTexProject(dir) && fs.existsSync(texPaths(dir).paperFile) ? ["paper"] : [];
}

export function getDraft(slug: string, draftSlug: string): MaturedDraft | null {
  const safeDraftSlug = safeSegment(draftSlug, "draft slug");
  if (safeDraftSlug !== "paper") return null;
  const dir = projectDir(slug);
  const paper = getEditableTexPaper(slug);
  if (!paper) return null;
  const analysis = analyzeDraft(paper.source);
  return {
    projectId: slug,
    slug: "paper",
    title: paper.title,
    source: paper.source,
    sections: analysis.sections,
    completion: analysis.completion,
    overallMaturity: analysis.overallMaturity,
    updatedAt: fileMtime(texPaths(dir).paperFile),
  };
}

/** Composed manuscript TeX without section scoring. Prefer this over getDraft when callers only need source. */
export function getPaperSource(slug: string, draftSlug = "paper"): string | null {
  const safeDraftSlug = safeSegment(draftSlug, "draft slug");
  if (safeDraftSlug !== "paper") return null;
  return getEditableTexPaper(slug)?.source ?? null;
}

export function getEditableTexPaper(slug: string): TexPaper | null {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return null;
  const project = getProject(slug);
  const result = readPaper(dir, slug, project?.title || slug);
  return result.ok ? result.value : null;
}

type PaperEditorState = {
  title: string;
  sections: Array<{
    id: string;
    title: string;
    level: number;
    tex: string;
    hash: string;
    appendix?: boolean;
  }>;
  bundle: ClientSourceBundle;
};

export function getPaperEditorState(slug: string): PaperEditorState | null {
  const paper = getEditableTexPaper(slug);
  if (!paper) return null;
  const bundle = buildSourceBundle(texPaths(projectDir(slug)).manuscriptDir);
  return {
    title: paper.title,
    sections: paper.sections.map((section) => ({
      id: section.id,
      title: section.title,
      level: section.level,
      tex: section.tex,
      hash: section.hash,
      appendix: section.appendix,
    })),
    bundle: {
      rootFile: bundle.rootFile,
      source: bundle.source,
      revision: bundle.revision,
      bundleHash: bundle.bundleHash,
      segments: bundle.segments,
      diagnostics: bundle.diagnostics,
    },
  };
}

function paperTitle(slug: string): string {
  return getProject(slug)?.title || slug;
}

function requireTexDir(slug: string): string {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) throw new Error(`Project ${slug} has no primary TeX manuscript.`);
  return dir;
}

export function renameEditablePaperSection(slug: string, id: string, title: string): TexPaper {
  return renamePaperSection(requireTexDir(slug), paperTitle(slug), id, title);
}

export function setEditablePaperSectionHeading(
  slug: string,
  id: string,
  heading: { level?: number; appendix?: boolean },
): TexPaper {
  return setPaperSectionHeading(requireTexDir(slug), paperTitle(slug), id, heading);
}

export function addEditablePaperSection(
  slug: string,
  spec: { title: string; afterId?: string; level?: number; appendix?: boolean },
): TexPaper {
  return addPaperSection(requireTexDir(slug), paperTitle(slug), spec);
}

export function removeEditablePaperSection(slug: string, id: string): TexPaper {
  return removePaperSection(requireTexDir(slug), paperTitle(slug), id);
}

export function projectContentDir(slug: string): string {
  return projectDir(slug);
}

// ---------------------------------------------------------------------------
// Bibliography
// ---------------------------------------------------------------------------

export function getBibliography(slug: string): BibEntry[] {
  const dir = projectDir(slug);
  return hasTexProject(dir) ? readBibliography(dir) : [];
}

export function getBibliographyRaw(slug: string): string {
  const dir = projectDir(slug);
  return hasTexProject(dir) ? readBibliographyRaw(dir) : "";
}

// ---------------------------------------------------------------------------
// Wiki
// ---------------------------------------------------------------------------

export function listWiki(slug: string): WikiPage[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  return listDocumentIds(dir, "wiki")
    .map((id) => getWikiPage(slug, id))
    .filter((page): page is WikiPage => page !== null);
}

export function getWikiTex(slug: string, pageSlug: string): string | null {
  try {
    const safePageSlug = safeSegment(pageSlug, "wiki page slug");
    const dir = projectDir(slug);
    if (!hasTexProject(dir)) return null;
    return readDocumentTex(dir, "wiki", safePageSlug);
  } catch {
    return null;
  }
}

export function getWikiPage(slug: string, pageSlug: string): WikiPage | null {
  const safePageSlug = safeSegment(pageSlug, "wiki page slug");
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return null;
  const document = readDocument<Record<string, unknown>>(dir, "wiki", safePageSlug);
  if (!document) return null;
  const d = document.metadata as Partial<WikiPage>;
  return {
    projectId: slug,
    slug: safePageSlug,
    title: d.title || safePageSlug,
    summary: d.summary || "",
    body: document.markdown,
    tags: d.tags || [],
    refs: d.refs || [],
    pinnedForAgents: d.pinnedForAgents || false,
    format: document.format || d.format,
    htmlMode: document.htmlMode || d.htmlMode,
    bodyHash: document.hash,
    stateHash: document.stateHash,
    createdAt: d.createdAt || d.updatedAt || fileMtime(document.file),
    updatedAt: d.updatedAt || fileMtime(document.file),
  };
}

export function saveWikiPage(page: WikiPage): void {
  const dir = projectDir(page.projectId);
  const existing = getWikiPage(page.projectId, page.slug);
  const { body, bodyHash: _bodyHash, stateHash: _stateHash, ...metadata } = withCreatedAt({ ...page }, existing);
  writeDocument(dir, "wiki", page.slug, metadata as Record<string, unknown>, body);
}

// ---------------------------------------------------------------------------
// Daily notes
// ---------------------------------------------------------------------------

export function listNotes(slug: string): DailyNote[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  return listDocumentIds(dir, "notes")
    .map((id) => getNote(slug, id))
    .filter((note): note is DailyNote => note !== null)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function getNote(slug: string, date: string): DailyNote | null {
  const safeDate = safeSegment(date, "note date");
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return null;
  const document = readDocument<Record<string, unknown>>(dir, "notes", safeDate);
  if (!document) return null;
  const d = document.metadata as Partial<DailyNote>;
  return {
    projectId: slug,
    date: safeDate,
    body: document.markdown,
    did: d.did,
    next: d.next,
    blockers: d.blockers,
    refs: d.refs || [],
    createdAt: d.createdAt || d.updatedAt || fileMtime(document.file),
    updatedAt: d.updatedAt || fileMtime(document.file),
  };
}

export function saveNote(note: DailyNote): void {
  const dir = projectDir(note.projectId);
  const existing = getNote(note.projectId, note.date);
  const { body, ...metadata } = withCreatedAt({ ...note }, existing);
  writeDocument(dir, "notes", note.date, metadata as Record<string, unknown>, body);
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

export function listSlideDecks(slug: string): SlideDeck[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  return listRecords<SlideDeck>(dir, "slides")
    .map((deck) => ({ ...deck, createdAt: deck.createdAt || deck.updatedAt }))
    .sort((a, b) => b.week.localeCompare(a.week));
}

export function getSlideDeck(slug: string, week: string): SlideDeck | null {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return null;
  const deck = readRecord<SlideDeck>(dir, "slides", safeSegment(week, "slide week"));
  return deck ? { ...deck, createdAt: deck.createdAt || deck.updatedAt } : null;
}

export function saveSlideDeck(deck: SlideDeck): void {
  const dir = projectDir(deck.projectId);
  writeRecord(dir, "slides", deck.week, withCreatedAt(deck, getSlideDeck(deck.projectId, deck.week)));
}

// ---------------------------------------------------------------------------
// Preregistrations & ideas
// ---------------------------------------------------------------------------

export function listPreregs(slug: string): Preregistration[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  return listRecords<Preregistration>(dir, "preregs").sort((a, b) =>
    (b.updatedAt || "").localeCompare(a.updatedAt || ""),
  );
}

export function getPrereg(slug: string, id: string): Preregistration | null {
  return listPreregs(slug).find((p) => p.id === id) || null;
}

export function savePrereg(prereg: Preregistration): void {
  const dir = projectDir(prereg.projectId);
  writeRecord(dir, "preregs", prereg.id, withCreatedAt(prereg, getPrereg(prereg.projectId, prereg.id)));
}

export function listIdeas(slug: string): Idea[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  return listRecords<Idea>(dir, "ideas").sort((a, b) =>
    (b.updatedAt || "").localeCompare(a.updatedAt || ""),
  );
}

export function listIdeaDeposit(): {
  idea: Idea;
  project: Pick<Project, "slug" | "title" | "icon" | "color">;
}[] {
  return listProjects()
    .flatMap((project) =>
      listIdeas(project.slug).map((idea) => ({
        idea,
        project: {
          slug: project.slug,
          title: project.title,
          icon: project.icon,
          color: project.color,
        },
      })),
    )
    .sort((a, b) => (b.idea.updatedAt || "").localeCompare(a.idea.updatedAt || ""));
}

export function saveIdea(slug: string, idea: Idea): void {
  const dir = projectDir(slug);
  const existing = listIdeas(slug).find((item) => item.id === idea.id) || null;
  writeRecord(dir, "ideas", idea.id, withCreatedAt(idea, existing));
}

// ---------------------------------------------------------------------------
// Research graph: claims, evidence, challenges, monthly reviews
// ---------------------------------------------------------------------------

export function listClaims(slug: string): ClaimCard[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  return listRecords<ClaimCard>(dir, "claims")
    .map((claim) => ({ ...claim, createdAt: claim.createdAt || claim.updatedAt }))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function getClaim(slug: string, id: string): ClaimCard | null {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return null;
  const claim = readRecord<ClaimCard>(dir, "claims", safeSegment(id, "claim id"));
  return claim ? { ...claim, createdAt: claim.createdAt || claim.updatedAt } : null;
}

export function saveClaim(claim: ClaimCard): void {
  const dir = projectDir(claim.projectId);
  writeRecord(dir, "claims", claim.id, withCreatedAt(claim, getClaim(claim.projectId, claim.id)));
}

export function listEvidence(slug: string): EvidenceReceipt[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  return listRecords<EvidenceReceipt>(dir, "evidence")
    .map((evidence) => ({ ...evidence, createdAt: evidence.createdAt || evidence.updatedAt }))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function getEvidence(slug: string, id: string): EvidenceReceipt | null {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return null;
  const evidence = readRecord<EvidenceReceipt>(dir, "evidence", safeSegment(id, "evidence id"));
  return evidence ? { ...evidence, createdAt: evidence.createdAt || evidence.updatedAt } : null;
}

export function saveEvidence(evidence: EvidenceReceipt): void {
  const dir = projectDir(evidence.projectId);
  writeRecord(dir, "evidence", evidence.id, withCreatedAt(evidence, getEvidence(evidence.projectId, evidence.id)));
}

export function listSourceManifest(slug: string): SourceManifestEntry[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  return listRecords<SourceManifestEntry>(dir, "sources").sort((a, b) =>
    (b.fetchedAt || b.mtime || "").localeCompare(a.fetchedAt || a.mtime || ""),
  );
}

export function saveSourceManifestEntry(slug: string, entry: SourceManifestEntry): void {
  const dir = projectDir(slug);
  writeRecord(dir, "sources", entry.id, { ...entry, projectId: slug });
}

export function listChallenges(slug: string): MicroChallenge[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  return listRecords<MicroChallenge>(dir, "challenges").sort((a, b) =>
    (b.lastRaisedAt || b.createdAt || "").localeCompare(a.lastRaisedAt || a.createdAt || ""),
  );
}

export function saveChallenge(slug: string, challenge: MicroChallenge): void {
  const dir = projectDir(slug);
  writeRecord(dir, "challenges", challenge.id, { ...challenge, projectId: slug });
}

export function listMonthlyReviews(slug: string): MonthlyReview[] {
  const dir = projectDir(slug);
  if (!hasTexProject(dir)) return [];
  return listRecords<MonthlyReview>(dir, "monthly-reviews").map(normalizeMonthlyReview).sort((a, b) =>
    b.month.localeCompare(a.month),
  );
}

export function saveMonthlyReview(review: MonthlyReview): void {
  const dir = projectDir(review.projectId);
  writeRecord(dir, "monthly-reviews", review.month, { ...normalizeMonthlyReview(review), updatedAt: nowISO() });
}

function normalizeMonthlyReview(review: MonthlyReview): MonthlyReview {
  const { daphneAsk, discussionAsk, ...rest } = review;
  const resolvedDiscussionAsk = discussionAsk || daphneAsk;
  return {
    ...rest,
    ...(resolvedDiscussionAsk ? { discussionAsk: resolvedDiscussionAsk } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function projectMaturitySummary(slug: string): {
  drafts: { slug: string; title: string; completion: number; maturity: Maturity }[];
  avgCompletion: number;
} {
  const drafts = listDrafts(slug)
    .map((d) => getDraft(slug, d))
    .filter((d): d is MaturedDraft => d != null)
    .map((d) => ({
      slug: d.slug,
      title: d.title,
      completion: d.completion,
      maturity: d.overallMaturity,
    }));
  const avgCompletion =
    drafts.length > 0
      ? drafts.reduce((s, d) => s + d.completion, 0) / drafts.length
      : 0;
  return { drafts, avgCompletion };
}
