import { execFileSync } from "node:child_process";
import { redactSensitiveText } from "@/lib/server/git-url";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { writeTextAtomic } from "./codec";
import { inspectPaperPageBudget, type PaperPageBudget } from "./page-budget";
import { paperSourceHash, readProjectRecord, texPaths } from "./project";
import { locateTexRoot } from "./source-graph";
import { parseTexFileLines, type TexFileLine } from "./tex-diagnostics";
import { discoverTexBinDirs } from "./latexpand";
import { withProjectWriteLock } from "@/lib/research/project-lock";

export type { TexFileLine };
export { parseTexFileLines };

export type CompileState = "idle" | "running" | "success" | "error" | "unavailable";
export type TexEngine = "pdflatex" | "xelatex" | "lualatex";

export interface PaperCompileStatus {
  state: CompileState;
  jobId?: string;
  pdfAvailable?: boolean;
  sourceHash?: string;
  stale?: boolean;
  completedAt?: string;
  startedAt?: string;
  message?: string;
  diagnostics?: string[];
  parsedDiagnostics?: TexFileLine[];
  rawLog?: string;
  compiler?: "latexmk";
  engine?: TexEngine;
  texliveVersion?: string;
  lastLines?: string[];
  pageBudget?: PaperPageBudget;
  artifactId?: string;
  artifactSourceHash?: string;
  /** Build identity of the latest successfully published artifact. */
  artifactBuildInputHash?: string;
  /** Build identity targeted by the latest attempted compile. */
  buildInputHash?: string;
}

type PdfArtifactManifest = {
  artifactId: string;
  sourceHash: string;
  buildInputHash: string;
  jobId: string;
  compiler: "latexmk";
  engine: TexEngine;
  createdAt: string;
};

export type CompilerConfig = {
  compiler: "latexmk";
  engine: TexEngine;
  texliveVersion?: string;
  mainFile?: string;
};

export type BuildInputFile = {
  path: string;
  bytes: string | Buffer;
};

export type BuildInputHashInput = {
  sourceHash: string;
  rootFile: string;
  config: CompilerConfig;
  toolchain: string;
  files: readonly BuildInputFile[];
};

export type BuildInputSnapshot = {
  sourceHash: string;
  buildInputHash: string;
  rootFile: string;
  config: CompilerConfig;
};

const running = new Map<string, Promise<PaperCompileStatus>>();
const queuedAfterCurrent = new Set<string>();
// Compiler jobs have a five-minute execution limit and a five-second forced
// termination window. Allow time for snapshot capture and result publishing.
const COMPILE_RECOVERY_MS = 6 * 60_000;

export function compileStatusFile(projectDir: string): string {
  return path.join(texPaths(projectDir).buildDir, "status.json");
}

function artifactSegment(artifactId: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(artifactId) ? artifactId : null;
}

export function compiledPdfFile(projectDir: string, artifactId?: string): string {
  const buildDir = texPaths(projectDir).buildDir;
  const segment = artifactId ? artifactSegment(artifactId) : null;
  return segment ? path.join(buildDir, "artifacts", segment, "paper.pdf") : path.join(buildDir, "paper.pdf");
}

export function compiledSynctexFile(projectDir: string, artifactId?: string): string {
  const buildDir = texPaths(projectDir).buildDir;
  const segment = artifactId ? artifactSegment(artifactId) : null;
  return segment ? path.join(buildDir, "artifacts", segment, "paper.synctex.gz") : path.join(buildDir, "paper.synctex.gz");
}

function artifactManifestFile(projectDir: string, artifactId?: string): string {
  const buildDir = texPaths(projectDir).buildDir;
  if (artifactId && artifactSegment(artifactId)) return path.join(buildDir, "artifacts", artifactId, "manifest.json");
  return path.join(buildDir, "paper-artifact.json");
}

function displayedArtifactFile(projectDir: string): string {
  return path.join(texPaths(projectDir).buildDir, "displayed-artifact.json");
}

function readArtifactManifest(projectDir: string, artifactId?: string): PdfArtifactManifest | null {
  try {
    const value = JSON.parse(fs.readFileSync(artifactManifestFile(projectDir, artifactId), "utf8")) as Partial<PdfArtifactManifest>;
    if (
      typeof value.artifactId === "string" && typeof value.sourceHash === "string"
      && typeof value.buildInputHash === "string" && typeof value.jobId === "string"
      && value.compiler === "latexmk" && (value.engine === "pdflatex" || value.engine === "xelatex" || value.engine === "lualatex")
      && typeof value.createdAt === "string"
    ) return value as PdfArtifactManifest;
  } catch {
    // A missing or partial manifest means there is no addressable artifact.
  }
  return null;
}

export function currentArtifactId(projectDir: string): string | undefined {
  return readArtifactManifest(projectDir)?.artifactId;
}

function displayedArtifactId(projectDir: string): string | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(displayedArtifactFile(projectDir), "utf8")) as { artifactId?: unknown };
    return typeof value.artifactId === "string" && artifactSegment(value.artifactId) ? value.artifactId : undefined;
  } catch {
    return undefined;
  }
}

/** Mark a successfully served immutable PDF so artifact cleanup preserves it. */
export function markDisplayedArtifact(projectDir: string, artifactId: string): boolean {
  if (!artifactSegment(artifactId)) return false;
  const manifest = readArtifactManifest(projectDir, artifactId);
  if (!manifest || !fs.existsSync(compiledPdfFile(projectDir, artifactId))) return false;
  writeTextAtomic(displayedArtifactFile(projectDir), `${JSON.stringify({ artifactId, markedAt: new Date().toISOString() })}\n`);
  return true;
}

export function readCompilerConfig(projectDir: string): CompilerConfig {
  const record = (readProjectRecord<Record<string, unknown>>(projectDir) || {}) as Record<string, unknown>;
  const engine = record.engine === "xelatex" || record.engine === "lualatex" || record.engine === "pdflatex"
    ? record.engine
    : "pdflatex";
  const mainFile = typeof record.mainFile === "string" && record.mainFile.trim() ? record.mainFile.trim() : undefined;
  const texliveVersion = typeof record.texliveVersion === "string" && record.texliveVersion.trim()
    ? record.texliveVersion.trim()
    : undefined;
  return { compiler: "latexmk", engine, ...(mainFile ? { mainFile } : {}), ...(texliveVersion ? { texliveVersion } : {}) };
}

function normalizeBuildPath(value: string): string {
  return value.replaceAll("\\", "/");
}

/**
 * Hash the complete compiler input identity in a deterministic order.
 *
 * The caller supplies the allowed manuscript files, so this pure function can
 * be tested without invoking TeX or reading a project directory. Length
 * framing keeps file paths and bytes unambiguous even when a source file has
 * unusual text or binary content.
 */
export function hashBuildInputs(input: BuildInputHashInput): string {
  return hashBuildInputRecords({ ...input, files: input.files.map(file => {
    const bytes = typeof file.bytes === "string" ? Buffer.from(file.bytes) : file.bytes;
    return { path: file.path, size: bytes.byteLength, hash: createHash("sha256").update(bytes).digest("hex") };
  }) });
}

type BuildFileDigest = { path: string; size: number; hash: string };

function hashBuildInputRecords(input: Omit<BuildInputHashInput, "files"> & { files: BuildFileDigest[] }): string {
  const files = input.files.map(file => ({ ...file, path: normalizeBuildPath(file.path) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const hash = createHash("sha256");
  hash.update(JSON.stringify({
    version: 3,
    sourceHash: input.sourceHash,
    rootFile: normalizeBuildPath(input.rootFile),
    compiler: input.config.compiler,
    engine: input.config.engine,
    texliveVersion: input.config.texliveVersion || "",
    mainFile: normalizeBuildPath(input.config.mainFile || ""),
    toolchain: input.toolchain,
    fileCount: files.length,
  }));
  for (const file of files) {
    const relativePath = Buffer.from(file.path);
    hash.update(`${relativePath.byteLength}:`);
    hash.update(relativePath);
    hash.update(`${file.size}:${file.hash}`);
  }
  return hash.digest("hex");
}

function currentBuildInput(projectDir: string): BuildInputSnapshot {
  const paths = texPaths(projectDir);
  const sourceRoot = path.resolve(paths.manuscriptDir);
  return withProjectWriteLock(projectDir, () => {
    const config = readCompilerConfig(projectDir);
    const sourceHash = paperSourceHash(projectDir);
    const rootFile = normalizeBuildPath(path.relative(sourceRoot, locateTexRoot(sourceRoot, config.mainFile)));
    return {
      sourceHash,
      rootFile,
      config,
      buildInputHash: snapshotDigest(sourceRoot, sourceHash, config, rootFile),
    };
  });
}

function artifactBuildInputHash(projectDir: string): string | undefined {
  return readArtifactManifest(projectDir)?.buildInputHash;
}

function artifactIsStale(projectDir: string, buildInputHash: string): boolean {
  const artifactHash = artifactBuildInputHash(projectDir);
  return Boolean(artifactHash && artifactHash !== buildInputHash);
}

export function getPaperCompileStatus(projectDir: string): PaperCompileStatus {
  try {
    const statusFile = compileStatusFile(projectDir);
    const stored = JSON.parse(fs.readFileSync(statusFile, "utf8")) as PaperCompileStatus;
    // A different server process may own a current build. Once its bounded
    // execution window has passed, expose a retryable terminal state. Derive
    // this without rewriting the file, since another process could publish a
    // newer result while the status is being read.
    let reference = 0;
    if (stored.state === "running" && !running.has(projectDir)) {
      const started = stored.startedAt ? Date.parse(stored.startedAt) : Number.NaN;
      reference = Number.isFinite(started) && started <= Date.now() ? started : fs.statSync(statusFile).mtimeMs;
    }
    const interrupted = reference > 0 && Date.now() - reference > COMPILE_RECOVERY_MS;
    const status: PaperCompileStatus = interrupted ? {
      ...stored,
      state: "error",
      completedAt: new Date(reference + COMPILE_RECOVERY_MS).toISOString(),
      message: "The compile did not finish within its recovery window. Retry compilation.",
    } : stored;
    // A PDF is addressable only when its immutable artifact manifest is
    // present as well. Older projects can retain a bare `paper.pdf` from a
    // pre-manifest build; reporting it as available makes the client request
    // a URL that the artifact-checked route must reject.
    const artifact = readArtifactManifest(projectDir);
    const pdfAvailable = Boolean(artifact && fs.existsSync(compiledPdfFile(projectDir, artifact.artifactId)));
    let stale = status.stale;
    const expectedBuildInputHash = status.buildInputHash || artifact?.buildInputHash;
    if (expectedBuildInputHash && status.state !== "running") {
      try {
        stale = currentBuildInput(projectDir).buildInputHash !== (artifact?.buildInputHash || expectedBuildInputHash);
      } catch {
        // Keep the persisted indicator when the source is temporarily unreadable.
      }
    }
    return {
      ...status,
      pdfAvailable,
      ...(artifact ? {
        artifactId: artifact.artifactId,
        artifactSourceHash: artifact.sourceHash,
        artifactBuildInputHash: artifact.buildInputHash,
        ...(status.buildInputHash ? {} : { buildInputHash: artifact.buildInputHash }),
      } : {}),
      ...(stale === undefined ? {} : { stale }),
      ...(pdfAvailable && status.state === "success" ? { pageBudget: inspectPaperPageBudget(projectDir, artifact?.artifactId) } : {}),
    };
  } catch {
    return { state: "idle" };
  }
}

export function requestPaperCompile(projectDir: string): PaperCompileStatus {
  const current = getPaperCompileStatus(projectDir);
  const target = currentBuildInput(projectDir);
  if (running.has(projectDir)) {
    const targetChanged = current.buildInputHash !== target.buildInputHash;
    if (targetChanged) queuedAfterCurrent.add(projectDir);
    return {
      state: "running",
      jobId: current.jobId,
      sourceHash: target.sourceHash,
      buildInputHash: target.buildInputHash,
      startedAt: current.startedAt || new Date().toISOString(),
      stale: targetChanged || current.stale === true || artifactIsStale(projectDir, target.buildInputHash),
      compiler: "latexmk",
      engine: target.config.engine,
      ...(target.config.texliveVersion ? { texliveVersion: target.config.texliveVersion } : {}),
    };
  }
  if (
    current.state === "success"
    && current.buildInputHash === target.buildInputHash
    && current.artifactBuildInputHash === target.buildInputHash
    && current.pdfAvailable
    && current.artifactId
  ) return current;

  const jobId = `compile-${randomUUID()}`;
  const status: PaperCompileStatus = {
    state: "running",
    jobId,
    sourceHash: target.sourceHash,
    buildInputHash: target.buildInputHash,
    startedAt: new Date().toISOString(),
    stale: artifactIsStale(projectDir, target.buildInputHash),
    compiler: "latexmk",
    engine: target.config.engine,
    ...(target.config.texliveVersion ? { texliveVersion: target.config.texliveVersion } : {}),
  };
  persistStatus(projectDir, status);
  const job = runLatexmk(projectDir, target, jobId)
    .catch((error): PaperCompileStatus => ({
      state: "error",
      jobId,
      sourceHash: target.sourceHash,
      buildInputHash: target.buildInputHash,
      compiler: "latexmk",
      engine: target.config.engine,
      ...(target.config.texliveVersion ? { texliveVersion: target.config.texliveVersion } : {}),
      completedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      diagnostics: [error instanceof Error ? error.message : String(error)],
      parsedDiagnostics: [],
    }))
    .then((result) => {
      persistStatus(projectDir, result);
      running.delete(projectDir);
      let changedDuringBuild = queuedAfterCurrent.delete(projectDir);
      try {
        changedDuringBuild ||= currentBuildInput(projectDir).buildInputHash !== target.buildInputHash;
      } catch {
        // The just-written status remains useful if source vanished mid-build.
      }
      if (changedDuringBuild) requestPaperCompile(projectDir);
      return result;
    });
  running.set(projectDir, job);
  return status;
}

export function getCompiledPdf(projectDir: string, artifactId?: string): Buffer | null {
  try {
    const artifact = readArtifactManifest(projectDir, artifactId);
    if (!artifact) return null;
    return fs.readFileSync(compiledPdfFile(projectDir, artifact.artifactId));
  } catch {
    return null;
  }
}

function persistStatus(projectDir: string, status: PaperCompileStatus): void {
  const artifact = readArtifactManifest(projectDir);
  const pdfAvailable = Boolean(artifact && fs.existsSync(compiledPdfFile(projectDir, artifact.artifactId)));
  const artifactFields = artifact ? {
    artifactId: artifact.artifactId,
    artifactSourceHash: artifact.sourceHash,
    artifactBuildInputHash: artifact.buildInputHash,
    ...(status.buildInputHash ? {} : { buildInputHash: artifact.buildInputHash }),
  } : {};
  writeTextAtomic(
    compileStatusFile(projectDir),
    `${JSON.stringify({
      ...status,
      pdfAvailable,
      ...artifactFields,
    }, null, 2)}\n`,
  );
}

export function latexmkArgs(buildDir: string, rootFile = "paper.tex", engine: TexEngine = "pdflatex"): string[] {
  const engineFlag = engine === "xelatex" ? "-pdfxe" : engine === "lualatex" ? "-pdflua" : "-pdf";
  return [engineFlag, "-interaction=nonstopmode", "-file-line-error", "-no-shell-escape", "-norc", "-synctex=1", "-jobname=paper", `-outdir=${buildDir}`, rootFile];
}

const DEFAULT_COMPILER_PATH = process.platform === "win32"
  ? `C:\\Windows${path.win32.sep}System32`
  : "/usr/local/bin:/usr/bin:/bin";
const STANDARD_COMPILER_LOCALE = "C.UTF-8";

export type CompilerEnvironmentOptions = {
  /** Source environment used for the small allowlist. Tests can provide a fixture. */
  base?: Record<string, string | undefined>;
  /** TeX installation directories appended to the inherited executable path. */
  extraPathEntries?: readonly string[];
  /** Disposable HOME used by the compiler process. */
  home?: string;
  /** Disposable temporary directory used by the compiler process. */
  tempDir?: string;
  /** Snapshot source directory followed by TeX's normal search path. */
  texInputs?: string;
};

/**
 * Build the compiler environment from an explicit allowlist.
 *
 * TeX receives executable lookup, locale, temporary-directory, and source
 * search settings. Application credentials and arbitrary process markers stay
 * in the parent process. This boundary controls environment exposure while
 * filesystem and process isolation remain deployment responsibilities.
 */
export function compilerEnv(options: CompilerEnvironmentOptions = {}): NodeJS.ProcessEnv {
  const base = options.base || process.env;
  const extra = options.extraPathEntries === undefined ? discoverTexBinDirs() : options.extraPathEntries;
  const pathEntries = [base.PATH, ...extra]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  const compilerPath = [...new Set(pathEntries)].join(path.delimiter) || DEFAULT_COMPILER_PATH;
  const tempDir = options.tempDir || base.TMPDIR || base.TEMP || base.TMP || os.tmpdir();
  const home = options.home || base.HOME || os.homedir();
  const environment = {
    PATH: compilerPath,
    HOME: home,
    TMPDIR: tempDir,
    TEMP: tempDir,
    TMP: tempDir,
    LANG: STANDARD_COMPILER_LOCALE,
    LC_ALL: STANDARD_COMPILER_LOCALE,
    LC_CTYPE: STANDARD_COMPILER_LOCALE,
    openin_any: "p",
    openout_any: "p",
  } as unknown as NodeJS.ProcessEnv;
  if (options.texInputs !== undefined) environment.TEXINPUTS = options.texInputs;
  return environment;
}

let availabilityCache: { key: string; available: boolean; expires: number } | undefined;

function latexmkAvailable(): boolean {
  const key = `${process.env.PATH || ""}:${process.env.OPENBARRY_TEX_BIN || ""}`;
  if (availabilityCache?.key === key && availabilityCache.expires > Date.now()) return availabilityCache.available;
  let available = false;
  try {
    execFileSync("latexmk", ["-v"], { stdio: "ignore", timeout: 4_000, env: compilerEnv() });
    available = true;
  } catch { /* A later request retries installation discovery. */ }
  availabilityCache = { key, available, expires: Date.now() + (available ? 60_000 : 5_000) };
  return available;
}

function copyManuscriptSnapshot(sourceRoot: string, snapshotRoot: string): void {
  fs.cpSync(sourceRoot, snapshotRoot, {
    recursive: true,
    force: true,
    dereference: true,
    filter: (entry) => {
      const relative = path.relative(sourceRoot, entry);
      if (!shouldIncludeSnapshotPath(relative)) return false;
      snapshotEntry(sourceRoot, entry);
      return true;
    },
  });
}

function shouldIncludeSnapshotPath(relative: string): boolean {
  if (!relative) return true;
  const parts = relative.split(path.sep);
  if (parts[0] === ".git" || parts[0] === "node_modules") return false;
  if (parts.some((part) => part.endsWith(".ob-lock"))) return false;
  if (parts[0] === "wiki") return false;
  if (parts[0] === ".OpenBar" || parts[0] === ".openbarry" || parts[0] === "openbarry") {
    // OpenBar records describe the workspace and maps. Compiler options have
    // their own hash fields, and bibliography sources such as references.bib
    // remain part of the snapshot in both supported project layouts.
    return ![
      "build", "activity.jsonl", "request-replay.json", "request-replay-journal.json", "recovery",
      "mindmap.tex", "mindmaps", "project.tex", "project.json", "wiki", "skills",
    ].includes(parts[1] || "");
  }
  return true;
}

function copyCompilerOutputs(snapshotBuildDir: string, canonicalBuildDir: string, artifactId: string, snapshotRoot: string, sourceRoot: string): void {
  const pdf = path.join(snapshotBuildDir, "paper.pdf");
  if (!fs.existsSync(pdf)) throw new Error("latexmk completed without producing paper.pdf.");
  const segment = artifactSegment(artifactId);
  if (!segment) throw new Error("The compiler returned an invalid artifact id.");
  const artifactsDir = path.join(canonicalBuildDir, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });
  const stagingDir = fs.mkdtempSync(path.join(artifactsDir, `.${segment}.tmp-`));
  for (const name of ["paper.pdf", "paper.synctex.gz", "paper.log", "paper.aux", "paper.fls", "paper.fdb_latexmk"]) {
    const source = path.join(snapshotBuildDir, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(stagingDir, name));
  }
  const synctex = path.join(stagingDir, "paper.synctex.gz");
  if (fs.existsSync(synctex)) {
    const text = gunzipSync(fs.readFileSync(synctex)).toString("utf8").replace(/^Input:(\d+):(.+)$/gm, (line, id: string, file: string) => {
      const relative = path.relative(snapshotRoot, path.resolve(snapshotRoot, file.trim()));
      return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
        ? line : `Input:${id}:${path.join(sourceRoot, relative)}`;
    });
    fs.writeFileSync(synctex, gzipSync(text));
  }
  const publishedDir = path.join(artifactsDir, segment);
  fs.rmSync(publishedDir, { recursive: true, force: true });
  fs.renameSync(stagingDir, publishedDir);
}

function writeArtifactManifest(projectDir: string, manifest: PdfArtifactManifest): void {
  writeTextAtomic(artifactManifestFile(projectDir, manifest.artifactId), `${JSON.stringify(manifest, null, 2)}\n`);
  writeTextAtomic(artifactManifestFile(projectDir), `${JSON.stringify(manifest, null, 2)}\n`);
}

function cleanupOldArtifacts(projectDir: string, displayedId = displayedArtifactId(projectDir)): void {
  const artifactsDir = path.join(texPaths(projectDir).buildDir, "artifacts");
  let entries: string[];
  try { entries = fs.readdirSync(artifactsDir); } catch { return; }
  const manifests = entries
    .map((id) => {
      const manifest = readArtifactManifest(projectDir, id);
      return manifest ? { id, createdAt: manifest.createdAt } : null;
    })
    .filter((item): item is { id: string; createdAt: string } => Boolean(item))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const keep = new Set(manifests.slice(0, 10).map((item) => item.id));
  if (displayedId) keep.add(displayedId);
  for (const item of manifests.slice(10)) {
    if (keep.has(item.id)) continue;
    try { fs.rmSync(path.join(artifactsDir, item.id), { recursive: true, force: true }); } catch { /* preserve output when cleanup is unavailable */ }
  }
}

let toolchainCache: { key: string; value: string; expires: number } | undefined;

function compilerToolchainIdentity(): string {
  const key = `${process.env.PATH || ""}:${process.env.OPENBARRY_TEX_BIN || ""}`;
  if (toolchainCache?.key === key && toolchainCache.expires > Date.now()) return toolchainCache.value;
  let value: string;
  try {
    value = execFileSync("latexmk", ["-v"], { encoding: "utf8", timeout: 4_000, env: compilerEnv() }).toString().slice(0, 4_000);
  } catch {
    value = "unavailable";
  }
  toolchainCache = { key, value, expires: Date.now() + (value === "unavailable" ? 5_000 : 60_000) };
  return value;
}

const fileHashCache = new Map<string, { version: string; hash: string }>();

function snapshotFiles(snapshotRoot: string): BuildFileDigest[] {
  const files: BuildFileDigest[] = [];
  if (fileHashCache.size > 10_000) fileHashCache.clear();
  const active = new Set<string>();
  const visit = (directory: string) => {
    const real = fs.realpathSync(directory);
    if (active.has(real)) throw new Error("A symbolic link creates a cycle in the manuscript.");
    active.add(real);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(snapshotRoot, absolute);
      if (!shouldIncludeSnapshotPath(relative)) continue;
      const stat = snapshotEntry(snapshotRoot, absolute);
      if (stat.isDirectory()) visit(absolute);
      else {
        const version = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
        let cached = fileHashCache.get(absolute);
        if (cached?.version !== version) {
          cached = { version, hash: createHash("sha256").update(fs.readFileSync(absolute)).digest("hex") };
          fileHashCache.set(absolute, cached);
        }
        files.push({ path: normalizeBuildPath(relative), size: Number(stat.size), hash: cached.hash });
      }
    }
    active.delete(real);
  };
  visit(snapshotRoot);
  return files;
}

/** Validate the real file that TeX will read, including symbolic link targets. */
function snapshotEntry(root: string, file: string): fs.BigIntStats {
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Compiler input resolves outside the manuscript: ${path.relative(root, file)}`);
  }
  const stat = fs.statSync(file, { bigint: true });
  if (!stat.isFile() && !stat.isDirectory()) throw new Error(`Unsupported compiler input: ${path.relative(root, file)}`);
  return stat;
}

function snapshotDigest(
  snapshotRoot: string,
  sourceHash: string,
  config: CompilerConfig,
  rootFile = "paper.tex",
): string {
  return hashBuildInputRecords({
    sourceHash,
    rootFile,
    config,
    toolchain: compilerToolchainIdentity(),
    files: snapshotFiles(snapshotRoot),
  });
}

function killCompiler(child: { pid?: number; kill: (signal: NodeJS.Signals) => unknown }, signal: NodeJS.Signals): void {
  try {
    if (child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try { child.kill(signal); } catch { /* process already exited */ }
  }
}

async function runLatexmk(projectDir: string, target: BuildInputSnapshot, jobId: string): Promise<PaperCompileStatus> {
  const paths = texPaths(projectDir);
  const startedAt = new Date().toISOString();
  const { sourceHash, buildInputHash, config } = target;
  const context = {
    jobId, sourceHash, buildInputHash, startedAt,
    compiler: "latexmk" as const,
    engine: config.engine,
    ...(config.texliveVersion ? { texliveVersion: config.texliveVersion } : {}),
  };
  if (!latexmkAvailable()) {
    return Promise.resolve({
      state: "unavailable",
      ...context,
      completedAt: new Date().toISOString(),
      message: "latexmk is not installed. Configure TeX Live and latexmk in the project record.",
      diagnostics: ["Install TeX Live with latexmk. This server does not auto-select another compiler."],
      parsedDiagnostics: [],
    });
  }
  const tmpBase = (() => { try { return fs.realpathSync(os.tmpdir()); } catch { return os.tmpdir(); } })();
  const temporaryRoot = fs.mkdtempSync(path.join(tmpBase, "openbar-tex-"));
  const snapshotRoot = path.join(temporaryRoot, "source");
  const buildDir = path.join(temporaryRoot, "build");
  const sourceRoot = path.resolve(paths.manuscriptDir);
  let rootFile = target.rootFile;
  try {
    // Capture the complete compiler input set while the same lock used by
    // source writes is held. A second hash catches an external writer that
    // raced the filesystem copy; mixed snapshots are rejected explicitly.
    const capture = withProjectWriteLock(projectDir, () => {
      const before = paperSourceHash(projectDir);
      const currentConfig = readCompilerConfig(projectDir);
      const sourceRootFile = locateTexRoot(sourceRoot, currentConfig.mainFile);
      copyManuscriptSnapshot(sourceRoot, snapshotRoot);
      const after = paperSourceHash(projectDir);
      const capturedRootFile = normalizeBuildPath(path.relative(sourceRoot, sourceRootFile));
      const capturedBuildInputHash = snapshotDigest(snapshotRoot, before, currentConfig, capturedRootFile);
      if (before !== after || before !== sourceHash || capturedBuildInputHash !== buildInputHash) {
        throw new Error("The compiler inputs changed while the compile snapshot was being captured. Save again and retry.");
      }
      return { sourceHash: before, buildInputHash: capturedBuildInputHash, rootFile: capturedRootFile };
    });
    if (capture.sourceHash !== sourceHash || capture.buildInputHash !== buildInputHash) {
      throw new Error("The compile target is no longer the requested build input.");
    }
    rootFile = capture.rootFile;
  } catch (error) {
    try { fs.rmSync(temporaryRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    return {
      state: "error",
      ...context,
      completedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      diagnostics: [error instanceof Error ? error.message : String(error)],
      parsedDiagnostics: [],
    };
  }
  const cleanup = () => {
    try {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; the compiler result is already durable.
    }
  };
  fs.mkdirSync(buildDir, { recursive: true });
  const compilerHome = path.join(temporaryRoot, "home");
  const compilerTemp = path.join(temporaryRoot, "tmp");
  fs.mkdirSync(compilerHome, { recursive: true, mode: 0o700 });
  fs.mkdirSync(compilerTemp, { recursive: true, mode: 0o700 });
  const { execa } = await import("execa");
  const child = execa("latexmk", latexmkArgs(buildDir, rootFile, config.engine), {
    cwd: snapshotRoot,
    env: compilerEnv({
      home: compilerHome,
      tempDir: compilerTemp,
      texInputs: `${snapshotRoot}${path.delimiter}`,
    }),
    extendEnv: false,
    stdin: "ignore",
    all: true,
    buffer: false,
    reject: false,
    detached: true,
    forceKillAfterDelay: 5_000,
  });
  let output = "";
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let statusFlushTimer: ReturnType<typeof setTimeout> | undefined;
  let lastStatusWriteAt = 0;
  let timedOut = false;
  const flushRunningStatus = () => {
    if (statusFlushTimer) { clearTimeout(statusFlushTimer); statusFlushTimer = undefined; }
    lastStatusWriteAt = Date.now();
    persistStatus(projectDir, {
      state: "running",
      ...context,
      stale: artifactIsStale(projectDir, buildInputHash),
      rawLog: output,
      lastLines: tail(output, 5),
    });
  };
  const onChunk = (chunk: Buffer) => {
    output += chunk.toString();
    output = boundedLog(output);
    const elapsed = Date.now() - lastStatusWriteAt;
    if (elapsed >= 500) {
      flushRunningStatus();
    } else if (!statusFlushTimer) {
      statusFlushTimer = setTimeout(flushRunningStatus, 500 - elapsed);
    }
  };
  child.all!.on("data", onChunk);
  const timeout = setTimeout(() => {
    timedOut = true;
    if (statusFlushTimer) { clearTimeout(statusFlushTimer); statusFlushTimer = undefined; }
    persistStatus(projectDir, {
      state: "running",
      ...context,
      stale: artifactIsStale(projectDir, buildInputHash),
      message: "Compilation exceeded the five-minute limit. Terminating the compiler process tree.",
      rawLog: boundedLog(output),
      lastLines: tail(output, 8),
    });
    killCompiler(child, "SIGTERM");
    killTimer = setTimeout(() => killCompiler(child, "SIGKILL"), 5_000);
  }, 300_000);
  const result = await child;
  clearTimeout(timeout);
  if (statusFlushTimer) clearTimeout(statusFlushTimer);
  if (killTimer) clearTimeout(killTimer);
  if (timedOut) killCompiler(child, "SIGKILL");
  const finish = (status: PaperCompileStatus) => {
    cleanup();
    return status;
  };
  const { exitCode: code, signal } = result;
  if (result.code) {
    const unavailable = result.code === "ENOENT";
    const message = unavailable ? "latexmk could not be started. Install TeX Live." : redactSensitiveText(result.originalMessage || "latexmk could not be started.");
    return finish({
      state: unavailable ? "unavailable" : "error",
      ...context,
      completedAt: new Date().toISOString(),
      message, diagnostics: [message], parsedDiagnostics: [], rawLog: boundedLog(output),
    });
  }
  const succeeded = code === 0 && !timedOut && !result.failed;
  let diagnosticLog = output;
  try {
    const finalPassLog = fs.readFileSync(path.join(buildDir, "paper.log"), "utf8");
    // The final TeX pass reflects resolved citations and references. Failed
    // builds also need latexmk and bibliography-tool errors from the process.
    diagnosticLog = succeeded ? finalPassLog : `${finalPassLog}\n${output}`;
  } catch {
    // Process output remains available when TeX could not create its log.
  }
  const diagnostics = parseDiagnostics(diagnosticLog, snapshotRoot);
  const parsedDiagnostics = parseTexFileLines(diagnostics);
  if (succeeded) {
    const artifactId = `pdf-${buildInputHash.slice(0, 16)}-${jobId.slice(-12)}`;
    try {
      // Recheck the same complete compiler input identity used by cache
      // hits and status freshness. Assets, bibliography files, and
      // compiler metadata can change while TeX is running and otherwise
      // produce a mixed PDF that looks current to the editor.
      const finalInput = currentBuildInput(projectDir);
      if (finalInput.sourceHash !== sourceHash || finalInput.buildInputHash !== buildInputHash) {
        return finish({
          state: "error",
          ...context,
          completedAt: new Date().toISOString(),
          message: "The compiler inputs changed while TeX was compiling; the PDF was discarded.",
          diagnostics: ["Source or an included compiler input changed during compile. The last successful artifact is unchanged."],
          parsedDiagnostics: [],
          stale: true,
          rawLog: boundedLog(output),
        });
      }
      copyCompilerOutputs(buildDir, paths.buildDir, artifactId, snapshotRoot, sourceRoot);
      writeArtifactManifest(projectDir, {
        ...context,
        artifactId,
        createdAt: new Date().toISOString(),
      });
      cleanupOldArtifacts(projectDir);
    } catch (error) {
      return finish({
        state: "error",
        ...context,
        completedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : String(error),
        diagnostics: [error instanceof Error ? error.message : String(error)],
        parsedDiagnostics: [],
        rawLog: boundedLog(output),
        stale: false,
      });
    }
    return finish({
      state: "success",
      ...context,
      completedAt: new Date().toISOString(),
      diagnostics,
      parsedDiagnostics,
      rawLog: boundedLog(output),
      stale: false,
      artifactId,
      artifactSourceHash: sourceHash,
    });
  }
  return finish({
    state: "error",
    ...context,
    completedAt: new Date().toISOString(),
    message: timedOut
      ? "TeX compilation exceeded the five-minute limit. The compiler process tree was terminated and the last successful artifact remains available."
      : signal ? `TeX compilation stopped (${signal}).` : `TeX compilation failed with latexmk (exit ${code ?? "unknown"}).`,
    diagnostics: diagnostics.length ? diagnostics : tail(output, 12),
    parsedDiagnostics,
    rawLog: boundedLog(output),
    stale: false,
  });
}

function parseDiagnostics(output: string, snapshotRoot: string): string[] {
  const lines = output.split(/\r?\n/);
  const selected = lines.filter((line) => /(?:^! |\.(?:tex|sty|cls):\d+:|^l\.\d+|(?:LaTeX|Package .*|Class .*) (?:Error|Warning)|^Latexmk:.*(?:error|fail|missing|not found)|^\s*(?:pdf|xe|lua)latex:|^\s*(?:bibtex|biber|makeindex):|^ERROR -|^I (?:couldn't|could not|found no|was expecting)|^Repeated entry---line)/i.test(line));
  const snapshotPrefix = `${snapshotRoot}${path.sep}`;
  const unique = Array.from(new Set(selected.map((line) => {
    const readable = line.trim().split(snapshotPrefix).join("");
    // TeX wraps long diagnostic lines mid-word, so its explanation can be
    // truncated here. Give the common paragraph error a complete next step.
    return readable.replace(/Paragraph ended\b.*/i, "A paragraph break occurred while reading a command. Check for a blank line or a missing closing brace near this line.");
  }).filter(Boolean)));
  const priority = (line: string) => /\bWarning\b/i.test(line) ? 2 : /^l\.\d+/.test(line) ? 1 : 0;
  // TeX can continue producing warnings after the first fatal error. Keep
  // actionable errors and their source context ahead of the warning limit.
  return unique.sort((left, right) => priority(left) - priority(right)).slice(0, 16);
}

function tail(value: string, count: number): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-count);
}

function boundedLog(value: string): string {
  const maxChars = 100_000;
  return value.length > maxChars ? value.slice(-maxChars) : value;
}
