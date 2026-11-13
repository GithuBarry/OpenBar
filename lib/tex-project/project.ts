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
  readDataFile,
  safeFileSegment,
  serializeDataFile,
  serializeEditBlock,
  sha256,
  upsertDataBlock,
  withWriteLock,
  writeDataFile,
  writeTextAtomic,
  type SectionMeta,
  TexEnvelopeError,
} from "./codec";
import { deriveSections, stripSectionComments } from "./section-ranges";
import { figureToTex } from "./obmd";
import { composePaperTex, PAPER_REFERENCES_FILE, PAPER_REFERENCES_INPUT, readTexDocumentTitle, sectionCommandForLevel } from "./paper-compose";
import { prepareDocumentBody, inferDocumentFormat } from "./document-body";
import { locateTexRoot, traverseInputGraph, orderedSourceRanges } from "./source-graph";
import { normalizeTeXInputPath } from "./source-bundle-format";
import { withProjectWriteLock } from "@/lib/research/project-lock";
import { escapeTexText, paperTitleCommand } from "./tex-encode";
import { resolveProjectAsset, resolveProjectAssetPath, ASSET_EXTENSIONS } from "./asset-resolver";
import { mindmapDiskHash } from "@/lib/mindmap/mindmap";
import { stripLegacyCollapsedField } from "@/lib/mindmap/collapse-preferences";
import { migrateStoredCardNotes } from "@/lib/mindmap/caution";
import { maskTexLiterals } from "./tex-literals";

export const TEX_SCHEMAS = {
  project: "openbarry/project@1",
  mindmap: "openbarry/mindmap@1",
  bibliography: "openbarry/bibliography@1",
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
  from?: number;
  bodyFrom?: number;
  to?: number;
  sourceHash?: string;
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
  // The persisted project record is the layout marker. Keep a canonical
  // project anchored to its own manuscript root while its configured entry
  // file is temporarily missing, even when a legacy-looking `manuscript/`
  // directory happens to exist beside it.
  if (fs.existsSync(path.join(projectDir, ".OpenBar", "project.tex"))) return true;
  if (fs.existsSync(path.join(projectDir, "manuscript", "openbarry", "project.tex"))) return false;
  return hasSupportedTexDocument(projectDir)
    || !hasSupportedTexDocument(path.join(projectDir, "manuscript"));
}

export function texPaths(projectDir: string): TexPaths {
  const canonical = useCanonicalLayout(projectDir);
  const manuscriptDir = canonical ? projectDir : path.join(projectDir, "manuscript");
  const openBarDir = canonical ? path.join(projectDir, ".OpenBar") : path.join(manuscriptDir, "openbarry");
  // `paper.tex` remains the initialization default. Existing projects may
  // declare `main.tex`, `ms.tex`, or another document root discovered by the
  // source graph. A persisted `mainFile` is resolved by locateTexRoot using
  // the same manuscript-root policy as the compiler and source bundle.
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
export const DEFAULT_PRIMARY_MINDMAP_TITLE = "main-mindmap";

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
    title: mindmap.title?.trim() || (role === "draft" ? DEFAULT_PRIMARY_MINDMAP_TITLE : id),
    createdAt: mindmap.createdAt || mindmap.updatedAt,
    nodes: mindmap.nodes.map((node) => ({
      ...stripLegacyCollapsedField(node),
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
  return record ? normalizeStoredMindmap({
    ...record,
    nodes: record.nodes.map(migrateStoredCardNotes),
  }, identity.id) : null;
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

export function readTexPaper(projectDir: string, projectId: string, title: string): TexPaper | null {
  const paths = texPaths(projectDir);
  if (!fs.existsSync(paths.paperFile)) return null;
  const rootSource = fs.readFileSync(paths.paperFile, "utf8");
  const documentTitle = readTexDocumentTitle(rootSource) || title;
  const graph = traverseInputGraph(paths.manuscriptDir, path.relative(paths.manuscriptDir, paths.paperFile));
  const sections = graph.nodes.filter(node => node.editable).flatMap(node =>
    readPaperSections(node.absPath, node.filePath).map(section => ({ ...section, ...(node.appendix ? { appendix: true } : {}) })),
  );
  const order = new Map<string, number>();
  for (const range of orderedSourceRanges(graph)) {
    for (const section of sections) {
      if (section.file === range.node.absPath && section.from! >= range.from && section.from! < range.to && !order.has(section.id)) order.set(section.id, order.size);
    }
  }
  sections.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  sections.forEach((section, index) => { section.order = index; });
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

export function readPaperSections(file: string, filePath = path.basename(file)): PaperSection[] {
  const source = fs.readFileSync(file, "utf8");
  return deriveSections(source, filePath).map(({ heading, ...section }) => {
    const tex = stripSectionComments(source.slice(section.bodyFrom, section.to));
    return { ...section, file, tex, hash: sha256(`${section.id}\0${source}`), sourceHash: sha256(source) };
  });
}

export interface PaperSectionPatch {
  id: string;
  baseHash: string;
  tex: string;
  level?: number;
  appendix?: boolean;
}

function applySectionPatch(source: string, section: PaperSection, patch: PaperSectionPatch): string {
  const body = normalizeTexBody(patch.tex);
  let next = `${source.slice(0, section.bodyFrom)}${body.startsWith("\n") ? "" : "\n"}${body}${source.slice(section.to)}`;
  if (patch.level !== undefined && patch.level !== section.level) {
    const from = section.from!;
    next = next.slice(0, from) + next.slice(from).replace(/^\\(?:section|subsection|subsubsection|paragraph|subparagraph)/,
      `\\${sectionCommandForLevel(patch.level)}`);
  }
  return next;
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
 * One lock verifies every hash before committing section patches.
 */
export function patchPaperSections(projectDir: string, patches: PaperSectionPatch[]): PaperSection[] {
  if (!patches.length) return [];
  return withProjectWriteLock(projectDir, () => {
    const current = patches.map((patch) => {
      const section = findPaperSection(projectDir, patch.id);
      if (!section) throw new Error(`Unknown paper section: ${patch.id}`);
      if (section.hash !== patch.baseHash) {
        throw new TexEnvelopeError(`The "${patch.id}" section changed outside this editor. Reload it before saving.`);
      }
      return { section, patch };
    });
    const files = new Map<string, string>();
    for (const { section, patch } of [...current].sort((a, b) => b.section.from! - a.section.from!)) {
      const source = files.get(section.file) ?? fs.readFileSync(section.file, "utf8");
      files.set(section.file, applySectionPatch(source, section, patch));
    }
    for (const [file, source] of files) writeTextAtomic(file, stripSectionComments(source));
    for (const { section, patch } of current) {
      if (patch.appendix !== undefined && Boolean(section.appendix) !== patch.appendix) patchAppendixMode(projectDir, section.id, patch.appendix);
    }
    return current.map(({ section }) => findPaperSection(projectDir, section.id)!);
  });
}

export function findPaperSection(projectDir: string, id: string): PaperSection | null {
  const paths = texPaths(projectDir);
  const graph = traverseInputGraph(paths.manuscriptDir, path.relative(paths.manuscriptDir, paths.paperFile));
  for (const node of graph.nodes) {
    if (!node.editable) continue;
    const section = readPaperSections(node.absPath, node.filePath).find(section => section.id === id);
    if (section) return node.appendix ? { ...section, appendix: true } : section;
  }
  return null;
}

/** Appendix mode is represented by the manuscript's ordinary LaTeX command. */
function patchAppendixMode(projectDir: string, id: string, enabled: boolean): void {
  const paths = texPaths(projectDir);
  const section = findPaperSection(projectDir, id);
  if (!section) throw new Error(`Unknown paper section: ${id}`);
  if (Boolean(section.appendix) === enabled) return;
  if (enabled) {
    const source = fs.readFileSync(section.file, "utf8");
    writeTextAtomic(section.file, source.slice(0, section.from) + "\\appendix\n" + source.slice(section.from));
    return;
  }
  const graph = traverseInputGraph(paths.manuscriptDir, path.relative(paths.manuscriptDir, paths.paperFile));
  let command: { file: string; from: number; to: number } | undefined;
  for (const range of orderedSourceRanges(graph)) {
    const target = range.node.absPath === section.file && section.from! >= range.from && section.from! < range.to;
    const text = range.node.source.slice(range.from, target ? section.from : range.to);
    for (const match of text.matchAll(/^[\t ]*\\appendix\b[\t ]*(?:\r?\n)?/gm)) {
      command = { file: range.node.absPath, from: range.from + match.index!, to: range.from + match.index! + match[0].length };
    }
    if (target) break;
  }
  if (command) {
    const source = fs.readFileSync(command.file, "utf8");
    writeTextAtomic(command.file, source.slice(0, command.from) + source.slice(command.to));
  }
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
      `\\${command}{${escapeTexText(section.title)}}`,
      `\\label{${section.label}}`,
      bodyTex,
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
  ensureBibliographyInput(projectDir);
  return readTexPaper(projectDir, "", title)!;
}

export { composePaperTex };

/** Existing declared BibTeX sources in include/declaration order, resolved inside the manuscript. */
export function bibliographySourceFiles(projectDir: string): string[] {
  const paths = texPaths(projectDir);
  // Imported papers name their own BibTeX inputs. Resolve declarations from
  // the active TeX include graph using the compiler's manuscript directory.
  const declaredSources: string[] = [];
  const seenFiles = new Set<string>();
  const manuscriptRoot = fs.realpathSync.native(paths.manuscriptDir);
  for (const node of traverseInputGraph(paths.manuscriptDir).nodes) {
    const source = maskTexLiterals(node.source);
    const declarations = source.matchAll(/\\(bibliography|addbibresource)\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)\}/g);
    for (const declaration of declarations) {
      const names = declaration[1] === "bibliography" ? declaration[2]!.split(",") : [declaration[2]!];
      for (const name of names) {
        const trimmed = name.trim();
        if (!trimmed || /[\\#$]/.test(trimmed) || path.isAbsolute(trimmed)) continue;
        const relative = path.extname(trimmed) ? trimmed : `${trimmed}.bib`;
        if (path.extname(relative).toLowerCase() !== ".bib") continue;
        try {
          const file = fs.realpathSync.native(path.resolve(manuscriptRoot, relative));
          const withinRoot = path.relative(manuscriptRoot, file);
          if (withinRoot === ".." || withinRoot.startsWith(`..${path.sep}`) || path.isAbsolute(withinRoot)
            || seenFiles.has(file) || !fs.statSync(file).isFile()) continue;
          seenFiles.add(file);
          declaredSources.push(file);
        } catch { /* A partial paper can retain references to missing files. */ }
      }
    }
  }
  return declaredSources;
}

export function readBibliographyRaw(projectDir: string): string {
  const paths = texPaths(projectDir);
  const sourceFiles = bibliographySourceFiles(projectDir);
  const declaredSources = sourceFiles
    .map(file => fs.readFileSync(file, "utf8"))
    .filter(source => source.trim());
  if (sourceFiles.length) return declaredSources.join("\n");
  const bibliographySources = paths.manuscriptDir === paths.projectDir
    ? [path.join(paths.projectDir, "references.bib"), path.join(paths.openBarDir, "references.bib")]
    : [path.join(paths.manuscriptDir, "references.bib"), path.join(paths.projectDir, "references.bib"), path.join(paths.openBarDir, "references.bib")];
  for (const file of bibliographySources) {
    if (!fs.existsSync(file)) continue;
    return fs.readFileSync(file, "utf8");
  }
  const record = readDataFile<BibliographyRecord>(paths.bibliographyFile, TEX_SCHEMAS.bibliography, "references");
  return record?.raw || "";
}

export function writeBibliographyRaw(projectDir: string, raw: string): void {
  ensureTexProjectDirectories(projectDir);
  for (const write of bibliographyWrites(projectDir, raw)) writeTextAtomic(write.file, write.source);
}

/** Plan derived references separately when a filesystem batch already owns source bytes. */
export function bibliographyWrites(projectDir: string, raw: string, includeSource = true): Array<{ file: string; source: string }> {
  const paths = texPaths(projectDir);
  const normalized = raw.trim() ? `${raw.trim()}\n` : "";
  const record: BibliographyRecord = { raw: normalized, updatedAt: new Date().toISOString() };
  const referenceBody = bibliographyTex(normalized);
  const inputWrites = bibliographyInputWrites(projectDir, normalized);
  const writes = [{ file: paths.bibliographyFile, source: `${serializeDataFile(TEX_SCHEMAS.bibliography, "references", record, "Bibliography source. The rendered bibliography below is derived from this comment block.")}\n${referenceBody}` }];
  const sourceFile = paths.manuscriptDir === paths.projectDir
    ? path.join(paths.projectDir, "references.bib")
    : path.join(paths.openBarDir, "references.bib");
  if (includeSource && !bibliographySourceFiles(projectDir).length) writes.push({ file: sourceFile, source: normalized });
  return [...writes, ...inputWrites];
}

const BIBLIOGRAPHY_RENDER_HEADING = "% Generated by OpenBar from the project's bibliography.\n";

/** Plan the managed renderer and path repair while preserving surrounding source bytes. */
export function bibliographyInputWrites(projectDir: string, raw: string): Array<{ file: string; source: string }> {
  const paths = texPaths(projectDir);
  const writes: Array<{ file: string; source: string }> = [];
  let managedInput = false;
  for (const node of traverseInputGraph(paths.manuscriptDir).nodes.filter(node => node.editable)) {
    const matches = [...maskTexLiterals(node.source).matchAll(/\\input\s*\{\s*(\.OpenBar\/references(?:\.tex)?|openbarry-references(?:\.tex)?)\s*\}/g)]
      .filter(match => {
        let precedingSlashes = 0;
        for (let index = match.index! - 1; index >= 0 && node.source[index] === "\\"; index -= 1) precedingSlashes += 1;
        return precedingSlashes % 2 === 0;
      });
    if (!matches.length) continue;
    managedInput = true;
    let source = node.source;
    for (const match of matches.reverse()) {
      const input = match[1]!;
      if (!input.startsWith(".OpenBar/")) continue;
      const from = match.index! + match[0].indexOf(input);
      const replacement = input.endsWith(".tex") ? PAPER_REFERENCES_FILE : PAPER_REFERENCES_FILE.slice(0, -4);
      source = source.slice(0, from) + replacement + source.slice(from + input.length);
    }
    if (source !== node.source) writes.push({ file: node.absPath, source });
  }
  if (!managedInput) return [];
  const file = path.join(paths.manuscriptDir, PAPER_REFERENCES_FILE);
  let previous: string | undefined;
  try {
    if (!fs.lstatSync(file).isFile()) throw new Error(`Keep ${PAPER_REFERENCES_FILE} as OpenBar's generated bibliography file.`);
    previous = fs.readFileSync(file, "utf8");
    if (!previous.startsWith(BIBLIOGRAPHY_RENDER_HEADING)) throw new Error(`Choose another name for the existing ${PAPER_REFERENCES_FILE} before preparing OpenBar's bibliography.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const source = BIBLIOGRAPHY_RENDER_HEADING + bibliographyTex(raw);
  if (source !== previous) writes.unshift({ file, source });
  return writes;
}

/** Call under the project write lock before exporting or saving a managed bibliography. */
export function ensureBibliographyInput(projectDir: string): void {
  for (const write of bibliographyInputWrites(projectDir, readBibliographyRaw(projectDir))) writeTextAtomic(write.file, write.source);
}

export function readBibliography(projectDir: string): BibEntry[] {
  return parseBibliography(readBibliographyRaw(projectDir));
}

export function parseBibliography(raw: string): BibEntry[] {
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
 * (`plots/overview.pdf`, `figs/.../x.pdf`). Bare filenames also resolve inside
 * `manuscript/figures`. Real paths stay within the manuscript directory.
 */
export function resolveFigureAsset(projectDir: string, relativePath: string): string | null {
  return resolveProjectAssetPath(relativePath, texPaths(projectDir).manuscriptDir);
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
    \providecommand{\obtodo}[2][]{{\itshape [TODO: #2]}}
    \providecommand{\obmarker}[2]{\textit{[#1: #2]}}
    \providecommand{\obcite}[2][]{\cite{#2}\if\relax\detokenize{#1}\relax\else, #1\fi}
  \else
    % Standard OpenBarry colored draft mode
    \providecommand{\obclaim}[2][]{\textcolor{magenta!75!black}{#2}}
    \providecommand{\obevidence}[2][]{#2}
    \providecommand{\obcomment}[2][]{\textcolor{gray!75!black}{\textit{[Comment: #2]}}}
    \providecommand{\obtodo}[2][]{{\color{orange!85!black}[TODO: #2]}}
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
