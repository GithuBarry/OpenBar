#!/usr/bin/env tsx
/**
 * Non-destructive-by-default migration from OpenBar's legacy JSON/Markdown
 * content tree into primary TeX files. Run `pnpm migrate:tex -- --dry-run`
 * before `--apply`; `--apply` only removes legacy inputs after a candidate has
 * been read back, inventory-checked, and compiled.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import matter from "gray-matter";

import {
  ensureTexProjectDirectories,
  hasTexProject,
  readBibliographyRaw,
  readMindmapRecord,
  readProjectRecord,
  readTexPaper,
  texPaths,
  writeBibliographyRaw,
  writeDocument,
  writeMindmapRecord,
  writePaperProject,
  writeProjectRecord,
  writeRecord,
} from "../lib/tex-project/project";
import { markdownToTex } from "../lib/tex-project/obmd";
import type {
  ClaimCard,
  DailyNote,
  EvidenceReceipt,
  MicroChallenge,
  Mindmap,
  MonthlyReview,
  Project,
  SlideDeck,
  SourceManifestEntry,
  WikiPage,
} from "../lib/types";
import type { Idea, Preregistration } from "../lib/research";

const CONTENT_ROOT = process.env.OPENBARRY_CONTENT || path.join(process.cwd(), "content");
const PROJECTS_DIR = path.join(CONTENT_ROOT, "projects");

interface Args {
  apply: boolean;
  retireLegacy: boolean;
  all: boolean;
  project?: string;
}

interface Inventory {
  project: number;
  mindmap: number;
  sections: number;
  citationsHash: string;
  wiki: number;
  notes: number;
  slides: number;
  preregs: number;
  ideas: number;
  claims: number;
  evidence: number;
  sources: number;
  challenges: number;
  monthlyReviews: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, retireLegacy: false, all: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]!;
    if (value === "--") continue;
    if (value === "--apply") args.apply = true;
    else if (value === "--retire-legacy") args.retireLegacy = true;
    else if (value === "--dry-run") args.apply = false;
    else if (value === "--all") args.all = true;
    else if (value === "--project") args.project = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!args.all && !args.project) throw new Error("Specify --project <slug> or --all.");
  if (args.apply && args.retireLegacy) throw new Error("Run --apply first, verify the cutover, then run --retire-legacy separately.");
  return args;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(`Could not parse ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function listFiles(dir: string, extension: string): string[] {
  try {
    return fs.readdirSync(dir).filter((file) => file.endsWith(extension)).sort();
  } catch {
    return [];
  }
}

function now(): string {
  return new Date().toISOString();
}

function legacyProject(dir: string): Project {
  return readJson<Project>(path.join(dir, "project.json"), null as unknown as Project);
}

function readLegacyMindmap(dir: string): Mindmap {
  return readJson<Mindmap>(path.join(dir, "mindmap.json"), null as unknown as Mindmap);
}

function markdownSections(source: string, title: string) {
  const parsed = matter(source);
  const lines = parsed.content.replace(/\r\n/g, "\n").split("\n");
  const sections: { id: string; title: string; level: 1 | 2 | 3 | 4 | 5 | 6; order: number; label: string; markdown: string }[] = [];
  let current: { title: string; level: number; body: string[] } | null = null;
  let sequence = 0;

  const flush = () => {
    if (!current) return;
    const slug = uniqueSectionId(`sec-${slugify(current.title) || "section"}`, sections.map((section) => section.id));
    const level = Math.min(Math.max(current.level, 2), 6) as 1 | 2 | 3 | 4 | 5 | 6;
    sections.push({
      id: slug,
      title: current.title,
      level,
      order: sequence++,
      label: slug,
      markdown: current.body.join("\n").trim(),
    });
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading && heading[1]!.length >= 2) {
      flush();
      current = { title: heading[2]!.replace(/\s+\{[^}]*\}\s*$/, "").trim(), level: heading[1]!.length, body: [] };
      continue;
    }
    if (heading && heading[1]!.length === 1 && !current) continue; // document title
    if (!current) {
      // Preserve preamble prose by placing it in an explicit introduction.
      current = { title: "Introduction", level: 2, body: [] };
    }
    current.body.push(line);
  }
  flush();
  if (!sections.length) {
    sections.push({ id: "sec-body", title: "Manuscript", level: 2, order: 0, label: "sec-body", markdown: parsed.content.trim() });
  }
  return { title: String(parsed.data.title || title), sections };
}

function uniqueSectionId(candidate: string, existing: string[]): string {
  if (!existing.includes(candidate)) return candidate;
  let suffix = 2;
  while (existing.includes(`${candidate}-${suffix}`)) suffix += 1;
  return `${candidate}-${suffix}`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parsedFrontMatter(file: string): { data: Record<string, unknown>; body: string } {
  const result = matter(fs.readFileSync(file, "utf8"));
  return { data: result.data as Record<string, unknown>, body: result.content.trim() };
}

function migrateClaim(project: string, id: string, file: string): ClaimCard {
  const { data, body } = parsedFrontMatter(file);
  return {
    projectId: project,
    id,
    title: String(data.title || id),
    claim: String(data.claim || body),
    state: (data.state as ClaimCard["state"]) || "hypothesis",
    maturity: (data.maturity as ClaimCard["maturity"]) || "hypothesized",
    evidenceIds: asStrings(data.evidenceIds),
    objectionIds: asStrings(data.objectionIds),
    refs: (data.refs as ClaimCard["refs"]) || [],
    createdAt: String(data.createdAt || data.updatedAt || now()),
    updatedAt: String(data.updatedAt || now()),
    ...(omitUndefined({
      paperSection: data.paperSection,
      confidence: data.confidence,
      scope: data.scope,
      owner: data.owner,
      currentWeakness: data.currentWeakness,
      nextAction: data.nextAction,
      lastCheckedAt: data.lastCheckedAt,
    }) as Partial<ClaimCard>),
  };
}

function migrateEvidence(project: string, id: string, file: string): EvidenceReceipt {
  const { data, body } = parsedFrontMatter(file);
  return {
    projectId: project,
    id,
    title: String(data.title || id),
    sourceKind: (data.sourceKind as EvidenceReceipt["sourceKind"]) || "external",
    source: String(data.source || ""),
    summary: String(data.summary || body),
    claimIds: asStrings(data.claimIds),
    rawInputRefs: (data.rawInputRefs as EvidenceReceipt["rawInputRefs"]) || [],
    intermediateRefs: (data.intermediateRefs as EvidenceReceipt["intermediateRefs"]) || [],
    outputRefs: (data.outputRefs as EvidenceReceipt["outputRefs"]) || [],
    metricRefs: (data.metricRefs as EvidenceReceipt["metricRefs"]) || [],
    excerpts: asStrings(data.excerpts),
    refs: (data.refs as EvidenceReceipt["refs"]) || [],
    createdAt: String(data.createdAt || data.updatedAt || now()),
    updatedAt: String(data.updatedAt || now()),
    ...(omitUndefined({
      sampleCount: data.sampleCount,
      reviewer: data.reviewer,
      reviewedAt: data.reviewedAt,
      verdict: data.verdict,
      limitations: data.limitations,
    }) as Partial<EvidenceReceipt>),
  };
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function omitUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined));
}

function legacyInventory(dir: string): Inventory {
  const paper = path.join(dir, "drafts", "paper.md");
  const project = legacyProject(dir);
  const sections = fs.existsSync(paper) ? markdownSections(fs.readFileSync(paper, "utf8"), project.title).sections.length : 0;
  return {
    project: 1,
    mindmap: readLegacyMindmap(dir) ? 1 : 0,
    sections,
    citationsHash: hashFile(path.join(dir, "references.bib")),
    wiki: listFiles(path.join(dir, "wiki"), ".md").length,
    notes: listFiles(path.join(dir, "notes"), ".md").length,
    slides: listFiles(path.join(dir, "slides"), ".json").length,
    preregs: readJson<Preregistration[]>(path.join(dir, "preregistrations.json"), []).length,
    ideas: readJson<Idea[]>(path.join(dir, "ideas.json"), []).length,
    claims: listFiles(path.join(dir, "claims"), ".md").length,
    evidence: listFiles(path.join(dir, "evidence"), ".md").length,
    sources: readJson<SourceManifestEntry[]>(path.join(dir, "artifacts", "sources.json"), []).length,
    challenges: readJson<MicroChallenge[]>(path.join(dir, "challenges.json"), []).length,
    monthlyReviews: readJson<MonthlyReview[]>(path.join(dir, "monthly-reviews.json"), []).length,
  };
}

function texInventory(stageDir: string, slug: string, title: string): Inventory {
  const paper = readTexPaper(stageDir, slug, title);
  return {
    project: readProjectRecord<Project>(stageDir) ? 1 : 0,
    mindmap: readMindmapRecord(stageDir) ? 1 : 0,
    sections: paper?.sections.length || 0,
    citationsHash: hashText(readBibliographyRaw(stageDir)),
    wiki: countDocuments(stageDir, "wiki"),
    notes: countDocuments(stageDir, "notes"),
    slides: countRecords(stageDir, "slides"),
    preregs: countRecords(stageDir, "preregs"),
    ideas: countRecords(stageDir, "ideas"),
    claims: countRecords(stageDir, "claims"),
    evidence: countRecords(stageDir, "evidence"),
    sources: countRecords(stageDir, "sources"),
    challenges: countRecords(stageDir, "challenges"),
    monthlyReviews: countRecords(stageDir, "monthly-reviews"),
  };
}

function countRecords(stageDir: string, collection: string): number {
  try {
    return fs.readdirSync(path.join(texPaths(stageDir).openbarryDir, collection)).filter((file) => file.endsWith(".tex")).length;
  } catch {
    return 0;
  }
}

function countDocuments(stageDir: string, kind: "wiki" | "notes"): number {
  const dir = kind === "wiki" ? texPaths(stageDir).wikiDir : texPaths(stageDir).notesDir;
  try {
    return fs.readdirSync(dir).filter((file) => file.endsWith(".tex")).length;
  } catch {
    return 0;
  }
}

function hashFile(file: string): string {
  try {
    return hashText(fs.readFileSync(file, "utf8"));
  } catch {
    return hashText("");
  }
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function inventoriesMatch(left: Inventory, right: Inventory): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function migrateOne(sourceDir: string, stageDir: string, slug: string): { before: Inventory; after: Inventory; compile: Record<string, unknown> } {
  const project = legacyProject(sourceDir);
  if (!project) throw new Error(`${sourceDir} has no project.json.`);
  const mindmap = readLegacyMindmap(sourceDir);
  if (!mindmap) throw new Error(`${sourceDir} has no mindmap.json.`);
  ensureTexProjectDirectories(stageDir);
  writeProjectRecord(stageDir, project);
  writeMindmapRecord(stageDir, mindmap);

  const paperFile = path.join(sourceDir, "drafts", "paper.md");
  const source = fs.existsSync(paperFile) ? fs.readFileSync(paperFile, "utf8") : `# ${project.title}\n`;
  const paper = markdownSections(source, project.title);
  writePaperProject(stageDir, paper.title, paper.sections.map((section) => ({
    ...section,
    tex: markdownToTex(section.markdown),
  })));
  const bibliographyFile = path.join(sourceDir, "references.bib");
  writeBibliographyRaw(stageDir, fs.existsSync(bibliographyFile) ? fs.readFileSync(bibliographyFile, "utf8") : "");

  for (const file of listFiles(path.join(sourceDir, "wiki"), ".md")) {
    const id = file.slice(0, -3);
    const { data, body } = parsedFrontMatter(path.join(sourceDir, "wiki", file));
    const page: WikiPage = {
      projectId: slug,
      slug: id,
      title: String(data.title || id),
      summary: String(data.summary || ""),
      body,
      tags: asStrings(data.tags),
      refs: (data.refs as WikiPage["refs"]) || [],
      pinnedForAgents: Boolean(data.pinnedForAgents),
      createdAt: String(data.createdAt || data.updatedAt || now()),
      updatedAt: String(data.updatedAt || now()),
    };
    const { body: _body, ...metadata } = page;
    writeDocument(stageDir, "wiki", id, metadata, body);
  }

  for (const file of listFiles(path.join(sourceDir, "notes"), ".md")) {
    const id = file.slice(0, -3);
    const { data, body } = parsedFrontMatter(path.join(sourceDir, "notes", file));
    const note: DailyNote = {
      projectId: slug,
      date: id,
      body,
      did: asStrings(data.did),
      next: asStrings(data.next),
      blockers: asStrings(data.blockers),
      refs: (data.refs as DailyNote["refs"]) || [],
      createdAt: String(data.createdAt || data.updatedAt || now()),
      updatedAt: String(data.updatedAt || now()),
    };
    const { body: _body, ...metadata } = note;
    writeDocument(stageDir, "notes", id, metadata, body);
  }

  for (const deck of readJson<SlideDeck[]>(path.join(sourceDir, "slides", "index.json"), [])) {
    writeRecord(stageDir, "slides", deck.week, deck);
  }
  for (const file of listFiles(path.join(sourceDir, "slides"), ".json")) {
    const deck = readJson<SlideDeck | null>(path.join(sourceDir, "slides", file), null);
    if (deck) writeRecord(stageDir, "slides", deck.week, deck);
  }

  for (const prereg of readJson<Preregistration[]>(path.join(sourceDir, "preregistrations.json"), [])) writeRecord(stageDir, "preregs", prereg.id, prereg);
  for (const idea of readJson<Idea[]>(path.join(sourceDir, "ideas.json"), [])) writeRecord(stageDir, "ideas", idea.id, idea);

  for (const file of listFiles(path.join(sourceDir, "claims"), ".md")) {
    const id = file.slice(0, -3);
    writeRecord(stageDir, "claims", id, migrateClaim(slug, id, path.join(sourceDir, "claims", file)));
  }
  for (const file of listFiles(path.join(sourceDir, "evidence"), ".md")) {
    const id = file.slice(0, -3);
    writeRecord(stageDir, "evidence", id, migrateEvidence(slug, id, path.join(sourceDir, "evidence", file)));
  }
  for (const sourceEntry of readJson<SourceManifestEntry[]>(path.join(sourceDir, "artifacts", "sources.json"), [])) writeRecord(stageDir, "sources", sourceEntry.id, sourceEntry);
  for (const challenge of readJson<MicroChallenge[]>(path.join(sourceDir, "challenges.json"), [])) writeRecord(stageDir, "challenges", challenge.id, challenge);
  for (const review of readJson<MonthlyReview[]>(path.join(sourceDir, "monthly-reviews.json"), [])) writeRecord(stageDir, "monthly-reviews", review.month, review);

  const before = legacyInventory(sourceDir);
  const after = texInventory(stageDir, slug, project.title);
  if (!inventoriesMatch(before, after)) throw new Error(`Inventory mismatch for ${slug}:\nlegacy=${JSON.stringify(before)}\ntex=${JSON.stringify(after)}`);
  const compile = compileCandidate(stageDir);
  if (compile.state === "error") throw new Error(`Candidate ${slug} did not compile:\n${String(compile.output)}`);
  return { before, after, compile };
}

function compileCandidate(projectDir: string): Record<string, unknown> {
  const paths = texPaths(projectDir);
  const buildDir = path.join(projectDir, ".build");
  fs.mkdirSync(buildDir, { recursive: true });
  const run = spawnSync("latexmk", ["-pdf", "-interaction=nonstopmode", "-file-line-error", "-no-shell-escape", `-outdir=${buildDir}`, "paper.tex"], {
    cwd: paths.manuscriptDir,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (run.error && (run.error as NodeJS.ErrnoException).code === "ENOENT") return { state: "unavailable", output: "latexmk not installed" };
  const output = `${run.stdout || ""}\n${run.stderr || ""}`.trim();
  return { state: run.status === 0 && fs.existsSync(path.join(buildDir, "paper.pdf")) ? "success" : "error", output: output.slice(-6000) };
}

function removeLegacySources(dir: string): void {
  const remove = [
    "project.json", "mindmap.json", "mindmap.md", "references.bib", "preregistrations.json", "ideas.json", "challenges.json", "monthly-reviews.json",
    "drafts", "wiki", "notes", "slides", "claims", "evidence",
  ];
  for (const relative of remove) fs.rmSync(path.join(dir, relative), { recursive: true, force: true });
  fs.rmSync(path.join(dir, "artifacts", "sources.json"), { force: true });
  removeEmpty(path.join(dir, "artifacts"));
  removeEmpty(dir);
}

function removeEmpty(dir: string): void {
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // no-op
  }
}

function unknownLegacyFiles(dir: string): string[] {
  const known = new Set([
    "project.json", "mindmap.json", "mindmap.md", "references.bib", "preregistrations.json", "ideas.json", "challenges.json", "monthly-reviews.json",
  ]);
  const knownDirs = new Set(["drafts", "wiki", "notes", "slides", "claims", "evidence", "artifacts", "manuscript", ".openbarry"]);
  const unknown: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === ".DS_Store") continue;
    if (known.has(name) || knownDirs.has(name)) continue;
    unknown.push(name);
  }
  return unknown;
}

function retireLegacyProject(sourceDir: string, slug: string): void {
  if (!hasTexProject(sourceDir)) {
    throw new Error(`Cannot retire legacy sources for ${slug}: no primary TeX manuscript exists. Run --apply first.`);
  }
  const project = legacyProject(sourceDir) || readProjectRecord<Project>(sourceDir);
  if (!project) throw new Error(`Could not find project metadata for ${slug}.`);
  const paper = path.join(sourceDir, "drafts", "paper.md");
  const hasLegacyFiles = fs.existsSync(path.join(sourceDir, "project.json")) || fs.existsSync(paper);
  if (!hasLegacyFiles) {
    console.log(`legacy sources already retired for ${slug}`);
    return;
  }
  const before = legacyInventory(sourceDir);
  const after = texInventory(sourceDir, slug, project.title);
  if (!inventoriesMatch(before, after)) {
    throw new Error(`Cannot retire legacy sources: inventory mismatch for ${slug}:\nlegacy=${JSON.stringify(before)}\ntex=${JSON.stringify(after)}`);
  }
  removeLegacySources(sourceDir);
  console.log(`retired legacy sources for ${slug}`);
}

function migrateProject(sourceDir: string, slug: string, apply: boolean): void {
  const unknown = unknownLegacyFiles(sourceDir);
  if (unknown.length) throw new Error(`${slug} has unknown top-level files; refusing to migrate: ${unknown.join(", ")}`);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `openbarry-tex-${slug}-`));
  const stageDir = path.join(tempRoot, slug);
  try {
    const result = migrateOne(sourceDir, stageDir, slug);
    const report = { slug, applied: apply, generatedAt: now(), ...result };
    const reportDir = path.join(sourceDir, ".openbarry", "migration-reports");
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, `tex-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`${apply ? "migrated" : "validated"} ${slug}: ${JSON.stringify(result.after)}`);
    if (!apply) return;
    const target = texPaths(sourceDir).manuscriptDir;
    if (fs.existsSync(target)) throw new Error(`${slug} already has manuscript/; refusing to overwrite it.`);
    fs.renameSync(texPaths(stageDir).manuscriptDir, target);
    console.log(`manuscript/ created for ${slug}. Legacy files retained for verification. Run with --retire-legacy when ready.`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const slugs = args.all
    ? fs.readdirSync(PROJECTS_DIR).filter((slug) => fs.existsSync(path.join(PROJECTS_DIR, slug, "project.json")) || hasTexProject(path.join(PROJECTS_DIR, slug))).sort()
    : [args.project!];
  if (!slugs.length) throw new Error("No projects found to migrate.");
  for (const slug of slugs) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) throw new Error(`Unsafe project slug: ${slug}`);
    const sourceDir = path.join(PROJECTS_DIR, slug);
    if (args.retireLegacy) {
      retireLegacyProject(sourceDir, slug);
    } else {
      migrateProject(sourceDir, slug, args.apply);
    }
  }
}

main();
