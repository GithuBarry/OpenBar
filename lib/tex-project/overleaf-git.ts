import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { hasTexProject, texPaths, writePaperProject, writeProjectRecord } from "./project";
import { withWriteLockAsync } from "./codec";
import { gitProcessEnv } from "@/lib/server/git-credential-store";
import { redactGitRemote, redactSensitiveText } from "@/lib/server/git-url";
import { withProjectWriteLockAsync } from "@/lib/research/project-lock";

const execFileAsync = promisify(execFile);

export interface OverleafGitStatus {
  isGitRepo: boolean;
  branch?: string;
  remoteUrl?: string;
  /** True only when origin is the Git service, not an arbitrary Git host. */
  isOverleafRemote?: boolean;
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

export interface OverleafGitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
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

export type OverleafGitPushResult = {
  ok: boolean;
  message: string;
  commitHash?: string;
  code?: string;
};

export type GitFileReceipt = {
  path: string;
  beforeHash?: string;
  afterHash?: string;
};

export type OverleafGitLocalCommitResult = {
  ok: boolean;
  status: "committed" | "no_changes" | "blocked" | "failed";
  message: string;
  commitHash?: string;
  branch?: string;
  paths: GitFileReceipt[];
  code?: string;
};

export type OverleafGitRemoteSyncResult = {
  ok: boolean;
  status: "synchronized" | "pending" | "failed" | "unconfigured";
  message: string;
  commitHash?: string;
  branch?: string;
  ahead?: number;
  behind?: number;
  code?: string;
  retryable: boolean;
};

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

function gitPathspec(projectDir: string, cwd: string): string[] {
  const paths = texPaths(projectDir);
  const pathspec = [...texGitPathspec(projectDir, cwd)];
  const metadata = path.relative(cwd, paths.openBarDir).split(path.sep).join("/");
  if (metadata && metadata !== ".." && !metadata.startsWith("../")) {
    pathspec.push(
      `${metadata}/project.tex`,
      `${metadata}/mindmap.tex`,
      `${metadata}/references.tex`,
      `:(glob)${metadata}/mindmaps/**`,
      `:(glob)${metadata}/wiki/**`,
      `:(exclude,glob)${metadata}/build/**`,
      `:(exclude,glob)${metadata}/activity.jsonl`,
      `:(exclude,glob)${metadata}/request-replay.json`,
      `:(exclude,glob)${metadata}/request-replay-journal.json`,
      `:(exclude,glob)${metadata}/recovery/**`,
    );
  }
  return pathspec;
}

function hasEmbeddedCredentials(remoteUrl: string): boolean {
  try {
    const parsed = new URL(remoteUrl);
    return Boolean(parsed.username || parsed.password);
  } catch {
    return /:\/\/[^/@]+@/.test(remoteUrl);
  }
}

/**
 * OpenBar's "remote visible" contract is deliberately narrow: it means the
 * project is visible through the project's Git remote. A generic Git
 * origin must never be reported as an Git save.
 */
export function isOverleafGitRemote(remoteUrl: string | undefined): boolean {
  if (!remoteUrl?.trim()) return false;
  const value = remoteUrl.trim();
  try {
    return new URL(value).hostname.toLowerCase() === "git.overleaf.com";
  } catch {
    // Also accept the SSH form used by Git: git@git.overleaf.com:project.
    return /^git@git\.overleaf\.com:/i.test(value);
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

async function resolveGitAdministrativePath(cwd: string, name: string): Promise<string> {
  const relative = (await runGit(cwd, ["rev-parse", "--git-path", name])).trim();
  if (!relative) throw new Error(`Git did not return an administrative path for ${name}.`);
  return path.resolve(cwd, relative);
}

async function withGitSyncLock<T>(cwd: string, operation: () => Promise<T> | T): Promise<T> {
  const lockPath = await resolveGitAdministrativePath(cwd, "openbar-sync");
  return withWriteLockAsync(lockPath, operation);
}

async function temporaryGitIndex(cwd: string): Promise<{ directory: string; path: string }> {
  const indexPath = await resolveGitAdministrativePath(cwd, "index");
  const directory = fs.mkdtempSync(path.join(path.dirname(indexPath), "openbar-index-"));
  return { directory, path: path.join(directory, "index") };
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

async function runGit(cwd: string, args: string[], options: { indexPath?: string } = {}): Promise<string> {
  const env = options.indexPath
    ? { ...process.env, GIT_INDEX_FILE: options.indexPath }
    : process.env;
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
    env: gitProcessEnv(env),
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
    const statusOutput = await runGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...gitPathspec(projectDir, cwd)]);
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
      isOverleafRemote: isOverleafGitRemote(remoteUrl),
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

/** Return a bounded, credential-free commit summary for the Changes view. */
export async function getProjectGitHistory(
  projectDir: string,
  since?: string,
  limit = 40,
): Promise<{ ok: boolean; commits: OverleafGitCommit[]; message?: string }> {
  const cwd = resolveGitDir(projectDir);
  if (!fs.existsSync(path.join(cwd, ".git"))) {
    return { ok: false, commits: [], message: "Directory is not a git repository." };
  }
  try {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const args = [
      "log",
      `-${boundedLimit}`,
      "--date=iso-strict",
      "--format=%H%x00%an%x00%cI%x00%s%x1e",
      "--name-only",
      ...(since ? [`--since=${since}T00:00:00`] : []),
      "--",
      ...gitPathspec(projectDir, cwd),
    ];
    const output = await runGit(cwd, args);
    const commits: OverleafGitCommit[] = [];
    const header = /(?:^|\n)([0-9a-f]{40})\0([^\0]*)\0([^\0]*)\0([^\x1e]*)\x1e\n?/g;
    const matches = [...output.matchAll(header)];
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index]!;
      const next = matches[index + 1];
      const start = (match.index ?? 0) + match[0].length;
      const end = next?.index ?? output.length;
      const files = output
        .slice(start, end)
        .split(/\r?\n/)
        .map((file) => file.trim())
        .filter(Boolean);
      commits.push({
        hash: match[1]!,
        author: match[2] || "Unknown actor",
        date: match[3] || "",
        message: match[4]!.trim(),
        files: [...new Set(files)],
      });
    }
    return { ok: true, commits };
  } catch (error) {
    return { ok: false, commits: [], message: "Git history unavailable: " + gitErrorMessage(error) };
  }
}

/**
 * Refresh remote-tracking refs before presenting status so another checkout's
 * latest push is visible before the next edit is saved.
 */
export async function refreshOverleafGitStatus(projectDir: string): Promise<OverleafGitStatus> {
  const current = await getOverleafGitStatus(projectDir);
  if (!current.isGitRepo || !current.remoteUrl) return current;
  if (!current.isOverleafRemote) {
    return {
      ...current,
      error: "Git remote unavailable: origin is not git.overleaf.com.",
    };
  }
  const cwd = resolveGitDir(projectDir);
  try {
    await runGit(cwd, ["fetch", "--prune", "origin"]);
  } catch (error) {
    return {
      ...current,
      error: "Git status unavailable: " + gitErrorMessage(error),
    };
  }
  return getOverleafGitStatus(projectDir);
}

export async function pullOverleafGit(projectDir: string): Promise<{ ok: boolean; message: string }> {
  const cwd = resolveGitDir(projectDir);
  if (!fs.existsSync(path.join(cwd, ".git"))) {
    return { ok: false, message: "Directory is not a git repository." };
  }

  return withWriteLockAsync(path.join(cwd, ".git", "openbar-sync"), async () => {
    try {
      const remoteUrl = (await runGit(cwd, ["config", "--get", "remote.origin.url"])).trim();
      if (!isOverleafGitRemote(remoteUrl)) {
        return { ok: false, message: "Connect this project to Git before pulling updates." };
      }
      const branch = (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      if (!branch || branch === "HEAD") return { ok: false, message: "Select a named Git branch before pulling updates." };
      const pending = (await runGit(cwd, ["status", "--porcelain=v1", "--untracked-files=all"])).trim();
      if (pending) return { ok: false, message: "Save or commit the local project changes before pulling Git updates." };
      const output = (await runGit(cwd, ["pull", "--ff-only", "origin", branch])).trim();
      return { ok: true, message: output || "Already up to date." };
    } catch (error) {
      return { ok: false, message: `Could not pull Git updates: ${gitErrorMessage(error)}` };
    }
  });
}

async function worktreeHash(cwd: string, file: string): Promise<string | undefined> {
  try {
    const absolute = path.resolve(cwd, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) return undefined;
    return (await runGit(cwd, ["hash-object", "--", file])).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function commitHashForPath(cwd: string, commit: string, file: string): Promise<string | undefined> {
  try {
    return (await runGit(cwd, ["rev-parse", `${commit}:${file}`])).trim() || undefined;
  } catch {
    return undefined;
  }
}

function preStagedPaths(entries: PorcelainEntry[]): string[] {
  return entries
    .filter((entry) => entry.xy[0] !== " " && entry.xy[0] !== "?")
    .flatMap((entry) => [entry.path, entry.origPath].filter((file): file is string => Boolean(file)));
}

function isSafeCommittedPath(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  return !normalized.startsWith(".git/")
    && !normalized.includes("/.git/")
    && !/(^|\/)(?:\.OpenBar|\.openbarry)\/(?:build|recovery)(?:\/|$)/.test(normalized)
    && !/(^|\/)(?:\.OpenBar|\.openbarry)\/project-write(?:\.ob-lock)?$/.test(normalized)
    && !/(^|\/)(?:activity\.jsonl|request-replay(?:-journal)?\.json)$/.test(normalized)
    && !isSensitivePath(normalized);
}

async function fileReceipts(cwd: string, commit: string, paths: string[], before: Map<string, string | undefined>): Promise<GitFileReceipt[]> {
  return Promise.all(paths.filter(isSafeCommittedPath).map(async (file) => {
    const afterHash = await commitHashForPath(cwd, commit, file);
    return {
      path: file,
      ...(before.get(file) ? { beforeHash: before.get(file) } : {}),
      ...(afterHash ? { afterHash } : {}),
    };
  }));
}

/** Create one local commit from the accepted TeX/OpenBar paths. Network is not consulted. */
export async function commitOverleafGit(
  projectDir: string,
  message = "OpenBar: update manuscript and structured records",
): Promise<OverleafGitLocalCommitResult> {
  const cwd = resolveGitDir(projectDir);
  if (!fs.existsSync(path.join(cwd, ".git"))) return { ok: false, status: "failed", code: "not_git_repo", message: "Directory is not a git repository.", paths: [] };
  return withProjectWriteLockAsync(projectDir, async () => {
    try {
      return await withGitSyncLock(cwd, async () => {
        let temporaryIndex: { directory: string; path: string } | undefined;
        try {
          const branch = (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
          if (!branch || branch === "HEAD") return { ok: false, status: "failed", code: "detached_head", message: "Checkout a named branch before creating an OpenBar commit.", paths: [] };
          const head = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
          const pathspec = gitPathspec(projectDir, cwd);
          const existingOutput = await runGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...pathspec]);
          const existingEntries = parsePorcelainZ(existingOutput);
          const affectedPaths = porcelainPaths(existingEntries);
          const sensitive = sensitiveAmong(affectedPaths);
          if (sensitive.length) return { ok: false, status: "blocked", code: "sensitive_path", message: "Sensitive paths require cleanup before a local OpenBar commit: " + sensitive.join(", ") + ".", paths: [] };
          const existingPaths = affectedPaths.filter(isSafeCommittedPath);
          const staged = preStagedPaths(existingEntries).filter(isSafeCommittedPath);
          if (staged.length) return { ok: false, status: "blocked", code: "pre_staged_work", message: "Affected paths contain pre-staged work. Review or commit the existing index before automatic synchronization: " + [...new Set(staged)].join(", ") + ".", paths: [] };
          if (!existingPaths.length) return { ok: true, status: "no_changes", message: "No local changes to commit.", branch, paths: [] };
          const before = new Map<string, string | undefined>();
          for (const file of existingPaths) before.set(file, await worktreeHash(cwd, file));

          // Capture into an isolated index seeded from HEAD. The user's ordinary
          // index remains available for unrelated staged work throughout.
          temporaryIndex = await temporaryGitIndex(cwd);
          const indexOptions = { indexPath: temporaryIndex.path };
          await runGit(cwd, ["read-tree", head], indexOptions);
          await runGit(cwd, ["add", "-A", "--", ...existingPaths.map((file) => `:(literal)${file}`)], indexOptions);
          const stagedStatus = await runGit(cwd, ["diff", "--cached", "--name-status", "-z", "--", ...pathspec], indexOptions);
          const stagedNameOnly = await runGit(cwd, ["diff", "--cached", "--name-only", "-z", "--", ...pathspec], indexOptions);
          const stagedPaths = [...new Set([...parseNameStatusZ(stagedStatus), ...parseNulTerminatedPaths(stagedNameOnly)])].filter(isSafeCommittedPath);
          if (!stagedPaths.length) return { ok: true, status: "no_changes", message: "No local changes to commit.", branch, paths: [] };

          // write-tree freezes the exact bytes staged above. Later worktree saves
          // remain dirty against this captured tree and enter a later checkpoint.
          const tree = (await runGit(cwd, ["write-tree"], indexOptions)).trim();
          if (!tree) throw new Error("Git produced an empty checkpoint tree.");
          const commitHash = (await runGit(cwd, ["commit-tree", tree, "-p", head, "-m", message])).trim();
          if (!commitHash) throw new Error("Git produced an empty checkpoint commit.");
          await runGit(cwd, ["update-ref", `refs/heads/${branch}`, commitHash, head]);
          const paths = await fileReceipts(cwd, commitHash, stagedPaths, before);
          return { ok: true, status: "committed", message: `Created local commit ${commitHash}.`, commitHash, branch, paths };
        } catch (error) {
          return { ok: false, status: "failed", code: "commit_failed", message: "Local commit failed: " + gitErrorMessage(error), paths: [] };
        } finally {
          if (temporaryIndex) {
            try {
              fs.rmSync(temporaryIndex.directory, { recursive: true, force: true });
            } catch {
              // The Git result remains authoritative when temporary cleanup itself fails.
            }
          }
        }
      });
    } catch (error) {
      return { ok: false, status: "failed", code: "git_admin_path", message: "Local commit failed: " + gitErrorMessage(error), paths: [] };
    }
  });
}

/** Push existing local commits to the validated Git branch. */
export async function syncOverleafGit(projectDir: string, expectedCommitHash?: string): Promise<OverleafGitRemoteSyncResult> {
  const cwd = resolveGitDir(projectDir);
  if (!fs.existsSync(path.join(cwd, ".git"))) return { ok: false, status: "failed", code: "not_git_repo", message: "Directory is not a git repository.", retryable: false };
  try {
    return await withGitSyncLock(cwd, async () => {
      try {
        const branch = (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
        const head = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
        if (!branch || branch === "HEAD") return { ok: false, status: "failed", code: "detached_head", message: "Checkout a named branch before synchronizing OpenBar.", retryable: false };
        if (expectedCommitHash && expectedCommitHash !== head) return { ok: false, status: "pending", code: "commit_changed", message: "A newer local commit exists. Read status and synchronize the latest commit.", commitHash: head, branch, retryable: true };
        const remoteUrl = await runGit(cwd, ["config", "--get", "remote.origin.url"]).then((value) => value.trim()).catch(() => "");
        if (!remoteUrl) return { ok: false, status: "unconfigured", code: "remote_unconfigured", message: "No origin remote is configured. Local commits remain available until an Git remote is configured.", commitHash: head, branch, retryable: false };
        if (!isOverleafGitRemote(remoteUrl)) return { ok: false, status: "unconfigured", code: "remote_not_overleaf", message: "Configure a supported Git remote before pushing.", commitHash: head, branch, retryable: false };
        await runGit(cwd, ["fetch", "--prune", "origin"]);
        let ahead = 0;
        let behind = 0;
        let remoteBranchExists = true;
        try {
          await runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
          const counts = (await runGit(cwd, ["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`])).trim();
          const [localAhead, remoteAhead] = counts.split(/\s+/).map(Number);
          ahead = Number.isFinite(localAhead) ? localAhead : 0;
          behind = Number.isFinite(remoteAhead) ? remoteAhead : 0;
        } catch {
          remoteBranchExists = false;
          ahead = 1;
        }
        if (behind > 0) {
          const diverged = ahead > 0;
          return { ok: false, status: "pending", code: diverged ? "remote_conflict" : "remote_ahead", message: diverged ? "Git and this checkout have diverged. Reconcile both histories before pushing." : "Git has newer commits. Pull and reconcile before pushing.", commitHash: head, branch, ahead, behind, retryable: true };
        }
        if (ahead === 0 && remoteBranchExists) return { ok: true, status: "synchronized", message: "The intended local commit is present on the Git branch.", commitHash: head, branch, ahead, behind, retryable: false };
        const pushOutput = (await runGit(cwd, ["push", "origin", `HEAD:refs/heads/${branch}`])).trim();
        return { ok: true, status: "synchronized", message: pushOutput || `Pushed ${head} to origin/${branch}.`, commitHash: head, branch, ahead, behind, retryable: false };
      } catch (error) {
        return { ok: false, status: "pending", code: "push_failed", message: "Local commits remain intact. Git synchronization failed: " + gitErrorMessage(error), retryable: true };
      }
    });
  } catch (error) {
    return { ok: false, status: "failed", code: "git_admin_path", message: "Git synchronization failed: " + gitErrorMessage(error), retryable: false };
  }
}

/** Compatibility wrapper for the existing UI while it migrates to separate buttons. */
export async function pushOverleafGit(
  projectDir: string,
  message = "OpenBar: update manuscript and structured records",
): Promise<OverleafGitPushResult> {
  const local = await commitOverleafGit(projectDir, message);
  if (!local.ok) return { ok: false, code: local.code, message: local.message };
  const remote = await syncOverleafGit(projectDir, local.commitHash);
  if (remote.ok) return { ok: true, commitHash: remote.commitHash || local.commitHash, message: remote.message };
  return { ok: false, code: remote.code, commitHash: remote.commitHash || local.commitHash, message: remote.message };
}

export async function initOverleafGit(
  projectDir: string,
  remoteUrl: string,
): Promise<{ ok: boolean; message: string }> {
  if (!isOverleafGitRemote(remoteUrl)) {
    return {
      ok: false,
      message: "Only the Git remote at git.overleaf.com can be configured for remote visibility.",
    };
  }
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
    return { ok: true, message: `Configured Git remote ${redactGitRemote(remoteUrl)} in ${cwd}` };
  } catch (error) {
    return {
      ok: false,
      message: `Failed to configure Git git remote: ${gitErrorMessage(error)}`,
    };
  }
}

export type OverleafConflictChoice = { path: string; choice: "local" | "remote" | "merged"; text?: string };
export type OverleafPullReview = {
  token: string;
  localCommit: string;
  remoteCommit: string;
  files: string[];
  conflicts: { path: string; local: string | null; remote: string | null; base: string | null; editable: boolean }[];
};
type PullSession = { worktree: string; localCommit: string; remoteCommit: string; branch: string; conflicts: string[] };

function pullSessionPath(cwd: string, token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Invalid pull review.");
  return path.join(cwd, ".git", "openbar-pull-reviews", `${token}.json`);
}

async function removePullSession(cwd: string, token: string, session: PullSession) {
  await runGit(cwd, ["worktree", "remove", "--force", session.worktree]);
  fs.rmSync(path.dirname(session.worktree), { recursive: true, force: true });
  fs.rmSync(pullSessionPath(cwd, token), { force: true });
}

/** Prepare Git's three-way merge in a disposable worktree for human review. */
export async function prepareOverleafPull(projectDir: string): Promise<{ ok: true; review: OverleafPullReview } | { ok: false; message: string }> {
  const cwd = resolveGitDir(projectDir);
  const initial = await getOverleafGitStatus(projectDir);
  if (!initial.isOverleafRemote) return { ok: false, message: "Connect this project to Git before pulling updates." };
  // Preserve accepted local manuscript changes in history before merging.
  const checkpoint = await commitOverleafGit(projectDir, "OpenBar: checkpoint before Git pull");
  if (!checkpoint.ok) return { ok: false, message: checkpoint.message };
  return withWriteLockAsync(path.join(cwd, ".git", "openbar-sync"), async () => {
    let worktree: string | undefined;
    try {
      if ((await runGit(cwd, ["status", "--porcelain=v1", "--untracked-files=no"])).trim()) {
        throw new Error("Additional repository changes need a local commit before review. Your project checkpoint is preserved.");
      }
      const branch = (await runGit(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
      await runGit(cwd, ["fetch", "origin", branch]);
      const localCommit = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
      const remoteCommit = (await runGit(cwd, ["rev-parse", "FETCH_HEAD"])).trim();
      const { tmpdir } = await import("node:os");
      const { randomUUID } = await import("node:crypto");
      const token = randomUUID();
      worktree = path.join(fs.mkdtempSync(path.join(tmpdir(), "openbar-pull-")), "review");
      await runGit(cwd, ["worktree", "add", "--detach", worktree, localCommit]);
      let mergeError: unknown;
      try { await runGit(worktree, ["merge", "--no-commit", remoteCommit]); } catch (error) { mergeError = error; }
      const unmerged = await runGit(worktree, ["ls-files", "--unmerged", "-z"]);
      const entries = new Map<string, Map<number, { oid: string; mode: string }>>();
      for (const entry of unmerged.split("\0").filter(Boolean)) {
        const match = /^(\d+) ([a-f0-9]+) ([123])\t([\s\S]+)$/.exec(entry);
        if (!match) throw new Error("Could not read the Git conflict index.");
        const stages = entries.get(match[4]) || new Map();
        stages.set(Number(match[3]), { oid: match[2], mode: match[1] });
        entries.set(match[4], stages);
      }
      if (mergeError && !entries.size) throw mergeError;
      const conflicts: OverleafPullReview["conflicts"] = [];
      for (const [file, stages] of entries) {
        const contents: (string | null)[] = [];
        let editable = true;
        for (const stage of [1, 2, 3]) {
          const blob = stages.get(stage);
          if (!blob) { contents.push(null); continue; }
          const size = Number((await runGit(worktree, ["cat-file", "-s", blob.oid])).trim());
          if (size > 1_000_000 || !["100644", "100755"].includes(blob.mode)) { editable = false; contents.push(null); continue; }
          const content = await runGit(worktree, ["cat-file", "blob", blob.oid]);
          if (content.includes("\0") || Buffer.byteLength(content) !== size) { editable = false; contents.push(null); } else contents.push(content);
        }
        conflicts.push({ path: file, base: contents[0], local: contents[1], remote: contents[2], editable });
      }
      const files = [...new Set((await runGit(worktree, ["diff", "--name-only", "-z", localCommit])).split("\0").filter(Boolean))];
      const session: PullSession = { worktree, localCommit, remoteCommit, branch, conflicts: [...entries.keys()] };
      const sessionFile = pullSessionPath(cwd, token);
      fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
      fs.writeFileSync(sessionFile, JSON.stringify(session), { mode: 0o600 });
      return { ok: true as const, review: { token, localCommit, remoteCommit, files, conflicts } };
    } catch (error) {
      if (worktree) {
        await runGit(cwd, ["worktree", "remove", "--force", worktree]).catch(() => undefined);
        fs.rmSync(path.dirname(worktree), { recursive: true, force: true });
      }
      return { ok: false as const, message: gitErrorMessage(error) };
    }
  });
}

export async function finishOverleafPull(projectDir: string, token: string, choices: OverleafConflictChoice[], cancel = false): Promise<{ ok: boolean; message: string }> {
  const cwd = resolveGitDir(projectDir);
  return withWriteLockAsync(path.join(cwd, ".git", "openbar-sync"), async () => {
    try {
      const session = JSON.parse(fs.readFileSync(pullSessionPath(cwd, token), "utf8")) as PullSession;
      if (cancel) {
        await removePullSession(cwd, token, session);
        return { ok: true, message: "Review closed. Your local checkpoint is preserved." };
      }
      const currentHead = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
      const currentBranch = (await runGit(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
      if (currentHead !== session.localCommit || currentBranch !== session.branch || (await runGit(cwd, ["status", "--porcelain=v1", "--untracked-files=no"])).trim()) {
        return { ok: false, message: "The local project changed during review. Close this review and pull again to include those edits." };
      }
      const selected = new Map(choices.map((choice) => [choice.path, choice]));
      if (selected.size !== session.conflicts.length || session.conflicts.some((file) => !selected.has(file))) {
        return { ok: false, message: "Choose a resolution for each conflicting file." };
      }
      // Rebuild the disposable merge so retries always start from the reviewed versions.
      await runGit(session.worktree, ["merge", "--abort"]).catch(() => undefined);
      await runGit(session.worktree, ["reset", "--hard", session.localCommit]);
      try { await runGit(session.worktree, ["merge", "--no-commit", session.remoteCommit]); }
      catch (error) { if (!(await runGit(session.worktree, ["ls-files", "--unmerged"])).trim()) throw error; }
      for (const file of session.conflicts) {
        const choice = selected.get(file)!;
        if (!["local", "remote", "merged"].includes(choice.choice)) throw new Error("Invalid conflict resolution.");
        const target = path.resolve(session.worktree, file);
        if (!target.startsWith(session.worktree + path.sep) || file.split("/").includes(".git")) throw new Error("Invalid conflict path.");
        if (choice.choice === "merged") {
          if (typeof choice.text !== "string" || Buffer.byteLength(choice.text) > 1_000_000) throw new Error("Merged text must fit within 1 MB.");
          if (/^(<<<<<<< |=======\s*$|>>>>>>> )/m.test(choice.text)) throw new Error("Resolve the remaining conflict markers before applying.");
          // Refuse links and special entries before writing human-authored text.
          const modes = await runGit(session.worktree, ["ls-files", "--stage", "--", `:(literal)${file}`]);
          if (modes.split("\n").filter(Boolean).some((line) => !/^100(644|755) /.test(line))) throw new Error("Choose a saved version for this non-text entry.");
          let parent = path.dirname(target);
          while (parent !== session.worktree) {
            if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw new Error("Choose a saved version for a linked path.");
            parent = path.dirname(parent);
          }
          if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error("Choose a saved version for this linked entry.");
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, choice.text);
          await runGit(session.worktree, ["add", "--", `:(literal)${file}`]);
        } else {
          const stage = choice.choice === "local" ? "2" : "3";
          const stages = await runGit(session.worktree, ["ls-files", "--unmerged", "--", `:(literal)${file}`]);
          if (stages.split("\n").some((line) => line.includes(` ${stage}\t`))) {
            await runGit(session.worktree, ["checkout", choice.choice === "local" ? "--ours" : "--theirs", "--", `:(literal)${file}`]);
            await runGit(session.worktree, ["add", "--", `:(literal)${file}`]);
          } else await runGit(session.worktree, ["rm", "-f", "--ignore-unmatch", "--", `:(literal)${file}`]);
        }
      }
      if ((await runGit(session.worktree, ["ls-files", "--unmerged"])).trim()) throw new Error("Some files still need a resolution.");
      const mergeHead = await runGit(session.worktree, ["rev-parse", "--verify", "MERGE_HEAD"]).catch(() => "");
      if (mergeHead.trim()) await runGit(session.worktree, ["commit", "-m", "OpenBar: merge reviewed Git updates"]);
      const resultHead = (await runGit(session.worktree, ["rev-parse", "HEAD"])).trim();
      await runGit(cwd, ["merge", "--ff-only", resultHead]);
      await removePullSession(cwd, token, session);
      return { ok: true, message: "Git updates applied locally. Use Save to Git to publish the combined version." };
    } catch (error) {
      return { ok: false, message: gitErrorMessage(error) };
    }
  });
}

export type ForceSyncDirection = "pull" | "push";
export type ForceSyncReview = { token: string; direction: ForceSyncDirection; branch: string; localCommit: string; remoteCommit: string; files: string[]; ahead: number; behind: number };
type ForceSyncSession = ForceSyncReview & { confirmation?: string };
function forceSyncPath(cwd: string, token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Invalid force synchronization review.");
  return path.join(cwd, ".git", "openbar-force-reviews", `${token}.json`);
}
export async function prepareForceSync(projectDir: string, direction: ForceSyncDirection): Promise<{ ok: true; review: ForceSyncReview } | { ok: false; message: string }> {
  if (direction !== "pull" && direction !== "push") return { ok: false, message: "Choose force pull or force push." };
  const initial = await getOverleafGitStatus(projectDir);
  if (!initial.isOverleafRemote) return { ok: false, message: "Connect this project to Git first." };
  const checkpoint = await commitOverleafGit(projectDir, `OpenBar: checkpoint before force ${direction}`);
  if (!checkpoint.ok) return { ok: false, message: checkpoint.message };
  const cwd = resolveGitDir(projectDir);
  return withWriteLockAsync(path.join(cwd, ".git", "openbar-sync"), async () => {
    try {
      if ((await runGit(cwd, ["status", "--porcelain=v1", "--untracked-files=no"])).trim()) throw new Error("Commit the remaining tracked changes before forcing synchronization.");
      const branch = (await runGit(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
      await runGit(cwd, ["fetch", "origin", branch]);
      const localCommit = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
      const remoteCommit = (await runGit(cwd, ["rev-parse", "FETCH_HEAD"])).trim();
      const [ahead, behind] = (await runGit(cwd, ["rev-list", "--left-right", "--count", `${localCommit}...${remoteCommit}`])).trim().split(/\s+/).map(Number);
      const files = (await runGit(cwd, ["diff", "--name-only", "-z", localCommit, remoteCommit])).split("\0").filter(Boolean);
      const { randomUUID } = await import("node:crypto");
      const review: ForceSyncReview = { token: randomUUID(), direction, branch, localCommit, remoteCommit, files, ahead, behind };
      const file = forceSyncPath(cwd, review.token);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(review), { mode: 0o600 });
      return { ok: true as const, review };
    } catch (error) { return { ok: false as const, message: gitErrorMessage(error) }; }
  });
}

/** First explicit confirmation creates a separate receipt required by the final confirmation. */
export async function confirmForceSync(projectDir: string, token: string): Promise<{ ok: true; confirmation: string } | { ok: false; message: string }> {
  try {
    const file = forceSyncPath(resolveGitDir(projectDir), token);
    const session = JSON.parse(fs.readFileSync(file, "utf8")) as ForceSyncSession;
    const { randomUUID } = await import("node:crypto");
    session.confirmation = randomUUID();
    fs.writeFileSync(file, JSON.stringify(session), { mode: 0o600 });
    return { ok: true, confirmation: session.confirmation };
  } catch (error) { return { ok: false, message: gitErrorMessage(error) }; }
}

export async function finishForceSync(projectDir: string, token: string, confirmation: string, phrase: string, cancel = false): Promise<{ ok: boolean; message: string; recoveryRefs?: string[] }> {
  const cwd = resolveGitDir(projectDir);
  return withWriteLockAsync(path.join(cwd, ".git", "openbar-sync"), async () => {
    try {
      const file = forceSyncPath(cwd, token);
      const session = JSON.parse(fs.readFileSync(file, "utf8")) as ForceSyncSession;
      if (cancel) { fs.rmSync(file); return { ok: true, message: "Force synchronization cancelled." }; }
      if (!session.confirmation || confirmation !== session.confirmation || phrase !== `FORCE ${session.direction.toUpperCase()}`) throw new Error("Both confirmations are required before forcing synchronization.");
      const status = await getOverleafGitStatus(projectDir);
      if (!status.isOverleafRemote || status.branch !== session.branch || status.lastCommit?.hash !== session.localCommit || (await runGit(cwd, ["status", "--porcelain=v1", "--untracked-files=no"])).trim()) throw new Error("The local project changed. Start a fresh force synchronization review.");
      const remoteHead = (await runGit(cwd, ["ls-remote", "--heads", "origin", `refs/heads/${session.branch}`])).trim().split(/\s+/)[0];
      if (remoteHead !== session.remoteCommit) throw new Error("Git changed after your review. Start again to review its newest version.");
      const refs = [`refs/openbar/recovery/${token}/local`, `refs/openbar/recovery/${token}/overleaf`];
      await runGit(cwd, ["update-ref", refs[0], session.localCommit]);
      await runGit(cwd, ["update-ref", refs[1], session.remoteCommit]);
      if (session.direction === "pull") {
        // --keep aligns history and preserves unrelated untracked runtime files.
        // Git refuses an overlapping untracked file or an edit arriving at reset time.
        await runGit(cwd, ["reset", "--keep", session.remoteCommit]);
      } else {
        await runGit(cwd, ["push", `--force-with-lease=refs/heads/${session.branch}:${session.remoteCommit}`, "origin", `${session.localCommit}:refs/heads/${session.branch}`]);
      }
      fs.rmSync(file);
      return { ok: true, message: session.direction === "pull" ? "Local project now matches the reviewed Git commit." : "Git now matches the reviewed local commit.", recoveryRefs: refs };
    } catch (error) { return { ok: false, message: gitErrorMessage(error) }; }
  });
}

/** Agent diagnostics include exact merge inputs and recovery pointers. Full conflict contents are returned by prepareOverleafPull. */
export async function getOverleafSyncDetails(projectDir: string, refresh = false) {
  const status = refresh ? await refreshOverleafGitStatus(projectDir) : await getOverleafGitStatus(projectDir);
  if (!status.isGitRepo || !status.branch) return { status };
  const cwd = resolveGitDir(projectDir);
  const remoteCommit = (await runGit(cwd, ["rev-parse", `refs/remotes/origin/${status.branch}`]).catch(() => "")).trim();
  const baseCommit = remoteCommit ? (await runGit(cwd, ["merge-base", "HEAD", remoteCommit]).catch(() => "")).trim() : "";
  const incomingFiles = baseCommit && remoteCommit ? parseNameStatusZ(await runGit(cwd, ["diff", "--name-status", "-z", baseCommit, remoteCommit])) : [];
  const outgoingFiles = baseCommit ? parseNameStatusZ(await runGit(cwd, ["diff", "--name-status", "-z", baseCommit, "HEAD"])) : [];
  const localFiles = new Set([...outgoingFiles, ...(status.changedFiles || [])]);
  const overlappingFiles = incomingFiles.filter(file => localFiles.has(file));
  const conflictedFiles = parseNulTerminatedPaths(await runGit(cwd, ["diff", "--name-only", "--diff-filter=U", "-z"]).catch(() => ""));
  const recovery = (await runGit(cwd, ["for-each-ref", "--count=40", "--sort=-creatordate", "--format=%(refname) %(objectname)", "refs/openbar/recovery/"]).catch(() => "")).trim().split("\n").filter(Boolean);
  return { status, localCommit: status.lastCommit?.hash, remoteCommit: remoteCommit || null, baseCommit: baseCommit || null, incomingFiles, outgoingFiles, overlappingFiles, conflictedFiles, recovery, nextStep: (status.behind || 0) > 0 ? "Call sync_project with action=review_pull to obtain base/local/remote text for each conflict. Resolve every file and apply_pull with the returned token. Each choice selects an entire file. A changed local HEAD or tracked working tree requires a fresh review." : "Local and remote commit counts are in status. Use the existing project save operation to publish local commits." };
}
