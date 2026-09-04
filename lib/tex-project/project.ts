import fs from "node:fs";
import path from "node:path";

import { type BibEntry } from "@/lib/bibtex";
import { parseBibtexCitationJs, formatBibliographyHtml } from "@/lib/citation";
import type { Mindmap } from "@/lib/types";
import { normalizeMindmapProgress } from "@/lib/mindmap/progress";

import {
  getDataBlock,
  getEditBlock,
  normalizeTexBody,
  parseSectionMeta,
  patchEditBlock,
  readDataFile,
  safeFileSegment,
  serializeDataFile,
  serializeEditBlock,
  serializeSectionMeta,
  sha256,
  upsertDataBlock,
  withWriteLock,
  writeDataFile,
  writeEditBlock,
  writeTextAtomic,
  type SectionMeta,
  TexEnvelopeError,
} from "./codec";
import { figureToTex } from "./obmd";
import { composePaperTex, looksLikeMarkdownPaper, PAPER_REFERENCES_INPUT, readTexDocumentTitle, sectionCommandForLevel, splitPaperTex } from "./paper-compose";
import { prepareDocumentBody, inferDocumentFormat } from "./document-body";
import { locateTexRoot, traverseInputGraph } from "./source-graph";
import { normalizeTeXInputPath } from "./source-bundle-format";
import {
  detachSectionFile,
  hashFile,
  patchSectionHeadingFile,
  patchSectionTitleFile,
  requireManagedManuscript,
  safeSectionFilename,
  sectionInputLine,
  withPaperStructureLock,
  writeNewSectionFile,
} from "./structural-edits";
import { escapeTexText, paperTitleCommand } from "./tex-encode";
import { resolveProjectAsset, ASSET_EXTENSIONS } from "./asset-resolver";
import { mindmapDiskHash } from "@/lib/mindmap/mindmap";

export const TEX_SCHEMAS = {
  project: "openbarry/project@1",
  mindmap: "openbarry/mindmap@1",
  bibliography: "openbarry/bibliography@1",
  record: "openbarry/record@1",
  document: "openbarry/document@1",
  /** Frozen envelope id. Paper and TeX document edit-block bodies are TeX. */
  markdown: "openbarry/markdown@1",
} as const;

export interface TexPaths {
  projectDir: string;
  manuscriptDir: string;
  paperFile: string;
  styleFile: string;
  sectionsDir: string;
  openBarDir: string;
  projectFile: string;
  mindmapFile: string;
  bibliographyFile: string;
  figuresDir: string;
  wikiDir: string;
  mindmapsDir: string;
  buildDir: string;
}

export interface PaperSection extends SectionMeta {
  file: string;
  tex: string;
  hash: string;
}

export interface TexPaper {
  projectId: string;
  title: string;
  source: string;
  /** The declared root file, retained for raw-source consumers. */
  rootSource?: string;
  sourceHash: string;
  sections: PaperSection[];
}

export interface StoredDocument<T extends Record<string, unknown>> {
  metadata: T;
  markdown: string;
  /** SHA-256 of stored body bytes, useful for content-only comparisons. */
  hash: string;
  /** SHA-256 of the body together with its saved document envelope. */
  stateHash: string;
  file: string;
  format?: "tex" | "markdown" | "html";
}

export interface BibliographyRecord {
  raw: string;
  updatedAt: string;
}

function hasSupportedTexDocument(manuscriptDir: string): boolean {
  const paperFile = locateTexRoot(manuscriptDir);
  try {
    const source = fs.readFileSync(paperFile, "utf8");
    return /\\documentclass\b/.test(source) || /\\begin\s*\{document\}/.test(source);
  } catch {
    return false;
  }
}

function useCanonicalLayout(projectDir: string): boolean {
  return hasSupportedTexDocument(projectDir)
    || !hasSupportedTexDocument(path.join(projectDir, "manuscript"));
}

export function texPaths(projectDir: string): TexPaths {
  const canonical = useCanonicalLayout(projectDir);
  const manuscriptDir = canonical ? projectDir : path.join(projectDir, "manuscript");
  const openBarDir = canonical ? path.join(projectDir, ".OpenBar") : path.join(manuscriptDir, "openbarry");
  // `paper.tex` remains the initialization default. Existing projects may
  // declare `main.tex`, `ms.tex`, or another document root discovered by the
  // source graph.
  const paperFile = locateTexRoot(manuscriptDir);
  return {
    projectDir,
    manuscriptDir,
    paperFile,
    styleFile: path.join(manuscriptDir, "openbarry.sty"),
    sectionsDir: path.join(manuscriptDir, "sections"),
    openBarDir,
    projectFile: path.join(openBarDir, "project.tex"),
    mindmapFile: path.join(openBarDir, "mindmap.tex"),
    bibliographyFile: path.join(openBarDir, "references.tex"),
    figuresDir: path.join(manuscriptDir, "figures"),
    wikiDir: canonical ? path.join(projectDir, ".OpenBar", "wiki") : path.join(manuscriptDir, "wiki"),
    mindmapsDir: path.join(openBarDir, "mindmaps"),
    buildDir: canonical
      ? path.join(projectDir, ".OpenBar", "build")
      : path.join(projectDir, ".openbarry", "build"),
  };
}

/**
 * A project switches read/write backends only after its complete manuscript is
 * present. Individual helper writes must never accidentally strand a legacy
 * project behind a partial TeX directory.
 */
export function hasTexProject(projectDir: string): boolean {
  const paths = texPaths(projectDir);
  if (paths.manuscriptDir === projectDir) return hasSupportedTexDocument(paths.manuscriptDir);
  try {
    return fs.existsSync(paths.projectFile)
      && fs.existsSync(paths.paperFile)
      && fs.existsSync(paths.styleFile)
      && fs.readdirSync(paths.sectionsDir).some((file) => file.endsWith(".tex"));
  } catch {
    return false;
  }
}

export function ensureTexProjectDirectories(projectDir: string): TexPaths {
  const paths = texPaths(projectDir);
  for (const dir of [paths.manuscriptDir, paths.sectionsDir, paths.openBarDir, paths.figuresDir, paths.wikiDir, paths.mindmapsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return paths;
}

export function readProjectRecord<T>(projectDir: string): T | null {
  return readDataFile<T>(texPaths(projectDir).projectFile, TEX_SCHEMAS.project, "project");
}

export function writeProjectRecord(projectDir: string, project: unknown): void {
  const paths = ensureTexProjectDirectories(projectDir);
  writeDataFile(paths.projectFile, TEX_SCHEMAS.project, "project", project, "OpenBar project record. TeX ignores this comment-only file.");
}

export const DRAFT_MINDMAP_ID = "draft";

function isDraftMindmapId(id: string | undefined): boolean {
  return !id || id === DRAFT_MINDMAP_ID || id === "mindmap";
}

function extraMindmapFile(projectDir: string, id: string): string {
  return path.join(texPaths(projectDir).mindmapsDir, `${safeFileSegment(id, "mindmap id")}.tex`);
}

export type MindmapStorageIdentity = {
  id: string;
  role: "draft" | "planning";
  file: string;
};

/** Resolve the durable map record from its requested identity before any read or write. */
export function resolveMindmapStorageIdentity(projectDir: string, requestedId?: string): MindmapStorageIdentity {
  const paths = texPaths(projectDir);
  if (isDraftMindmapId(requestedId)) {
    return { id: DRAFT_MINDMAP_ID, role: "draft", file: paths.mindmapFile };
  }
  const id = safeFileSegment(requestedId!, "mindmap id");
  return { id, role: "planning", file: path.join(paths.mindmapsDir, `${id}.tex`) };
}

export function normalizeStoredMindmap(mindmap: Mindmap, fileId: string): Mindmap {
  const id = isDraftMindmapId(fileId) ? DRAFT_MINDMAP_ID : safeFileSegment(fileId, "mindmap id");
  const role = id === DRAFT_MINDMAP_ID ? "draft" : "planning";
  return {
    ...mindmap,
    id,
    role,
    title: mindmap.title?.trim() || (role === "draft" ? "Draft" : id),
    createdAt: mindmap.createdAt || mindmap.updatedAt,
    nodes: mindmap.nodes.map((node) => ({
      ...node,
      ...(node.progress === undefined ? {} : { progress: normalizeMindmapProgress(node.progress) }),
    })),
  };
}

export function readMindmapRecord(projectDir: string, id = DRAFT_MINDMAP_ID): Mindmap | null {
  const identity = resolveMindmapStorageIdentity(projectDir, id);
  const record = readDataFile<Mindmap>(
    identity.file,
    TEX_SCHEMAS.mindmap,
    identity.id === DRAFT_MINDMAP_ID ? "mindmap" : identity.id,
  );
  return record ? normalizeStoredMindmap(record, identity.id) : null;
}

export function writeMindmapRecord(projectDir: string, mindmap: Mindmap): void {
  ensureTexProjectDirectories(projectDir);
  const encoded = serializeMindmapRecord(projectDir, mindmap);
  writeDataFile(
    encoded.identity.file,
    TEX_SCHEMAS.mindmap,
    encoded.identity.id === DRAFT_MINDMAP_ID ? "mindmap" : encoded.identity.id,
    encoded.normalized,
    encoded.identity.role === "draft"
      ? "OpenBar draft-linked mindmap; TeX ignores this comment-only file."
      : "OpenBar planning mindmap; TeX ignores this comment-only file.",
  );
}

export function serializeMindmapRecord(projectDir: string, mindmap: Mindmap): {
  identity: MindmapStorageIdentity;
  normalized: Mindmap;
  source: string;
} {
  const identity = resolveMindmapStorageIdentity(projectDir, mindmap.id || DRAFT_MINDMAP_ID);
  if (mindmap.role && mindmap.role !== identity.role) {
    throw new TexEnvelopeError(`Mindmap "${identity.id}" has role "${mindmap.role}" but its storage role is "${identity.role}".`);
  }
  const normalized = normalizeStoredMindmap({ ...mindmap, id: identity.id, role: identity.role }, identity.id);
  const heading = identity.role === "draft"
    ? "OpenBar draft-linked mindmap; TeX ignores this comment-only file."
    : "OpenBar planning mindmap; TeX ignores this comment-only file.";
  return {
    identity,
    normalized,
    source: serializeDataFile(
      TEX_SCHEMAS.mindmap,
      identity.id === DRAFT_MINDMAP_ID ? "mindmap" : identity.id,
      normalized,
      heading,
    ),
  };
}

export function listMindmapRecords(
  projectDir: string,
  onInvalidFile?: (file: string, error: unknown) => void,
): Mindmap[] {
  const maps: Mindmap[] = [];
  const draft = readMindmapRecord(projectDir, DRAFT_MINDMAP_ID);
  if (draft) maps.push(draft);
  const dir = texPaths(projectDir).mindmapsDir;
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    files = [];
  }
  for (const file of files) {
    if (!file.endsWith(".tex")) continue;
    const id = file.slice(0, -4);
    if (isDraftMindmapId(id)) continue;
    try {
      safeFileSegment(id, "mindmap id");
    } catch (error) {
      onInvalidFile?.(path.join(dir, file), error);
      continue;
    }
    const map = readMindmapRecord(projectDir, id);
    if (map) maps.push(map);
  }
  return maps.sort((a, b) => {
    if (a.role === "draft" && b.role !== "draft") return -1;
    if (b.role === "draft" && a.role !== "draft") return 1;
    return (a.title || a.id || "").localeCompare(b.title || b.id || "");
  });
}

export function deleteMindmapRecord(projectDir: string, id: string): void {
  if (isDraftMindmapId(id)) throw new Error("The draft-linked mindmap cannot be deleted.");
  const file = extraMindmapFile(projectDir, id);
  if (fs.existsSync(file)) fs.rmSync(file);
}

export function recordFile(projectDir: string, collection: string, id: string): string {
  return path.join(texPaths(projectDir).openBarDir, safeFileSegment(collection, "record collection"), `${safeFileSegment(id, "record id")}.tex`);
}

export function listRecordIds(projectDir: string, collection: string): string[] {
  const dir = path.join(texPaths(projectDir).openBarDir, safeFileSegment(collection, "record collection"));
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith(".tex"))
      .map((file) => file.slice(0, -4))
      .filter((id) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id))
      .sort();
  } catch {
    return [];
  }
}

export function readRecord<T>(projectDir: string, collection: string, id: string): T | null {
  return readDataFile<T>(recordFile(projectDir, collection, id), TEX_SCHEMAS.record, id);
}

export function writeRecord(projectDir: string, collection: string, id: string, data: unknown, heading?: string): void {
  ensureTexProjectDirectories(projectDir);
  writeDataFile(recordFile(projectDir, collection, id), TEX_SCHEMAS.record, id, data, heading || `OpenBar ${collection} record.`);
}

export function deleteRecord(projectDir: string, collection: string, id: string): void {
  try {
    fs.unlinkSync(recordFile(projectDir, collection, id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function listRecords<T>(projectDir: string, collection: string): T[] {
  return listRecordIds(projectDir, collection)
    .map((id) => readRecord<T>(projectDir, collection, id))
    .filter((record): record is T => record !== null);
}

export function readTexPaper(projectDir: string, projectId: string, title: string): TexPaper | null {
  const paths = texPaths(projectDir);
  if (!fs.existsSync(paths.paperFile)) return null;
  const rootSource = fs.readFileSync(paths.paperFile, "utf8");
  const documentTitle = readTexDocumentTitle(rootSource) || title;
  const graph = traverseInputGraph(paths.manuscriptDir, path.relative(paths.manuscriptDir, paths.paperFile));
  const sections: PaperSection[] = [];
  for (const node of graph.nodes) {
    if (!node.editable) continue;
    try {
      const section = readPaperSection(node.absPath);
      sections.push(node.appendix ? { ...section, appendix: true } : section);
    } catch {
      // Include-graph files without a complete envelope stay diagnostics, not sections.
    }
  }
  if (!sections.length) {
    for (const file of listSectionFiles(paths.sectionsDir)) {
      const source = fs.readFileSync(file, "utf8");
      if (!/^%\s*OB-SECTION\s+\{/m.test(source)) continue;
      sections.push(readPaperSection(file));
    }
    sections.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }
  // Keep the established expanded paper view for paper analysis and MCP draft
  // consumers. Preserve the declared root bytes alongside it so callers that
  // edit the manuscript source can use the real file through SourceBundle.
  const source = composePaperTex(documentTitle, sections);
  return {
    projectId,
    title: documentTitle,
    source,
    rootSource,
    sourceHash: sha256(source),
    sections,
  };
}

export function readPaperSection(file: string): PaperSection {
  const source = fs.readFileSync(file, "utf8");
  const meta = parseSectionMeta(source);
  const block = getEditBlock(source, meta.id);
  if (!block || block.schema !== TEX_SCHEMAS.markdown) {
    throw new Error(`${file} is missing ${TEX_SCHEMAS.markdown} editable block ${meta.id}.`);
  }
  // Older managed manuscripts predate the appendix flag. Their explicit
  // Appendix section title still gives an unambiguous and portable marker.
  const appendix = meta.appendix || normalizeTitle(meta.title) === "appendix";
  return { ...meta, ...(appendix ? { appendix: true } : {}), file, tex: block.body, hash: block.hash };
}

export interface PaperSectionPatch {
  id: string;
  baseHash: string;
  tex: string;
  level?: number;
  appendix?: boolean;
}

function paperWriteLockFile(projectDir: string): string {
  return texPaths(projectDir).paperFile;
}

function withPaperLock<T>(projectDir: string, operation: () => T): T {
  return withWriteLock(paperWriteLockFile(projectDir), operation);
}

function applySectionPatch(section: PaperSection, patch: PaperSectionPatch): void {
  const nextLevel = (patch.level ?? section.level) as SectionMeta["level"];
  const nextAppendix = patch.appendix ?? section.appendix;
  if (nextLevel !== section.level || Boolean(nextAppendix) !== Boolean(section.appendix)) {
    const source = fs.readFileSync(section.file, "utf8");
    const meta: SectionMeta = {
      id: section.id,
      title: section.title,
      level: nextLevel,
      order: section.order,
      label: section.label,
      ...(nextAppendix ? { appendix: true } : {}),
    };
    const withMeta = source.replace(/^%\s*OB-SECTION\s+\{.*\}\s*$/m, serializeSectionMeta(meta).trimEnd());
    const withHeading = withMeta.replace(
      /^\\(section|subsection|subsubsection|paragraph|subparagraph)(\*)?\{/m,
      `\\${sectionCommandForLevel(nextLevel)}$2{`,
    );
    writeTextAtomic(section.file, withHeading);
  }
  writeEditBlock(section.file, section.id, section.hash, patch.tex);
}

export function patchPaperSection(
  projectDir: string,
  id: string,
  baseHash: string,
  tex: string,
  heading?: { level?: number; appendix?: boolean },
): PaperSection {
  return patchPaperSections(projectDir, [{ id, baseHash, tex, ...heading }])[0]!;
}

/**
 * One lock, verify every hash, then commit all. Browser autosave and MCP
 * full-paper updates use this so a mid-loop conflict cannot save a prefix.
 */
export function patchPaperSections(projectDir: string, patches: PaperSectionPatch[]): PaperSection[] {
  if (!patches.length) return [];
  return withPaperLock(projectDir, () => {
    const current = patches.map((patch) => {
      const section = findPaperSection(projectDir, patch.id);
      if (!section) throw new Error(`Unknown paper section: ${patch.id}`);
      if (section.hash !== patch.baseHash) {
        throw new TexEnvelopeError(`The "${patch.id}" section changed outside this editor. Reload it before saving.`);
      }
      return { section, patch };
    });
    for (const { section, patch } of current) applySectionPatch(section, patch);
    return current.map(({ section }) => readPaperSection(section.file));
  });
}

/**
 * Full-document save for MCP get_draft / update_draft. Bodies are TeX and are
 * written as-is. Heading identity changes still require an explicit structural
 * operation rather than rebuilding every section file.
 */
export function replacePaperTex(projectDir: string, projectId: string, title: string, source: string): TexPaper {
  if (looksLikeMarkdownPaper(source)) {
    throw new TexEnvelopeError("Paper source must be TeX (\\title / \\section), not markdown headings.");
  }
  const current = readTexPaper(projectDir, projectId, title);
  const incoming = splitPaperTex(source);
  if (!incoming.length) return current || readTexPaper(projectDir, projectId, title)!;

  const currentSections = current?.sections || [];
  const sameTitles = incoming.length === currentSections.length
    && incoming.every((inc, i) => normalizeTitle(inc.title) === normalizeTitle(currentSections[i]?.title || ""));

  if (sameTitles && current) {
    const patches: PaperSectionPatch[] = [];
    for (let i = 0; i < currentSections.length; i++) {
      const section = currentSections[i]!;
      const next = incoming[i]!;
      const texChanged = next.tex.trim() !== section.tex.trim();
      const levelChanged = next.level !== section.level;
      const appendixChanged = Boolean(next.appendix) !== Boolean(section.appendix);
      if (!texChanged && !levelChanged && !appendixChanged) continue;
      patches.push({
        id: section.id,
        baseHash: section.hash,
        tex: next.tex,
        level: next.level,
        appendix: next.appendix,
      });
    }
    if (patches.length) patchPaperSections(projectDir, patches);
    return readTexPaper(projectDir, projectId, title)!;
  }

  throw new TexEnvelopeError("Paper structure changed. Use an explicit section operation to add, remove, rename, or reorder sections.");
}

export function findPaperSection(projectDir: string, id: string): PaperSection | null {
  const safeId = safeFileSegment(id, "section id");
  const paths = texPaths(projectDir);
  const graph = traverseInputGraph(paths.manuscriptDir, path.relative(paths.manuscriptDir, paths.paperFile));
  for (const node of graph.nodes) {
    if (!node.editable || !/^%\s*OB-SECTION\s+\{/m.test(node.source)) continue;
    const file = node.absPath;
    const source = node.source;
    const meta = parseSectionMeta(source);
    if (meta.id === safeId) return readPaperSection(file);
  }
  return null;
}

function requirePaper(projectDir: string, title: string): TexPaper {
  const paper = readTexPaper(projectDir, "", title);
  if (!paper) throw new Error("This project has no TeX paper.");
  return paper;
}

export function renamePaperSection(projectDir: string, title: string, id: string, nextTitle: string): TexPaper {
  const trimmed = nextTitle.trim();
  if (!trimmed) throw new Error("Section title cannot be empty.");
  const allowed = requireManagedManuscript(texPaths(projectDir).manuscriptDir);
  if (!allowed.ok) throw new Error(allowed.message);
  const paths = texPaths(projectDir);
  return withPaperStructureLock(paperWriteLockFile(projectDir), () => {
    const section = findPaperSection(projectDir, id);
    if (!section) throw new Error(`Unknown paper section: ${id}`);
    const styBefore = hashFile(paths.styleFile);
    const rootBefore = fs.readFileSync(paths.paperFile);
    patchSectionTitleFile(section.file, trimmed, section.level);
    if (hashFile(paths.styleFile) !== styBefore) throw new Error("Rename must not rewrite openbarry.sty.");
    if (!fs.readFileSync(paths.paperFile).equals(rootBefore)) throw new Error("Rename must not rewrite paper.tex.");
    return requirePaper(projectDir, title);
  });
}

export function setPaperSectionHeading(
  projectDir: string,
  title: string,
  id: string,
  heading: { level?: number; appendix?: boolean },
): TexPaper {
  const allowed = requireManagedManuscript(texPaths(projectDir).manuscriptDir);
  if (!allowed.ok) throw new Error(allowed.message);
  return withPaperStructureLock(paperWriteLockFile(projectDir), () => {
    const section = findPaperSection(projectDir, id);
    if (!section) throw new Error(`Unknown paper section: ${id}`);
    const resolvedLevel = Math.min(6, Math.max(2, heading.level ?? section.level)) as SectionMeta["level"];
    patchSectionHeadingFile(section.file, {
      level: resolvedLevel,
      appendix: heading.appendix ?? section.appendix,
    });
    return requirePaper(projectDir, title);
  });
}

export function addPaperSection(
  projectDir: string,
  title: string,
  spec: { title: string; afterId?: string; level?: number; appendix?: boolean },
): TexPaper {
  const allowed = requireManagedManuscript(texPaths(projectDir).manuscriptDir);
  if (!allowed.ok) throw new Error(allowed.message);
  const paths = texPaths(projectDir);
  return withPaperStructureLock(paperWriteLockFile(projectDir), () => {
    const paper = requirePaper(projectDir, title);
    const afterIndex = spec.afterId
      ? paper.sections.findIndex((section) => section.id === spec.afterId)
      : paper.sections.length - 1;
    if (spec.afterId && afterIndex < 0) throw new Error(`Unknown paper section: ${spec.afterId}`);
    const graph = traverseInputGraph(paths.manuscriptDir, path.relative(paths.manuscriptDir, paths.paperFile));
    const refs = sectionIncludeReferences(paths.manuscriptDir, graph, paper.sections);
    const anchor = refs
      .filter((ref) => ref.id === (spec.afterId || paper.sections.at(-1)?.id))
      .at(-1);
    if (!anchor) {
      throw new TexEnvelopeError("Could not locate a literal include line for the requested section insertion.");
    }
    const sectionTitle = spec.title.trim() || "New section";
    const level = (spec.level ?? 2) as SectionMeta["level"];
    const styBefore = hashFile(paths.styleFile);
    const id = `sec-${Date.now().toString(36)}`;
    let filename = `${String(afterIndex + 2).padStart(2, "0")}-${safeSectionFilename(sectionTitle, id)}.tex`;
    let collision = 2;
    while (fs.existsSync(path.join(paths.sectionsDir, filename))) {
      filename = `${String(afterIndex + 2).padStart(2, "0")}-${safeSectionFilename(sectionTitle, id)}-${collision}.tex`;
      collision += 1;
    }
    const file = path.join(paths.sectionsDir, filename);
    writeNewSectionFile(file, {
      id,
      title: sectionTitle,
      level,
      order: afterIndex + 1,
      label: id,
      ...(spec.appendix ? { appendix: true } : {}),
    });
    try {
      const ownerSource = fs.readFileSync(anchor.owner, "utf8");
      const newline = ownerSource.includes("\r\n") ? "\r\n" : "\n";
      const ownerLines = ownerSource.split(/\r?\n/);
      const insertLines = [
        ...(spec.appendix && !ownerLines.slice(anchor.lineIndex + 1).some((line) => /^\s*\\appendix\b/.test(line)) ? ["\\appendix"] : []),
        sectionInputLine(path.relative(paths.manuscriptDir, file).split(path.sep).join("/")),
      ];
      ownerLines.splice(anchor.lineIndex + 1, 0, ...insertLines);
      writeTextAtomic(anchor.owner, ownerLines.join(newline));
      if (hashFile(paths.styleFile) !== styBefore) throw new Error("Add-section must not rewrite openbarry.sty.");
      return requirePaper(projectDir, title);
    } catch (error) {
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } catch {
        // Preserve the original structural error. The new file remains in the
        // managed sections directory for manual recovery if cleanup fails.
      }
      throw error;
    }
  });
}

export function removePaperSection(projectDir: string, title: string, id: string): TexPaper {
  const allowed = requireManagedManuscript(texPaths(projectDir).manuscriptDir);
  if (!allowed.ok) throw new Error(allowed.message);
  const paths = texPaths(projectDir);
  return withPaperStructureLock(paperWriteLockFile(projectDir), () => {
    const paper = requirePaper(projectDir, title);
    if (paper.sections.length <= 1) throw new Error("A paper needs at least one section.");
    const section = paper.sections.find((item) => item.id === id);
    if (!section) throw new Error(`Unknown paper section: ${id}`);
    const styBefore = hashFile(paths.styleFile);
    const graph = traverseInputGraph(paths.manuscriptDir, path.relative(paths.manuscriptDir, paths.paperFile));
    const refs = sectionIncludeReferences(paths.manuscriptDir, graph, paper.sections).filter((ref) => ref.id === id);
    if (!refs.length) throw new TexEnvelopeError(`Could not locate an include line for section "${id}".`);
    const byOwner = new Map<string, number[]>();
    for (const ref of refs) byOwner.set(ref.owner, [...(byOwner.get(ref.owner) || []), ref.lineIndex]);
    const originalOwners = new Map([...byOwner.keys()].map((owner) => [owner, fs.readFileSync(owner, "utf8")]));
    let detachedFile: string | null = null;
    try {
      for (const [owner, lineIndexes] of byOwner) {
        const source = originalOwners.get(owner)!;
        const newline = source.includes("\r\n") ? "\r\n" : "\n";
        const lines = source.split(/\r?\n/);
        for (const lineIndex of [...lineIndexes].sort((a, b) => b - a)) lines.splice(lineIndex, 1);
        writeTextAtomic(owner, lines.join(newline));
      }
      detachedFile = detachSectionFile(section.file, path.join(path.dirname(paths.buildDir), "detached"));
      if (hashFile(paths.styleFile) !== styBefore) throw new Error("Remove-section must not rewrite openbarry.sty.");
      return requirePaper(projectDir, title);
    } catch (error) {
      for (const [owner, source] of originalOwners) {
        try {
          writeTextAtomic(owner, source);
        } catch {
          // Keep the original error visible. The lock and detached copy keep
          // the remaining state inspectable for recovery.
        }
      }
      if (detachedFile && !fs.existsSync(/*turbopackIgnore: true*/ section.file) && fs.existsSync(/*turbopackIgnore: true*/ detachedFile)) {
        try {
          fs.renameSync(detachedFile, section.file);
        } catch {
          // Keep the detached copy if restoration cannot complete.
        }
      }
      throw error;
    }
  });
}

export function writePaperProject(
  projectDir: string,
  title: string,
  sections: Array<Omit<PaperSection, "file" | "hash"> & { tex: string }>,
): TexPaper {
  const paths = ensureTexProjectDirectories(projectDir);
  // Rebuild only during migration/explicit initialization. Browser edits always
  // use patchPaperSection and therefore cannot rewrite unrelated sections.
  clearTexFiles(paths.sectionsDir);
  const normalized = sections
    .slice()
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const main: string[] = [];
  const appendixInputs: string[] = [];
  let appendixStarted = false;
  for (const section of normalized) {
    const filename = `${String(section.order).padStart(2, "0")}-${safeFilename(section.title, section.id)}.tex`;
    const file = path.join(paths.sectionsDir, filename);
    const appendix = Boolean(section.appendix)
      || normalizeTitle(section.title) === "appendix"
      || /^\\appendix\b/u.test(section.tex.trim());
    const bodyTex = section.tex.trim().replace(/^\\appendix\b\s*/u, "");
    const command = sectionCommandForLevel(section.level);
    const content = [
      serializeSectionMeta({ ...section, ...(appendix ? { appendix: true } : {}) }),
      `\\${command}{${escapeTexText(section.title)}}`,
      `\\label{${section.label}}`,
      serializeEditBlock(TEX_SCHEMAS.markdown, section.id, bodyTex).trimEnd(),
      "",
    ].join("\n");
    writeTextAtomic(file, content);
    const input = `\\input{sections/${filename.replace(/\.tex$/, "")}}`;
    if (appendix) {
      if (!appendixStarted) {
        appendixInputs.push("\\appendix");
        appendixStarted = true;
      }
      appendixInputs.push(input);
    } else {
      main.push(input);
    }
  }
  if (!fs.existsSync(paths.styleFile)) writeTextAtomic(paths.styleFile, openBarryStyle());
  if (!fs.existsSync(paths.bibliographyFile)) writeBibliographyRaw(projectDir, "");
  writeTextAtomic(paths.paperFile, paperRootTex(title, [...main, PAPER_REFERENCES_INPUT, ...appendixInputs]));
  return readTexPaper(projectDir, "", title)!;
}

export { composePaperTex, splitPaperTex };

export function readBibliographyRaw(projectDir: string): string {
  const paths = texPaths(projectDir);
  const bibliographySources = paths.manuscriptDir === paths.projectDir
    ? [path.join(paths.projectDir, "references.bib"), path.join(paths.openBarDir, "references.bib")]
    : [path.join(paths.openBarDir, "references.bib"), path.join(paths.manuscriptDir, "references.bib"), path.join(paths.projectDir, "references.bib")];
  for (const file of bibliographySources) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, "utf8");
    if (content.trim()) return content;
  }
  const record = readDataFile<BibliographyRecord>(paths.bibliographyFile, TEX_SCHEMAS.bibliography, "references");
  return record?.raw || "";
}

export function writeBibliographyRaw(projectDir: string, raw: string): void {
  const paths = ensureTexProjectDirectories(projectDir);
  const normalized = raw.trim() ? `${raw.trim()}\n` : "";
  const record: BibliographyRecord = { raw: normalized, updatedAt: new Date().toISOString() };
  const referenceBody = bibliographyTex(normalized);
  writeTextAtomic(
    paths.bibliographyFile,
    `${serializeDataFile(TEX_SCHEMAS.bibliography, "references", record, "Bibliography source. The rendered bibliography below is derived from this comment block.")}\n${referenceBody}`,
  );
  const sourceFile = paths.manuscriptDir === paths.projectDir
    ? path.join(paths.projectDir, "references.bib")
    : path.join(paths.openBarDir, "references.bib");
  writeTextAtomic(sourceFile, normalized);
}

export function readBibliography(projectDir: string): BibEntry[] {
  const raw = readBibliographyRaw(projectDir);
  const entries = parseBibtexCitationJs(raw) ?? [];
  return entries.map((entry) => {
    const html = formatBibliographyHtml(entry) || undefined;
    return html ? { ...entry, html } : entry;
  });
}

export function documentFile(projectDir: string, kind: "wiki", id: string): string {
  return path.join(texPaths(projectDir).wikiDir, `${safeFileSegment(id, `${kind} id`)}.tex`);
}

function documentKindDir(projectDir: string, kind: "wiki"): string {
  return texPaths(projectDir).wikiDir;
}

export function nativeBodyRel(kind: "wiki", id: string, format: "markdown" | "html"): string {
  return `${kind}/${id}.${format === "html" ? "html" : "md"}`;
}

export function resolveNativeBodyAbs(projectDir: string, bodyPath: unknown): string | null {
  if (typeof bodyPath !== "string" || !bodyPath || bodyPath.includes("\0") || bodyPath.includes("\\")) return null;
  if (path.posix.isAbsolute(bodyPath) || /^[A-Za-z]:[\\/]/.test(bodyPath)) return null;
  if (bodyPath.split("/").some((segment) => segment === "..")) return null;
  let root: string;
  try {
    root = fs.realpathSync.native(path.resolve(/*turbopackIgnore: true*/ texPaths(projectDir).manuscriptDir));
  } catch {
    return null;
  }
  const abs = path.resolve(/*turbopackIgnore: true*/ root, bodyPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  try {
    if (fs.existsSync(abs)) {
      if (!fs.statSync(abs).isFile()) return null;
      const real = fs.realpathSync.native(abs);
      if (real !== root && !real.startsWith(root + path.sep)) return null;
      return abs;
    }
    let parent = path.dirname(abs);
    while (parent !== root && !fs.existsSync(parent)) {
      const next = path.dirname(parent);
      if (next === parent) return null;
      parent = next;
    }
    const realParent = fs.realpathSync.native(parent);
    if (realParent !== root && !realParent.startsWith(root + path.sep)) return null;
  } catch {
    return null;
  }
  return abs;
}

export function listDocumentIds(
  projectDir: string,
  kind: "wiki",
  onInvalidFile?: (file: string, error: unknown) => void,
): string[] {
  const dir = documentKindDir(projectDir, kind);
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith(".tex"))
      .map((file) => file.slice(0, -4))
      .filter((id) => {
        try {
          safeFileSegment(id, `${kind} id`);
          return true;
        } catch (error) {
          onInvalidFile?.(path.join(dir, `${id}.tex`), error);
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

export function readDocument<T extends Record<string, unknown>>(
  projectDir: string,
  kind: "wiki",
  id: string,
): StoredDocument<T> | null {
  const file = documentFile(projectDir, kind, id);
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const metadata = getDataBlock<T>(source, TEX_SCHEMAS.document, safeFileSegment(id, `${kind} id`));
  const editable = getEditBlock(source, safeFileSegment(id, `${kind} id`));
  if (!metadata || !editable) throw new Error(`${file} has an incomplete OpenBar document envelope.`);
  const declared = typeof (metadata.data as { format?: unknown }).format === "string"
    ? String((metadata.data as { format?: string }).format)
    : undefined;
  const format = inferDocumentFormat(editable.body, declared);
  const nativeAbs = resolveNativeBodyAbs(projectDir, (metadata.data as { bodyPath?: unknown }).bodyPath)
    || (format === "markdown" || format === "html"
      ? resolveNativeBodyAbs(projectDir, nativeBodyRel(kind, safeFileSegment(id, `${kind} id`), format))
      : null);
  if (format === "markdown" || format === "html") {
    let storedBody = editable.body;
    if (nativeAbs && fs.existsSync(/*turbopackIgnore: true*/ nativeAbs)) storedBody = fs.readFileSync(/*turbopackIgnore: true*/ nativeAbs, "utf8");
    return {
      metadata: metadata.data,
      markdown: storedBody,
      hash: sha256(storedBody),
      stateHash: sha256(`${source}\0${storedBody}`),
      file,
      format,
    };
  }
  return {
    metadata: metadata.data,
    markdown: editable.body,
    hash: editable.hash,
    stateHash: sha256(source),
    file,
    format: "tex",
  };
}

/** Raw edit-block TeX. Missing files or envelopes return null instead of throwing. */
export function readDocumentTex(
  projectDir: string,
  kind: "wiki",
  id: string,
): string | null {
  const file = documentFile(projectDir, kind, id);
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return getEditBlock(source, safeFileSegment(id, `${kind} id`))?.body ?? null;
  } catch {
    return null;
  }
}

function writeDocumentUnlocked<T extends Record<string, unknown>>(
  projectDir: string,
  kind: "wiki",
  id: string,
  metadata: T,
  markdown: string,
): void {
  ensureTexProjectDirectories(projectDir);
  const safeId = safeFileSegment(id, `${kind} id`);
  const format = inferDocumentFormat(markdown, typeof (metadata as { format?: unknown }).format === "string" ? String((metadata as { format?: string }).format) : undefined);
  const preparedBody = prepareDocumentBody(markdown, format === "html" ? "html" : format);
  if (format === "markdown" || format === "html") {
    const declaredPath = (metadata as Record<string, unknown>).bodyPath;
    const bodyPath = typeof declaredPath === "string" ? declaredPath : nativeBodyRel(kind, safeId, format);
    const nativeAbs = resolveNativeBodyAbs(projectDir, bodyPath);
    if (!nativeAbs) throw new Error(`Native ${format} body path is outside the manuscript.`);
    writeTextAtomic(nativeAbs, preparedBody.body);
    const pointer = `% ${format} body lives at ${bodyPath}. Conversion is an explicit apply step.\n`;
    writeTextAtomic(
      documentFile(projectDir, kind, safeId),
      `${serializeDataFile(TEX_SCHEMAS.document, safeId, { ...metadata, format, bodyPath }, `${kind} metadata.`)}\n${serializeEditBlock(TEX_SCHEMAS.markdown, safeId, pointer)}`,
    );
    return;
  }
  writeTextAtomic(
    documentFile(projectDir, kind, safeId),
    `${serializeDataFile(TEX_SCHEMAS.document, safeId, { ...metadata, format }, `${kind} metadata.`)}\n${serializeEditBlock(TEX_SCHEMAS.markdown, safeId, preparedBody.body)}`,
  );
}

export function writeDocument<T extends Record<string, unknown>>(
  projectDir: string,
  kind: "wiki",
  id: string,
  metadata: T,
  markdown: string,
): void {
  ensureTexProjectDirectories(projectDir);
  withWriteLock(documentFile(projectDir, kind, id), () => {
    writeDocumentUnlocked(projectDir, kind, id, metadata, markdown);
  });
}

export function patchDocument(
  projectDir: string,
  kind: "wiki",
  id: string,
  baseHash: string,
  markdown: string,
): StoredDocument<Record<string, unknown>> {
  ensureTexProjectDirectories(projectDir);
  return withWriteLock(documentFile(projectDir, kind, id), () => {
    const current = readDocument<Record<string, unknown>>(projectDir, kind, id);
    if (!current) throw new Error(`Unknown ${kind} document: ${id}`);
    const format = inferDocumentFormat(markdown, typeof current.metadata.format === "string" ? current.metadata.format : current.format);
    const preparedBody = prepareDocumentBody(markdown, format === "html" ? "html" : format);
    if (format === "markdown" || format === "html") {
      if (current.stateHash !== baseHash) {
        throw new TexEnvelopeError(`The "${id}" document changed outside this editor. Reload it before saving.`);
      }
      writeDocumentUnlocked(projectDir, kind, id, { ...current.metadata, format }, preparedBody.body);
      return readDocument<Record<string, unknown>>(projectDir, kind, id)!;
    }
    if (current.stateHash !== baseHash) {
      throw new TexEnvelopeError(`The "${id}" document changed outside this editor. Reload it before saving.`);
    }
    const editable = getEditBlock(fs.readFileSync(/*turbopackIgnore: true*/ current.file, "utf8"), safeFileSegment(id, `${kind} id`));
    if (!editable) throw new TexEnvelopeError(`${current.file} is missing editable block "${id}".`);
    writeEditBlock(current.file, id, editable.hash, preparedBody.body);
    return readDocument<Record<string, unknown>>(projectDir, kind, id)!;
  });
}

/**
 * Atomically update a document's native body and metadata from one body hash.
 * Format changes remain explicit conversion operations, so routine web edits
 * preserve the stored TeX, Markdown, or HTML bytes.
 */
export function patchDocumentState<T extends Record<string, unknown>>(
  projectDir: string,
  kind: "wiki",
  id: string,
  baseHash: string,
  metadata: T,
  body: string,
): StoredDocument<T> {
  ensureTexProjectDirectories(projectDir);
  const safeId = safeFileSegment(id, `${kind} id`);
  const file = documentFile(projectDir, kind, safeId);
  return withWriteLock(file, () => {
    const current = readDocument<T>(projectDir, kind, safeId);
    if (!current) throw new Error(`Unknown ${kind} document: ${safeId}`);
    if (current.stateHash !== baseHash) {
      throw new TexEnvelopeError(`The "${safeId}" document changed outside this editor. Reload it before saving.`);
    }
    const requestedFormat = (metadata as { format?: unknown }).format;
    if (typeof requestedFormat === "string" && requestedFormat !== current.format) {
      throw new TexEnvelopeError("Changing document format requires an explicit conversion.");
    }
    const format = current.format || "tex";
    // Keep envelope fields that the visible editor does not expose, such as a
    // custom native body path. The action's CAS above guarantees this merge
    // starts from the same document state the caller reviewed.
    const nextMetadata = { ...current.metadata, ...metadata, format } as T;
    const preparedBody = prepareDocumentBody(body, format);
    const source = fs.readFileSync(file, "utf8");

    if (format === "markdown" || format === "html") {
      const declaredPath = (nextMetadata as { bodyPath?: unknown }).bodyPath;
      const defaultBodyPath = nativeBodyRel(kind, safeId, format);
      const bodyPath = resolveNativeBodyAbs(projectDir, declaredPath) ? declaredPath : defaultBodyPath;
      const nativeAbs = resolveNativeBodyAbs(projectDir, bodyPath);
      if (!nativeAbs) throw new TexEnvelopeError(`Native ${format} body path is outside the manuscript.`);
      const persistedMetadata = { ...nextMetadata, bodyPath } as T;
      const nextEnvelope = upsertDataBlock(
        source,
        TEX_SCHEMAS.document,
        safeId,
        persistedMetadata,
        `${kind} metadata.`,
      );
      const existed = fs.existsSync(nativeAbs);
      const previousBody = existed ? fs.readFileSync(nativeAbs, "utf8") : undefined;
      let nativeWritten = false;
      try {
        writeTextAtomic(nativeAbs, preparedBody.body);
        nativeWritten = true;
        writeTextAtomic(file, nextEnvelope);
      } catch (error) {
        if (nativeWritten) {
          try {
            if (existed) writeTextAtomic(nativeAbs, previousBody!);
            else fs.unlinkSync(nativeAbs);
          } catch {
            // The envelope still has its original source and the caller receives the write error.
          }
        }
        throw error;
      }
      return readDocument<T>(projectDir, kind, safeId)!;
    }

    const editable = getEditBlock(source, safeId);
    if (!editable) throw new TexEnvelopeError(`${file} is missing editable block "${safeId}".`);
    const nextBody = normalizeTexBody(preparedBody.body);
    const withBody = `${source.slice(0, editable.bodyStart)}${nextBody}${source.slice(editable.bodyEnd)}`;
    const nextSource = upsertDataBlock(
      withBody,
      TEX_SCHEMAS.document,
      safeId,
      nextMetadata,
      `${kind} metadata.`,
    );
    writeTextAtomic(file, nextSource);
    return readDocument<T>(projectDir, kind, safeId)!;
  });
}

export function patchDocumentTex(
  projectDir: string,
  kind: "wiki",
  id: string,
  baseHash: string,
  tex: string,
): void {
  const file = documentFile(projectDir, kind, id);
  patchEditBlock(file, id, baseHash, tex);
}

export interface UploadedFigure {
  filename: string;
  id: string;
  markdown: string;
  tex: string;
  path: string;
  sha256: string;
}

export const FIGURE_MAX_BYTES = 8 * 1024 * 1024;
export const FIGURE_EXTENSIONS = ASSET_EXTENSIONS;

export function uploadFigureAsset(projectDir: string, originalName: string, bytes: Buffer): UploadedFigure {
  if (bytes.length === 0) throw new Error("Figure upload is empty.");
  if (bytes.length > FIGURE_MAX_BYTES) throw new Error("Figures are limited to 8 MB.");
  const extension = path.extname(originalName).toLowerCase();
  if (!FIGURE_EXTENSIONS.has(extension)) {
    throw new Error("Figures must be PDF, PNG, JPEG, WebP, GIF, or SVG files.");
  }
  const paths = ensureTexProjectDirectories(projectDir);
  const stem = safeFilename(path.basename(originalName, extension), "figure");
  const digest = sha256(bytes);
  const filename = `${stem}-${digest.slice(0, 12)}${extension}`;
  const file = path.join(paths.figuresDir, filename);
  if (fs.existsSync(file) && !fs.readFileSync(file).equals(bytes)) {
    throw new Error(`A different figure already exists at ${filename}.`);
  }
  if (!fs.existsSync(file)) {
    const tmp = path.join(paths.figuresDir, `.${filename}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  }
  const id = safeFileSegment(`fig-${stem}-${digest.slice(0, 8)}`, "figure id");
  const pathRel = `figures/${filename}`;
  return {
    filename,
    id,
    markdown: `![Figure caption](${pathRel})\n{#${id} width="100%" fig-pos="tbp"${extension === ".pdf" ? ' page="1"' : ""}}`,
    tex: figureToTex({
      id,
      path: pathRel,
      caption: "Figure caption",
      width: "100%",
      position: "tbp",
      page: extension === ".pdf" ? 1 : undefined,
    }),
    path: pathRel,
    sha256: digest,
  };
}

/**
 * Resolve an includegraphics path to a file on disk.
 *
 * TeX (and `/api/p/.../asset/...`) paths are manuscript-relative
 * (`figures/overview.pdf`, `figure_candidates/.../x.pdf`). Bare filenames
 * (`plot.png`) still resolve inside `manuscript/figures`.
 * Never serves sections, bib, sty, or anything outside those image trees.
 */
export function resolveFigureAsset(projectDir: string, relativePath: string): string | null {
  const paths = texPaths(projectDir);
  try {
    const manuscriptDir = fs.realpathSync.native(path.resolve(paths.manuscriptDir));
    const posix = path.normalize(relativePath).replaceAll("\\", "/").replace(/^(\.\.(\/|$))+/, "");
    if (path.posix.isAbsolute(posix) || posix.split("/").includes("..")) return null;
    if (!FIGURE_EXTENSIONS.has(path.posix.extname(posix).toLowerCase())) return null;
    const texRelative = posix.startsWith("figures/") || posix.startsWith("figure_candidates/");
    const root = texRelative ? manuscriptDir : path.join(manuscriptDir, "figures");
    const candidate = path.resolve(root, posix);
    if (candidate !== manuscriptDir && !candidate.startsWith(manuscriptDir + path.sep)) return null;
    if (!fs.existsSync(candidate)) return null;
    const real = fs.realpathSync.native(candidate);
    if (real !== manuscriptDir && !real.startsWith(manuscriptDir + path.sep)) return null;
    const rel = path.relative(manuscriptDir, real).split(path.sep).join("/");
    if (!rel.startsWith("figures/") && !rel.startsWith("figure_candidates/")) return null;
    if (!FIGURE_EXTENSIONS.has(path.extname(real).toLowerCase())) return null;
    if (!fs.statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

export async function resolveFigureAssetAsync(projectDir: string, relativePath: string): Promise<string | null> {
  return resolveProjectAsset(projectDir, relativePath, texPaths(projectDir).manuscriptDir);
}

export function paperSourceHash(projectDir: string): string {
  const paths = texPaths(projectDir);
  const rootFile = locateTexRoot(paths.manuscriptDir);
  const graph = traverseInputGraph(paths.manuscriptDir, path.relative(paths.manuscriptDir, rootFile));
  const relevant = graph.nodes
    .filter((node) => node.kind !== "bibliography")
    .map((node) => `${node.filePath}\0${node.source}`)
    .join("\n\u0000\n");
  const content = `${graph.rootFile}\n\u0000\n${relevant}`;
  return sha256(content);
}

function normalizeTitle(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function listSectionFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith(".tex"))
      .map((file) => path.join(dir, file));
  } catch {
    return [];
  }
}

type SectionIncludeReference = { id: string; owner: string; lineIndex: number };

function sectionIncludeReferences(
  manuscriptDir: string,
  graph: ReturnType<typeof traverseInputGraph>,
  sections: PaperSection[],
): SectionIncludeReference[] {
  const root = (() => {
    try {
      return fs.realpathSync.native(path.resolve(manuscriptDir));
    } catch {
      return path.resolve(manuscriptDir);
    }
  })();
  const targets = new Map<string, string>();
  for (const section of sections) {
    try {
      targets.set(fs.realpathSync.native(section.file), section.id);
    } catch {
      // The section will be reported as missing by the enclosing structural operation.
    }
  }
  const refs: SectionIncludeReference[] = [];
  for (const node of graph.nodes) {
    const lines = node.source.split(/\r?\n/);
    lines.forEach((line, lineIndex) => {
      const raw = /^\s*\\(?:input|include)\s*\{([^}]+)\}/.exec(line)?.[1]?.trim();
      if (!raw || /[\\#]/.test(raw)) return;
      const input = normalizeTeXInputPath(raw);
      const candidates = [
        path.resolve(path.dirname(node.absPath), input),
        path.resolve(root, input),
      ];
      for (const candidate of candidates) {
        try {
          const real = fs.realpathSync.native(candidate);
          const relative = path.relative(root, real);
          if (relative.startsWith("..") || path.isAbsolute(relative)) return;
          const id = targets.get(real);
          if (id) refs.push({ id, owner: node.absPath, lineIndex });
          return;
        } catch {
          // Try the manuscript-root candidate next.
        }
      }
    });
  }
  return refs;
}

function clearTexFiles(dir: string): void {
  try {
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(".tex")) fs.unlinkSync(path.join(dir, file));
    }
  } catch {
    // The parent is created by ensureTexProjectDirectories.
  }
}

function safeFilename(title: string, fallback: string): string {
  const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || fallback).slice(0, 72);
}

function paperRootTex(title: string, body: string[]): string {
  return [
    "% OpenBar manuscript entry point.",
    "\\documentclass[11pt]{article}",
    "\\usepackage{openbarry}",
    paperTitleCommand(title),
    "\\date{}",
    "\\begin{document}",
    "\\maketitle",
    ...body,
    "\\end{document}",
    "",
  ].join("\n");
}

function openBarryStyle(): string {
  return String.raw`% OpenBarry manuscript support.
% Designed to coexist with the document class and publisher style chosen by
% the project. The package only supplies OpenBarry research macros.
\NeedsTeXFormat{LaTeX2e}
\ProvidesPackage{openbarry}[2026/08/26 OpenBarry research macros]

% 1. Package options:
% \usepackage{openbarry}            -> colored draft markers for collaborative editing
% \usepackage[final]{openbarry}     -> clean publication text (comments, todos, and markers hidden)
% \usepackage[neutral]{openbarry}   -> neutral text colors (no magenta/orange/blue)
\newif\if@obfinal\@obfinalfalse
\newif\if@obneutral\@obneutralfalse

\DeclareOption{final}{\@obfinaltrue}
\DeclareOption{submission}{\@obfinaltrue}
\DeclareOption{neutral}{\@obneutraltrue}
\ProcessOptions\relax

% 2. Safe conditional package loading (prevents option clashes with conference styles)
\@ifpackageloaded{xcolor}{}{%
  \PassOptionsToPackage{table,xcdraw}{xcolor}%
  \RequirePackage{xcolor}%
}
\@ifpackageloaded{hyperref}{}{%
  \RequirePackage{hyperref}%
}
\@ifpackageloaded{url}{}{\RequirePackage{url}}

% 3. Universal macro definitions with \providecommand
\if@obfinal
  % Final / submission mode: emit clean prose, drop todos/markers entirely
  \providecommand{\obclaim}[2][]{#2}
  \providecommand{\obevidence}[2][]{#2}
  \providecommand{\obcomment}[2][]{}
  \providecommand{\obtodo}[2][]{}
  \providecommand{\obmarker}[2]{}
  \providecommand{\obcite}[2][]{\cite{#2}\if\relax\detokenize{#1}\relax\else, #1\fi}
\else
  \if@obneutral
    % Neutral draft mode: keep todos visible in gray/black
    \providecommand{\obclaim}[2][]{#2}
    \providecommand{\obevidence}[2][]{#2}
    \providecommand{\obcomment}[2][]{\textit{[Comment: #2]}}
    \providecommand{\obtodo}[2][]{\textit{[TODO: #2]}}
    \providecommand{\obmarker}[2]{\textit{[#1: #2]}}
    \providecommand{\obcite}[2][]{\cite{#2}\if\relax\detokenize{#1}\relax\else, #1\fi}
  \else
    % Standard OpenBarry colored draft mode
    \providecommand{\obclaim}[2][]{\textcolor{magenta!75!black}{#2}}
    \providecommand{\obevidence}[2][]{#2}
    \providecommand{\obcomment}[2][]{\textcolor{gray!75!black}{\textit{[Comment: #2]}}}
    \providecommand{\obtodo}[2][]{\textcolor{orange!85!black}{[TODO: #2]}}
    \providecommand{\obmarker}[2]{\textcolor{orange!85!black}{[#1: #2]}}
    \providecommand{\obcite}[2][]{\cite{#2}\if\relax\detokenize{#1}\relax\else, #1\fi}
  \fi
\fi
`;
}

function escapeBibliographyText(value: string): string {
  return escapeTexText(value);
}

function safeUrl(value: string): string {
  return value.replace(/[{}]/g, "").replace(/\s/g, "");
}

function bibliographyTex(raw: string): string {
  const entries = parseBibtexCitationJs(raw) ?? [];
  if (!entries.length) return "% No cited bibliography entries yet.\n";
  const items = entries.map((entry) => {
    const fields = entry.fields;
    const author = fields.author || fields.editor || "";
    const title = fields.title || "Untitled";
    const venue = fields.journal || fields.booktitle || fields.publisher || fields.school || fields.institution || "";
    const year = fields.year || fields.date || "";
    const url = fields.url || (fields.doi ? `https://doi.org/${fields.doi}` : "");
    const text = [
      author && `${escapeBibliographyText(author)}.`,
      `${escapeBibliographyText(title)}.`,
      [venue, year].filter(Boolean).join(", ") && `${escapeBibliographyText([venue, year].filter(Boolean).join(", "))}.`,
      url && `\\url{${safeUrl(url)}}`,
    ].filter(Boolean).join(" ");
    return `\\bibitem{${safeFileSegment(entry.key, "citation key")}} ${text}`;
  });
  return ["\\begin{thebibliography}{99}", ...items, "\\end{thebibliography}", ""].join("\n");
}
