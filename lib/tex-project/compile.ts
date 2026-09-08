import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeTextAtomic } from "./codec";
import { inspectPaperPageBudget, type PaperPageBudget } from "./page-budget";
import { paperSourceHash, readProjectRecord, texPaths } from "./project";
import { locateTexRoot } from "./source-graph";
import { parseTexFileLines, type TexFileLine } from "./tex-diagnostics";
import { discoverTexBinDirs } from "./latexpand";
import { withWriteLock } from "./codec";

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

const running = new Map<string, Promise<PaperCompileStatus>>();
const queuedAfterCurrent = new Set<string>();

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

export function getPaperCompileStatus(projectDir: string): PaperCompileStatus {
  try {
    const status = JSON.parse(fs.readFileSync(compileStatusFile(projectDir), "utf8")) as PaperCompileStatus;
    // A PDF is addressable only when its immutable artifact manifest is
    // present as well. Older projects can retain a bare `paper.pdf` from a
    // pre-manifest build; reporting it as available makes the client request
    // a URL that the artifact-checked route must reject.
    const artifact = readArtifactManifest(projectDir);
    const pdfAvailable = Boolean(artifact && fs.existsSync(compiledPdfFile(projectDir, artifact.artifactId)));
    let stale = status.stale;
    if (status.sourceHash) {
      try {
        stale = paperSourceHash(projectDir) !== status.sourceHash;
      } catch {
        // Keep the persisted indicator when the source is temporarily unreadable.
      }
    }
    return {
      ...status,
      pdfAvailable,
      ...(artifact ? { artifactId: artifact.artifactId, artifactSourceHash: artifact.sourceHash, buildInputHash: artifact.buildInputHash } : {}),
      ...(stale === undefined ? {} : { stale }),
      ...(pdfAvailable && status.state === "success" ? { pageBudget: inspectPaperPageBudget(projectDir, artifact?.artifactId) } : {}),
    };
  } catch {
    return { state: "idle" };
  }
}

export function requestPaperCompile(projectDir: string): PaperCompileStatus {
  const current = getPaperCompileStatus(projectDir);
  const newestHash = paperSourceHash(projectDir);
  if (running.has(projectDir)) {
    if (current.sourceHash !== newestHash) queuedAfterCurrent.add(projectDir);
    return {
      state: "running",
      jobId: current.jobId,
      sourceHash: newestHash,
      startedAt: current.startedAt || new Date().toISOString(),
      stale: current.sourceHash !== newestHash,
      compiler: "latexmk",
    };
  }
  const sourceHash = newestHash;
  if (current.state === "success" && current.sourceHash === sourceHash && current.pdfAvailable && current.artifactId) return current;

  const jobId = `compile-${randomUUID()}`;
  const status: PaperCompileStatus = { state: "running", jobId, sourceHash, startedAt: new Date().toISOString(), stale: false, compiler: "latexmk" };
  persistStatus(projectDir, status);
  const job = runLatexmk(projectDir, sourceHash, jobId)
    .catch((error): PaperCompileStatus => ({
      state: "error",
      jobId,
      sourceHash,
      compiler: "latexmk",
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
        changedDuringBuild ||= paperSourceHash(projectDir) !== sourceHash;
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
  writeTextAtomic(
    compileStatusFile(projectDir),
    `${JSON.stringify({
      ...status,
      pdfAvailable,
      ...(artifact ? { artifactId: artifact.artifactId, artifactSourceHash: artifact.sourceHash, buildInputHash: artifact.buildInputHash } : {}),
    }, null, 2)}\n`,
  );
}

export function latexmkArgs(buildDir: string, rootFile = "paper.tex", engine: TexEngine = "pdflatex"): string[] {
  const engineFlag = engine === "xelatex" ? "-pdfxe" : engine === "lualatex" ? "-pdflua" : "-pdf";
  return [engineFlag, "-interaction=nonstopmode", "-file-line-error", "-no-shell-escape", "-norc", "-synctex=1", "-jobname=paper", `-outdir=${buildDir}`, rootFile];
}

function compilerEnv(): NodeJS.ProcessEnv {
  const extra = discoverTexBinDirs();
  return { ...process.env, PATH: [...new Set([process.env.PATH || "", ...extra].filter(Boolean))].join(path.delimiter) };
}

function latexmkAvailable(): boolean {
  try {
    execFileSync("latexmk", ["-v"], { stdio: "ignore", timeout: 4_000, env: compilerEnv() });
    return true;
  } catch {
    return false;
  }
}

function copyManuscriptSnapshot(sourceRoot: string, snapshotRoot: string): void {
  fs.cpSync(sourceRoot, snapshotRoot, {
    recursive: true,
    force: true,
    filter: (entry) => {
      const relative = path.relative(sourceRoot, entry);
      return shouldIncludeSnapshotPath(relative);
    },
  });
}

function shouldIncludeSnapshotPath(relative: string): boolean {
  if (!relative) return true;
  const parts = relative.split(path.sep);
  if (parts[0] === ".git" || parts[0] === "node_modules") return false;
  if (parts[0] === ".OpenBar" || parts[0] === ".openbarry") {
    return !["build", "activity.jsonl", "request-replay.json", "recovery"].includes(parts[1] || "");
  }
  return true;
}

function copyCompilerOutputs(snapshotBuildDir: string, canonicalBuildDir: string, artifactId: string): void {
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

function snapshotDigest(snapshotRoot: string, sourceHash: string, config: CompilerConfig): string {
  const hash = createHash("sha256");
  let toolchain = "unavailable";
  try {
    toolchain = execFileSync("latexmk", ["-v"], { encoding: "utf8", timeout: 4_000, env: compilerEnv() }).toString().slice(0, 4_000);
  } catch {
    // The unavailable compiler state is captured in the build status.
  }
  hash.update(JSON.stringify({ sourceHash, compiler: config.compiler, engine: config.engine, texliveVersion: config.texliveVersion || "", mainFile: config.mainFile || "", toolchain }));
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(snapshotRoot, absolute);
      if (!shouldIncludeSnapshotPath(relative)) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  visit(snapshotRoot);
  for (const file of files) {
    hash.update(path.relative(snapshotRoot, file).split(path.sep).join("/"));
    hash.update(fs.readFileSync(file));
  }
  return hash.digest("hex");
}

function killCompiler(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  try {
    if (child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try { child.kill(signal); } catch { /* process already exited */ }
  }
}

async function runLatexmk(projectDir: string, sourceHash: string, jobId: string): Promise<PaperCompileStatus> {
  const paths = texPaths(projectDir);
  const startedAt = new Date().toISOString();
  const config = readCompilerConfig(projectDir);
  if (!latexmkAvailable()) {
    return Promise.resolve({
      state: "unavailable",
      jobId,
      sourceHash,
      startedAt,
      completedAt: new Date().toISOString(),
      compiler: "latexmk",
      engine: config.engine,
      ...(config.texliveVersion ? { texliveVersion: config.texliveVersion } : {}),
      message: "latexmk is not installed. Configure TeX Live and latexmk in the project record.",
      diagnostics: ["Install TeX Live with latexmk. This server does not auto-select another compiler."],
      parsedDiagnostics: [],
    });
  }
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openbar-tex-"));
  const snapshotRoot = path.join(temporaryRoot, "source");
  const buildDir = path.join(temporaryRoot, "build");
  const sourceRoot = path.resolve(paths.manuscriptDir);
  let buildInputHash = "";
  let rootFile = "";
  try {
    // Capture the complete include graph while the same lock used by source
    // writes is held. A second hash catches an external writer that raced the
    // filesystem copy; mixed snapshots are rejected explicitly.
    const capture = withWriteLock(path.resolve(paths.paperFile), () => {
      const before = paperSourceHash(projectDir);
      const sourceRootFile = locateTexRoot(sourceRoot, config.mainFile);
      copyManuscriptSnapshot(sourceRoot, snapshotRoot);
      const after = paperSourceHash(projectDir);
      if (before !== after || before !== sourceHash) {
        throw new Error("The manuscript changed while the compile snapshot was being captured. Save again and retry.");
      }
      rootFile = path.relative(sourceRoot, sourceRootFile).split(path.sep).join("/");
      buildInputHash = snapshotDigest(snapshotRoot, before, config);
      return before;
    });
    if (capture !== sourceHash) throw new Error("The compile target is no longer the requested source revision.");
  } catch (error) {
    try { fs.rmSync(temporaryRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    return {
      state: "error",
      jobId,
      sourceHash,
      startedAt,
      completedAt: new Date().toISOString(),
      compiler: "latexmk",
      engine: config.engine,
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
  return new Promise((resolve) => {
    fs.mkdirSync(buildDir, { recursive: true });
    const child = spawn("latexmk", latexmkArgs(buildDir, rootFile, config.engine), {
      cwd: snapshotRoot,
      env: { ...compilerEnv(), TEXINPUTS: `${snapshotRoot}${path.delimiter}` },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let output = "";
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const onChunk = (chunk: Buffer) => {
      output += chunk.toString();
      output = boundedLog(output);
      persistStatus(projectDir, {
        state: "running",
        jobId,
        sourceHash,
        startedAt,
        stale: false,
        compiler: "latexmk",
        engine: config.engine,
        rawLog: output,
        lastLines: tail(output, 5),
      });
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    const timeout = setTimeout(() => {
      timedOut = true;
      persistStatus(projectDir, {
        state: "running",
        jobId,
        sourceHash,
        startedAt,
        stale: false,
        compiler: "latexmk",
        engine: config.engine,
        message: "Compilation exceeded the five-minute limit. Terminating the compiler process tree.",
        rawLog: boundedLog(output),
        lastLines: tail(output, 8),
      });
      killCompiler(child, "SIGTERM");
      killTimer = setTimeout(() => killCompiler(child, "SIGKILL"), 5_000);
    }, 300_000);
    const finish = (status: PaperCompileStatus) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      cleanup();
      resolve(status);
    };
    child.on("error", (error) => {
      const unavailable = (error as NodeJS.ErrnoException).code === "ENOENT";
      finish({
        state: unavailable ? "unavailable" : "error",
        jobId,
        sourceHash,
        compiler: "latexmk",
        engine: config.engine,
        startedAt,
        completedAt: new Date().toISOString(),
        message: unavailable
          ? "latexmk could not be started. Install TeX Live."
          : error.message,
        diagnostics: unavailable ? ["latexmk could not be started. Install TeX Live."] : [error.message],
        parsedDiagnostics: [],
        rawLog: boundedLog(output),
      });
    });
    child.on("close", (code, signal) => {
      const diagnostics = parseDiagnostics(output).slice(-16);
      const parsedDiagnostics = parseTexFileLines(diagnostics);
      if (code === 0) {
        const artifactId = `pdf-${sourceHash.slice(0, 16)}-${jobId.slice(-12)}`;
        try {
          // Recheck the complete compiler input set, not only the TeX graph
          // hash. Assets, bibliography files, and compiler metadata can
          // change while TeX is running and otherwise produce a mixed PDF
          // that looks current to the editor.
          const finalInput = withWriteLock(path.resolve(paths.paperFile), () => {
            const finalSourceHash = paperSourceHash(projectDir);
            return {
              sourceHash: finalSourceHash,
              buildInputHash: snapshotDigest(sourceRoot, finalSourceHash, config),
            };
          });
          if (finalInput.sourceHash !== sourceHash || finalInput.buildInputHash !== buildInputHash) {
            finish({
              state: "error",
              jobId,
              sourceHash,
              compiler: "latexmk",
              engine: config.engine,
              startedAt,
              completedAt: new Date().toISOString(),
              message: "The compiler inputs changed while TeX was compiling; the PDF was discarded.",
              diagnostics: ["Source or an included compiler input changed during compile. The last successful artifact is unchanged."],
              parsedDiagnostics: [],
              stale: true,
              rawLog: boundedLog(output),
            });
            return;
          }
          copyCompilerOutputs(buildDir, paths.buildDir, artifactId);
          writeArtifactManifest(projectDir, {
            artifactId,
            sourceHash,
            buildInputHash,
            jobId,
            compiler: "latexmk",
            engine: config.engine,
            createdAt: new Date().toISOString(),
          });
          cleanupOldArtifacts(projectDir);
        } catch (error) {
          finish({
            state: "error",
            jobId,
            sourceHash,
            compiler: "latexmk",
            engine: config.engine,
            startedAt,
            completedAt: new Date().toISOString(),
            message: error instanceof Error ? error.message : String(error),
            diagnostics: [error instanceof Error ? error.message : String(error)],
            parsedDiagnostics: [],
            rawLog: boundedLog(output),
            stale: false,
          });
          return;
        }
        finish({
          state: "success",
          jobId,
          sourceHash,
          startedAt,
          completedAt: new Date().toISOString(),
          diagnostics,
          parsedDiagnostics,
          rawLog: boundedLog(output),
          stale: false,
          compiler: "latexmk",
          engine: config.engine,
          artifactId,
          artifactSourceHash: sourceHash,
          buildInputHash,
          ...(config.texliveVersion ? { texliveVersion: config.texliveVersion } : {}),
        });
        return;
      }
      finish({
        state: "error",
        jobId,
        sourceHash,
        compiler: "latexmk",
        engine: config.engine,
        startedAt,
        completedAt: new Date().toISOString(),
        message: timedOut
          ? "TeX compilation exceeded the five-minute limit. The compiler process tree was terminated and the last successful artifact remains available."
          : signal ? `TeX compilation stopped (${signal}).` : `TeX compilation failed with latexmk (exit ${code ?? "unknown"}).`,
        diagnostics: diagnostics.length ? diagnostics : tail(output, 12),
        parsedDiagnostics,
        rawLog: boundedLog(output),
        stale: false,
      });
    });
  });
}

function parseDiagnostics(output: string): string[] {
  const lines = output.split(/\r?\n/);
  const selected = lines.filter((line) => /(?:^! |(?:\.tex:|l\.\d+)|LaTeX (?:Error|Warning)|Package .* (?:Error|Warning))/i.test(line));
  return Array.from(new Set(selected.map((line) => line.trim()).filter(Boolean))).slice(-16);
}

function tail(value: string, count: number): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(-count);
}

function boundedLog(value: string): string {
  const maxChars = 100_000;
  return value.length > maxChars ? value.slice(-maxChars) : value;
}
