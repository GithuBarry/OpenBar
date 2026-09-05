import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { writeTextAtomic } from "./codec";
import { inspectPaperPageBudget, type PaperPageBudget } from "./page-budget";
import { paperSourceHash, texPaths } from "./project";
import { locateTexRoot } from "./source-graph";
import { parseTexFileLines, type TexFileLine } from "./tex-diagnostics";

export type { TexFileLine };
export { parseTexFileLines };

export type CompileState = "idle" | "running" | "success" | "error" | "unavailable";

export interface PaperCompileStatus {
  state: CompileState;
  /** Stable identifier for this particular compile request. */
  jobId?: string;
  /** True when the build directory still contains the last successful PDF. */
  pdfAvailable?: boolean;
  sourceHash?: string;
  /** True when the result was built from a different source revision. */
  stale?: boolean;
  completedAt?: string;
  startedAt?: string;
  message?: string;
  diagnostics?: string[];
  parsedDiagnostics?: TexFileLine[];
  /** Bounded raw latexmk output for precise follow-up without unbounded logs. */
  rawLog?: string;
  compiler?: "latexmk" | "tectonic";
  lastLines?: string[];
  pageBudget?: PaperPageBudget;
}

const running = new Map<string, Promise<PaperCompileStatus>>();
const queuedAfterCurrent = new Set<string>();

export function compileStatusFile(projectDir: string): string {
  return path.join(texPaths(projectDir).buildDir, "status.json");
}

export function compiledPdfFile(projectDir: string): string {
  return path.join(texPaths(projectDir).buildDir, "paper.pdf");
}

export function getPaperCompileStatus(projectDir: string): PaperCompileStatus {
  try {
    const status = JSON.parse(fs.readFileSync(compileStatusFile(projectDir), "utf8")) as PaperCompileStatus;
    const pdfAvailable = fs.existsSync(compiledPdfFile(projectDir));
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
      ...(stale === undefined ? {} : { stale }),
      ...(pdfAvailable && status.state === "success" ? { pageBudget: inspectPaperPageBudget(projectDir) } : {}),
    };
  } catch {
    return { state: "idle" };
  }
}

/** Start a coalesced background latexmk build and return immediately. */
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
    };
  }
  const sourceHash = newestHash;
  if (current.state === "success" && current.sourceHash === sourceHash && fs.existsSync(compiledPdfFile(projectDir))) return current;

  const jobId = `compile-${randomUUID()}`;
  const status: PaperCompileStatus = { state: "running", jobId, sourceHash, startedAt: new Date().toISOString(), stale: false };
  persistStatus(projectDir, status);
  const job = runLatexmk(projectDir, sourceHash, jobId)
    .catch((error): PaperCompileStatus => ({
      state: "error",
      jobId,
      sourceHash,
      completedAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
      diagnostics: [error instanceof Error ? error.message : String(error)],
      parsedDiagnostics: [],
    }))
    .then((result) => {
      persistStatus(projectDir, result);
      running.delete(projectDir);
      // If a save landed during this build, immediately coalesce one fresh
      // compile. The preview therefore cannot remain permanently stale.
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

export function getCompiledPdf(projectDir: string): Buffer | null {
  try {
    return fs.readFileSync(compiledPdfFile(projectDir));
  } catch {
    return null;
  }
}

function persistStatus(projectDir: string, status: PaperCompileStatus): void {
  writeTextAtomic(
    compileStatusFile(projectDir),
    `${JSON.stringify({ ...status, pdfAvailable: fs.existsSync(compiledPdfFile(projectDir)) }, null, 2)}\n`,
  );
}

export function latexmkArgs(buildDir: string, rootFile = "paper.tex"): string[] {
  return ["-pdf", "-interaction=nonstopmode", "-file-line-error", "-no-shell-escape", "-norc", "-synctex=1", "-jobname=paper", `-outdir=${buildDir}`, rootFile];
}

export function tectonicArgs(buildDir: string, rootFile = "paper.tex"): string[] {
  return ["--outdir", buildDir, "--keep-logs", "--synctex", "--untrusted", rootFile];
}

function findCompiler(): "latexmk" | "tectonic" | null {
  for (const candidate of ["latexmk", "tectonic"] as const) {
    try {
      execFileSync(candidate, ["--version"], {
        stdio: "ignore",
        timeout: 4_000,
        env: process.env,
      });
      return candidate;
    } catch {
      // Try the next supported compiler.
    }
  }
  return null;
}

function runLatexmk(projectDir: string, sourceHash: string, jobId: string): Promise<PaperCompileStatus> {
  const paths = texPaths(projectDir);
  fs.mkdirSync(paths.buildDir, { recursive: true });
  const buildDir = path.resolve(paths.buildDir);
  const startedAt = new Date().toISOString();
  const rootFile = path.relative(paths.manuscriptDir, locateTexRoot(paths.manuscriptDir)).split(path.sep).join("/");
  const compiler = findCompiler();
  if (!compiler) {
    return Promise.resolve({
      state: "unavailable",
      jobId,
      sourceHash,
      startedAt,
      completedAt: new Date().toISOString(),
      message: "No supported TeX compiler is installed on this server.",
      diagnostics: ["Install latexmk or tectonic to enable PDF preview."],
      parsedDiagnostics: [],
    });
  }
  return new Promise((resolve) => {
    const child = spawn(compiler, compiler === "tectonic" ? tectonicArgs(buildDir, rootFile) : latexmkArgs(buildDir, rootFile), {
      cwd: paths.manuscriptDir,
      env: { ...process.env, TEXINPUTS: `${paths.manuscriptDir}${path.delimiter}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const onChunk = (chunk: Buffer) => {
      output += chunk.toString();
      output = boundedLog(output);
      persistStatus(projectDir, {
        state: "running",
        jobId,
        sourceHash,
        startedAt,
        stale: false,
        compiler,
        rawLog: output,
        lastLines: tail(output, 5),
      });
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, 60_000);
    const finish = (status: PaperCompileStatus) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve(status);
    };
    child.on("error", (error) => {
      const unavailable = (error as NodeJS.ErrnoException).code === "ENOENT";
      finish({
        state: unavailable ? "unavailable" : "error",
        jobId,
        sourceHash,
        compiler,
        startedAt,
        completedAt: new Date().toISOString(),
        message: unavailable ? `The ${compiler} compiler could not be started.` : error.message,
        diagnostics: unavailable ? [`The ${compiler} compiler could not be started.`] : [error.message],
        parsedDiagnostics: [],
        rawLog: boundedLog(output),
      });
    });
    child.on("close", (code, signal) => {
      const diagnostics = parseDiagnostics(output).slice(-16);
      const parsedDiagnostics = parseTexFileLines(diagnostics);
      if (code === 0 && compiler === "tectonic") {
        const tectonicPdf = path.join(buildDir, `${path.basename(rootFile, path.extname(rootFile))}.pdf`);
        if (tectonicPdf !== compiledPdfFile(projectDir) && fs.existsSync(tectonicPdf)) {
          fs.copyFileSync(tectonicPdf, compiledPdfFile(projectDir));
        }
      }
      if (code === 0 && fs.existsSync(compiledPdfFile(projectDir))) {
        finish({ state: "success", jobId, sourceHash, startedAt, completedAt: new Date().toISOString(), diagnostics, parsedDiagnostics, rawLog: boundedLog(output), stale: false, compiler });
        return;
      }
      finish({
        state: "error",
        jobId,
        sourceHash,
        compiler,
        startedAt,
        completedAt: new Date().toISOString(),
        message: signal ? `TeX compilation stopped (${signal}).` : `TeX compilation failed with ${compiler} (exit ${code ?? "unknown"}).`,
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
