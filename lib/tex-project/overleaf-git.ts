import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { hasTexProject, texPaths, writePaperProject, writeProjectRecord } from "./project";
import { gitProcessEnv } from "@/lib/server/git-credential-store";
import { redactGitRemote, redactSensitiveText } from "@/lib/server/git-url";

const execFileAsync = promisify(execFile);

export interface OverleafGitStatus {
  isGitRepo: boolean;
  branch?: string;
  remoteUrl?: string;
  isClean?: boolean;
  ahead?: number;
  behind?: number;
  changedFiles?: string[];
  lastCommit?: {
    hash: string;
    message: string;
    author: string;
    date: string;
  };
  error?: string;
}

export interface TexGitRepoInspection {
  repositoryPath: string;
  texFiles: string[];
  hasPaperSource: boolean;
  status: OverleafGitStatus;
}

export interface PorcelainEntry {
  xy: string;
  path: string;
  origPath?: string;
}

interface GitIndexSnapshot {
  path: string;
  data: Buffer | null;
}

function gitErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const err = error as { stderr?: unknown; message?: unknown };
    if (typeof err.stderr === "string" && err.stderr.trim()) {
      return redactSensitiveText(err.stderr.trim());
    }
    if (typeof err.message === "string") return redactSensitiveText(err.message);
  }
  return redactSensitiveText(String(error));
}

function isSensitivePath(file: string): boolean {
  const normalized = file.replaceAll("\\", "/").toLowerCase();
  const base = normalized.split("/").pop() || normalized;
  return (
    /(^|\/)\.env(?:\.|$)/.test(normalized) ||
    /(^|\/)(credentials?|secrets?|private[-_]?keys?)(?:\.|\/|$)/.test(normalized) ||
    /(?:password|token|secret|api[-_]?key|private[-_]?key)/.test(base) ||
    /\.(?:pem|key|p12|pfx)$/.test(base)
  );
}

export function splitNulRecords(output: string): string[] {
  if (!output) return [];
  const records = output.split("\0");
  if (records[records.length - 1] === "") records.pop();
  return records;
}

/**
 * Parse `git status --porcelain=v1 -z`.
 *
 * Ordinary records are `XY PATH` plus NUL. Rename/copy records are `XY DEST`,
 * NUL, `ORIG`, NUL (destination first), the opposite of `git diff --name-status -z`.
 */
export function parsePorcelainZ(output: string): PorcelainEntry[] {
  const records = splitNulRecords(output);
  const entries: PorcelainEntry[] = [];
  for (let i = 0; i < records.length; i++) {
    const record = records[i]!;
    if (record.length < 3) continue;
    const xy = record.slice(0, 2);
    const filePath = record.slice(3);
    if (xy[0] === "R" || xy[0] === "C") {
      const origPath = records[++i] || "";
      entries.push(origPath ? { xy, path: filePath, origPath } : { xy, path: filePath });
    } else {
      entries.push({ xy, path: filePath });
    }
  }
  return entries;
}

export function porcelainPaths(entries: PorcelainEntry[]): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const file of [entry.path, entry.origPath]) {
      if (!file || seen.has(file)) continue;
      seen.add(file);
      paths.push(file);
    }
  }
  return paths;
}

export function parseNulTerminatedPaths(output: string): string[] {
  return splitNulRecords(output);
}

/**
 * Parse `git diff --name-status -z`. Ordinary changes are `STATUS`, NUL, `PATH`, NUL.
 * Rename/copy records are `R100`, NUL, `ORIG`, NUL, `DEST`, NUL (source first).
 */
export function parseNameStatusZ(output: string): string[] {
  const records = splitNulRecords(output);
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (file: string | undefined) => {
    if (!file || seen.has(file)) return;
    seen.add(file);
    paths.push(file);
  };
  for (let i = 0; i < records.length; i++) {
    const status = records[i]!;
    if (!status) continue;
    if (status[0] === "R" || status[0] === "C") {
      add(records[++i]);
      add(records[++i]);
    } else {
      add(records[++i]);
    }
  }
  return paths;
}

function sensitiveAmong(files: string[]): string[] {
  return files.filter(isSensitivePath);
}

function texGitPathspec(projectDir: string, cwd: string): string[] {
  const paths = texPaths(projectDir);
  if (path.resolve(cwd) === path.resolve(paths.manuscriptDir)) return ["."];
  if (fs.existsSync(paths.manuscriptDir)) return [path.relative(cwd, paths.manuscriptDir) || "."];
  // Existing arXiv-style repositories commonly keep paper.tex at their root.
  // Keep onboarding focused on TeX and paper assets and leave README, scripts,
  // credentials, and unrelated project files untouched.
  return [
    ":(glob)**/*.tex",
    ":(glob)**/*.bib",
    ":(glob)**/*.sty",
    ":(glob)**/*.cls",
    ":(glob)**/*.bst",
    ":(glob)figures/**",
    ":(glob)figs/**",
    ":(glob)images/**",
    ":(glob)assets/**",
  ];
}

function hasEmbeddedCredentials(remoteUrl: string): boolean {
  try {
    const parsed = new URL(remoteUrl);
    return Boolean(parsed.username || parsed.password);
  } catch {
    return /:\/\/[^/@]+@/.test(remoteUrl);
  }
}

function resolveGitDir(projectDir: string): string {
  const manuscript = texPaths(projectDir).manuscriptDir;
  if (fs.existsSync(path.join(manuscript, ".git"))) return manuscript;
  if (fs.existsSync(path.join(projectDir, ".git"))) return projectDir;
  return manuscript;
}

function listTexFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 5) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === ".openbarry" || entry.name === "node_modules") continue;
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file, depth + 1);
      else if (/\.(?:tex|bib|sty|cls|bst)$/i.test(entry.name)) files.push(path.relative(root, file));
    }
  };
  visit(root, 0);
  return files.sort();
}

function movePath(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

async function snapshotGitIndex(cwd: string): Promise<GitIndexSnapshot> {
  const relative = (await runGit(cwd, ["rev-parse", "--git-path", "index"])).trim();
  const indexPath = path.resolve(cwd, relative);
  try {
    return { path: indexPath, data: fs.readFileSync(indexPath) };
  } catch {
    return { path: indexPath, data: null };
  }
}

function restoreGitIndex(snapshot: GitIndexSnapshot | undefined): void {
  if (!snapshot) return;
  try {
    if (snapshot.data === null) fs.rmSync(snapshot.path, { force: true });
    else fs.writeFileSync(snapshot.path, snapshot.data);
  } catch {
    // Best-effort: the original git error is more useful than a restore failure.
  }
}

export async function inspectTexGitRepo(repositoryPath: string): Promise<TexGitRepoInspection> {
  const texFiles = listTexFiles(repositoryPath);
  return {
    repositoryPath,
    texFiles,
    hasPaperSource: texFiles.some((file) => /(^|\/)(paper|main|ms|manuscript)\.tex$/i.test(file)),
    status: await getOverleafGitStatus(repositoryPath),
  };
}

export async function initializeMinimalTexRepo(
  repositoryPath: string,
  title: string,
): Promise<{ ok: boolean; message: string; repositoryPath?: string }> {
  fs.mkdirSync(repositoryPath, { recursive: true });
  const entries = fs.readdirSync(repositoryPath).filter((entry) => entry !== ".git");
  if (entries.length) {
    return { ok: false, message: "Repository path must be empty before initializing a minimal TeX project." };
  }

  let stageDir: string | undefined;
  try {
    stageDir = fs.mkdtempSync(path.join(repositoryPath, ".openbarry-staging-"));
    const now = new Date().toISOString();
    const slug = path.basename(repositoryPath).toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "paper";
    writeProjectRecord(stageDir, {
      id: slug,
      slug,
      title,
      tagline: "Starter OpenBar TeX manuscript.",
      overview: "This manuscript was initialized as a source-backed TeX project. Replace starter markers with verified work.",
      status: "active",
      createdAt: now,
      updatedAt: now,
      links: [],
    });
    writePaperProject(stageDir, title, [{
      id: "introduction",
      title: "Introduction",
      level: 2,
      order: 0,
      label: "sec-introduction",
      tex: "\\obmarker{todo}{Replace this starter text with the source-backed introduction.}",
    }]);
    if (!hasTexProject(stageDir)) {
      return { ok: false, message: "Staged TeX project failed validation before moving into place." };
    }
    for (const name of fs.readdirSync(stageDir)) {
      movePath(path.join(stageDir, name), path.join(repositoryPath, name));
    }
    if (!fs.existsSync(path.join(repositoryPath, ".git"))) {
      await runGit(repositoryPath, ["init"]);
    }
    return { ok: true, message: "Initialized a minimal OpenBar TeX repository.", repositoryPath };
  } catch (error) {
    return {
      ok: false,
      message: `Failed to initialize TeX repository: ${gitErrorMessage(error)}`,
    };
  } finally {
    if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
    env: gitProcessEnv(process.env),
  });
  return stdout;
}

export async function getOverleafGitStatus(projectDir: string): Promise<OverleafGitStatus> {
  const cwd = resolveGitDir(projectDir);
  if (!fs.existsSync(path.join(cwd, ".git"))) {
    return { isGitRepo: false };
  }

  try {
    const branch = (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "main")).trim() || "main";
    const remoteUrl = await runGit(cwd, ["config", "--get", "remote.origin.url"]).then((value) => value.trim()).catch(() => undefined);
    const statusOutput = await runGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    const changedFiles = porcelainPaths(parsePorcelainZ(statusOutput));
    const isClean = changedFiles.length === 0;

    let ahead = 0;
    let behind = 0;
    try {
      const counts = (await runGit(cwd, ["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`])).trim();
      const [a, b] = counts.split(/\s+/).map(Number);
      if (Number.isFinite(a)) ahead = a;
      if (Number.isFinite(b)) behind = b;
    } catch {
      // Remote branch may not be tracked yet
    }

    let lastCommit: OverleafGitStatus["lastCommit"] = undefined;
    try {
      const log = (await runGit(cwd, ["log", "-1", "--format=%H%x00%s%x00%an%x00%cI"])).replace(/\n+$/, "");
      const [hash, message, author, date] = log.split("\0");
      if (hash) {
        lastCommit = { hash, message, author, date };
      }
    } catch {
      // Empty repo
    }

    return {
      isGitRepo: true,
      branch,
      remoteUrl: redactGitRemote(remoteUrl),
      isClean,
      ahead,
      behind,
      changedFiles,
      lastCommit,
    };
  } catch (error) {
    return {
      isGitRepo: true,
      error: gitErrorMessage(error),
    };
  }
}

export async function pullOverleafGit(projectDir: string): Promise<{ ok: boolean; message: string }> {
  const cwd = resolveGitDir(projectDir);
  if (!fs.existsSync(path.join(cwd, ".git"))) {
    return { ok: false, message: "Directory is not a git repository." };
  }

  try {
    const output = (await runGit(cwd, ["pull", "--ff-only"])).trim();
    return { ok: true, message: output || "Already up to date." };
  } catch (error) {
    return {
      ok: false,
      message: `Failed to pull from Overleaf remote: ${gitErrorMessage(error)}`,
    };
  }
}

export async function pushOverleafGit(
  projectDir: string,
  message = "OpenBar: update manuscript and structured records",
): Promise<{ ok: boolean; message: string; commitHash?: string }> {
  const cwd = resolveGitDir(projectDir);
  if (!fs.existsSync(path.join(cwd, ".git"))) {
    return { ok: false, message: "Directory is not a git repository." };
  }

  let indexSnapshot: GitIndexSnapshot | undefined;
  let committed = false;
  try {
    const pathspec = texGitPathspec(projectDir, cwd);
    const existingChanges = await runGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...pathspec]);
    const existingSensitive = sensitiveAmong(porcelainPaths(parsePorcelainZ(existingChanges)));
    if (existingSensitive.length) {
      return {
        ok: false,
        message: `Refusing to push while sensitive paths are present: ${existingSensitive.join(", ")}. Store credentials in the OS credential helper and remove these files from the repository first.`,
      };
    }

    indexSnapshot = await snapshotGitIndex(cwd);
    await runGit(cwd, ["add", "-A", "--", ...pathspec]);
    const stagedStatus = await runGit(cwd, ["diff", "--cached", "--name-status", "-z", "--", ...pathspec]);
    const stagedNameOnly = await runGit(cwd, ["diff", "--cached", "--name-only", "-z", "--", ...pathspec]);
    const stagedPaths = [...new Set([
      ...parseNameStatusZ(stagedStatus),
      ...parseNulTerminatedPaths(stagedNameOnly),
    ])];
    if (!stagedPaths.length) {
      return { ok: true, message: "No local changes to commit." };
    }

    const stagedSensitive = sensitiveAmong(stagedPaths);
    if (stagedSensitive.length) {
      restoreGitIndex(indexSnapshot);
      return {
        ok: false,
        message: `Refusing to push sensitive paths: ${stagedSensitive.join(", ")}. Store credentials in the OS credential helper and keep secrets out of git.`,
      };
    }

    // --only commits the TeX paths while preserving unrelated work
    // that was already staged by the user.
    await runGit(cwd, ["commit", "--only", "-m", message, "--", ...pathspec]);
    committed = true;
    const commitHash = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
    try {
      const pushOutput = (await runGit(cwd, ["push"])).trim();
      return {
        ok: true,
        commitHash,
        message: pushOutput || `Committed ${commitHash.slice(0, 8)} and pushed to Overleaf.`,
      };
    } catch (error) {
      return {
        ok: false,
        commitHash,
        message: `Committed ${commitHash} locally, but push failed: ${gitErrorMessage(error)}. The local commit exists.`,
      };
    }
  } catch (error) {
    if (!committed) restoreGitIndex(indexSnapshot);
    return {
      ok: false,
      message: `Failed to push to Overleaf: ${gitErrorMessage(error)}`,
    };
  }
}

export async function initOverleafGit(
  projectDir: string,
  remoteUrl: string,
): Promise<{ ok: boolean; message: string }> {
  if (hasEmbeddedCredentials(remoteUrl)) {
    return {
      ok: false,
      message: "Remote URL contains embedded credentials. Configure a credential helper or SSH key and pass a credential-free remote URL.",
    };
  }
  const cwd = resolveGitDir(projectDir);
  try {
    if (!fs.existsSync(path.join(cwd, ".git"))) {
      await runGit(cwd, ["init"]);
    }
    const existing = await runGit(cwd, ["config", "--get", "remote.origin.url"]).then((value) => value.trim()).catch(() => undefined);
    if (existing) {
      await runGit(cwd, ["remote", "set-url", "origin", remoteUrl]);
    } else {
      await runGit(cwd, ["remote", "add", "origin", remoteUrl]);
    }
    return { ok: true, message: `Configured Overleaf remote ${redactGitRemote(remoteUrl)} in ${cwd}` };
  } catch (error) {
    return {
      ok: false,
      message: `Failed to configure Overleaf git remote: ${gitErrorMessage(error)}`,
    };
  }
}
