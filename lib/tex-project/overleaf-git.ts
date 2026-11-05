import { pathspec, simpleGit } from "simple-git";
import fs from "node:fs";
import path from "node:path";

import { texPaths } from "./project";
import { withWriteLockAsync } from "./codec";
import { gitProcessEnv } from "@/lib/server/git-credential-store";
import { redactGitRemote, redactSensitiveText } from "@/lib/server/git-url";
import { withProjectWriteLockAsync } from "@/lib/research/project-lock";

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

function porcelainPaths(entries: PorcelainEntry[]): string[] {
  return [...new Set(entries.flatMap(entry => [entry.path, entry.origPath].filter((file): file is string => Boolean(file))))];
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

/** Local summaries use simple-git's parsers and a separate environment per command. */
function projectGit(cwd: string) {
  const env = gitProcessEnv();
  const controller = new AbortController();
  let bytes = 0;
  return simpleGit({
    baseDir: cwd,
    config: ["core.fsmonitor=false"],
    trimmed: false,
    abort: controller.signal,
    timeout: { block: 120_000, stdOut: false, stdErr: false },
    allowEnvironment: Object.keys(env),
    unsafe: { allowUnsafeAskPass: true, allowUnsafeSshCommand: true, allowUnsafePager: true, allowUnsafeFsMonitor: true },
    errors(error, result) {
      return error || (result.exitCode !== 0 ? new Error(redactSensitiveText(Buffer.concat(result.stdErr).toString() || `Git exited with status ${result.exitCode}.`)) : undefined);
    },
  }).env(env as Record<string, string>).outputHandler((_command, stdout, stderr) => {
    const limit = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 10 * 1024 * 1024) controller.abort();
    };
    stdout.on("data", limit);
    stderr.on("data", limit);
  });
}

async function runGit(cwd: string, args: string[], options: { indexPath?: string } = {}): Promise<string> {
  const { execa } = await import("execa");
  const result = await execa("git", args, {
    cwd,
    env: gitProcessEnv(options.indexPath ? { ...process.env, GIT_INDEX_FILE: options.indexPath } : process.env),
    extendEnv: false,
    encoding: "buffer",
    stripFinalNewline: false,
    stdin: "ignore",
    timeout: 120_000,
    forceKillAfterDelay: 3_000,
    killDescendants: true,
    maxBuffer: 10 * 1024 * 1024,
    reject: false,
  });
  if (result.failed) {
    const reason = result.timedOut ? "Git exceeded the two-minute execution limit."
      : result.isMaxBuffer ? "Git output exceeded the 10 MiB limit."
      : result.originalMessage || `Git exited with status ${result.exitCode ?? result.signal ?? "unknown"}.`;
    throw new Error(redactSensitiveText(Buffer.from(result.stderr).toString() || reason));
  }
  return Buffer.from(result.stdout).toString();
}

/** Disabling rename grouping reports both paths and preserves every filename byte. */
async function changedGitPaths(cwd: string, args: string[], options: { indexPath?: string } = {}): Promise<string[]> {
  return splitNulRecords(await runGit(cwd, ["diff", "--no-renames", "--name-only", "-z", ...args], options));
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

    let ahead: number | undefined;
    let behind: number | undefined;
    let comparisonError: string | undefined;
    if (remoteUrl) {
      try {
        const counts = (await runGit(cwd, ["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`])).trim();
        if (!/^\d+\s+\d+$/.test(counts)) throw new Error("Git returned an invalid local and remote commit comparison.");
        const [a, b] = counts.split(/\s+/).map(Number);
        if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) throw new Error("Git returned an invalid local and remote commit comparison.");
        ahead = a;
        behind = b;
      } catch (error) {
        comparisonError = "Git comparison unavailable: " + gitErrorMessage(error);
      }
    }

    let lastCommit: OverleafGitStatus["lastCommit"] = undefined;
    try {
      const { latest } = await projectGit(cwd).log({ maxCount: 1, format: { hash: "%H", message: "%s", author: "%an", date: "%cI" } });
      if (latest) lastCommit = { hash: latest.hash, message: latest.message, author: latest.author, date: latest.date };
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
      error: comparisonError,
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
    const { all } = await projectGit(cwd).log({
      maxCount: boundedLimit,
      format: { hash: "%H", author: "%an", date: "%cI", message: "%s" },
      ...(since ? { "--since": `${since}T00:00:00` } : {}),
      "--name-only": null,
      paths: pathspec(...gitPathspec(projectDir, cwd)),
    });
    const commits = all.map(commit => ({
      hash: commit.hash,
      author: commit.author || "Unknown actor",
      date: commit.date,
      message: commit.message,
      files: [...new Set(commit.diff?.files.map(file => file.file) || [])],
    }));
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

  return withGitSyncLock(cwd, async () => {
    try {
      const remoteUrl = (await runGit(cwd, ["config", "--get", "remote.origin.url"])).trim();
      if (!isOverleafGitRemote(remoteUrl)) {
        return { ok: false, message: "Connect this project to Git before pulling updates." };
      }
      const branch = (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      if (!branch || branch === "HEAD") return { ok: false, message: "Select a named Git branch before pulling updates." };
      const pending = (await projectGit(cwd).status(["--untracked-files=all"])).files.length;
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
          const branch = (await runGit(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
          if (!branch || branch === "HEAD") return { ok: false, status: "failed", code: "detached_head", message: "Checkout a named branch before creating an OpenBar commit.", paths: [] };
          const head = (await runGit(cwd, ["rev-parse", "--verify", "HEAD"]).catch(() => "")).trim();
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
          const indexEntries = (output: string) => {
            const entries = new Map<string, string>();
            for (const record of splitNulRecords(output)) {
              const separator = record.indexOf("\t");
              if (separator < 0) continue;
              const file = record.slice(separator + 1);
              entries.set(file, (entries.get(file) || "") + record.slice(0, separator) + "\n");
            }
            return entries;
          };
          const indexPaths = existingPaths.map((file) => `:(literal)${file}`);
          const originalIndex = indexEntries(await runGit(cwd, ["ls-files", "--stage", "-z", "--", ...indexPaths]));
          const before = new Map<string, string | undefined>();
          for (const file of existingPaths) before.set(file, await worktreeHash(cwd, file));

          // Capture into an isolated index seeded from HEAD. The user's ordinary
          // index remains available for unrelated staged work throughout.
          temporaryIndex = await temporaryGitIndex(cwd);
          const indexOptions = { indexPath: temporaryIndex.path };
          await runGit(cwd, head ? ["read-tree", head] : ["read-tree", "--empty"], indexOptions);
          const baseIndex = indexEntries(await runGit(cwd, ["ls-files", "--stage", "-z", "--", ...indexPaths], indexOptions));
          await runGit(cwd, ["add", "-A", "--", ...existingPaths.map((file) => `:(literal)${file}`)], indexOptions);
          const stagedPaths = (await changedGitPaths(cwd, ["--cached", "--", ...pathspec], indexOptions)).filter(isSafeCommittedPath);
          if (!stagedPaths.length) return { ok: true, status: "no_changes", message: "No local changes to commit.", branch, paths: [] };

          // write-tree freezes the exact bytes staged above. Later worktree saves
          // remain dirty against this captured tree and enter a later checkpoint.
          const tree = (await runGit(cwd, ["write-tree"], indexOptions)).trim();
          if (!tree) throw new Error("Git produced an empty checkpoint tree.");
          const commitHash = (await runGit(cwd, ["commit-tree", tree, ...(head ? ["-p", head] : []), "-m", message])).trim();
          if (!commitHash) throw new Error("Git produced an empty checkpoint commit.");
          const ordinaryIndexPath = await resolveGitAdministrativePath(cwd, "index");
          const ordinaryLockPath = ordinaryIndexPath + ".lock";
          let ordinaryLock: number | undefined;
          let ownsOrdinaryLock = false;
          try {
            // Git's native lock keeps concurrent staging atomic while advancing
            // only index entries that still match their pre-checkpoint version.
            ordinaryLock = fs.openSync(ordinaryLockPath, "wx");
            ownsOrdinaryLock = true;
            const alignedIndexPath = path.join(temporaryIndex.directory, "aligned-index");
            if (fs.existsSync(ordinaryIndexPath)) fs.copyFileSync(ordinaryIndexPath, alignedIndexPath);
            else await runGit(cwd, ["read-tree", "--empty"], { indexPath: alignedIndexPath });
            const alignedOptions = { indexPath: alignedIndexPath };
            const currentIndex = indexEntries(await runGit(cwd, ["ls-files", "--stage", "-z", "--", ...indexPaths], alignedOptions));
            const advancePaths = stagedPaths.filter((file) => originalIndex.get(file) === baseIndex.get(file)
              && currentIndex.get(file) === originalIndex.get(file));
            if (advancePaths.length) {
              await runGit(cwd, ["reset", "--quiet", commitHash, "--", ...advancePaths.map((file) => `:(literal)${file}`)], alignedOptions);
            }
            fs.writeFileSync(ordinaryLock, fs.readFileSync(alignedIndexPath));
            fs.fchmodSync(ordinaryLock, fs.existsSync(ordinaryIndexPath) ? fs.statSync(ordinaryIndexPath).mode & 0o777 : 0o644);
            fs.fsyncSync(ordinaryLock);
            fs.closeSync(ordinaryLock);
            ordinaryLock = undefined;
            await runGit(cwd, ["update-ref", `refs/heads/${branch}`, commitHash, head || "0".repeat(commitHash.length)]);
            try {
              fs.renameSync(ordinaryLockPath, ordinaryIndexPath);
              ownsOrdinaryLock = false;
            } catch (error) {
              await runGit(cwd, head ? ["update-ref", `refs/heads/${branch}`, head, commitHash] : ["update-ref", "-d", `refs/heads/${branch}`, commitHash]);
              throw error;
            }
          } finally {
            if (ordinaryLock !== undefined) fs.closeSync(ordinaryLock);
            if (ownsOrdinaryLock) fs.rmSync(ordinaryLockPath, { force: true });
          }
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
  conflicts: { path: string; local: string | null; remote: string | null; base: string | null; merged: string | null; editable: boolean }[];
};
type PullSession = { worktree: string; localCommit: string; remoteCommit: string; branch: string; conflicts: string[] };

async function pullSessionPath(cwd: string, token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Invalid pull review.");
  return resolveGitAdministrativePath(cwd, `openbar-pull-reviews/${token}.json`);
}

async function removePullSession(cwd: string, token: string, session: PullSession) {
  await runGit(cwd, ["worktree", "remove", "--force", session.worktree]);
  fs.rmSync(path.dirname(session.worktree), { recursive: true, force: true });
  fs.rmSync(await pullSessionPath(cwd, token), { force: true });
}

/** Prepare Git's three-way merge in a disposable worktree for human review. */
export async function prepareOverleafPull(projectDir: string): Promise<{ ok: true; review: OverleafPullReview } | { ok: false; message: string }> {
  const cwd = resolveGitDir(projectDir);
  const initial = await getOverleafGitStatus(projectDir);
  if (!initial.isOverleafRemote) return { ok: false, message: "Connect this project to Git before pulling updates." };
  // Preserve accepted local manuscript changes in history before merging.
  const checkpoint = await commitOverleafGit(projectDir, "OpenBar: checkpoint before Git pull");
  if (!checkpoint.ok) return { ok: false, message: checkpoint.message };
  return withGitSyncLock(cwd, async () => {
    let worktree: string | undefined;
    try {
      if ((await projectGit(cwd).status(["--untracked-files=no"])).files.length) {
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
        let merged: string | null = null;
        const mergedPath = path.resolve(worktree, file);
        if (editable && fs.existsSync(mergedPath)) {
          const stat = fs.lstatSync(mergedPath);
          if (stat.isFile() && stat.size <= 1_000_000) merged = fs.readFileSync(mergedPath, "utf8");
        }
        conflicts.push({ path: file, base: contents[0], local: contents[1], remote: contents[2], merged, editable });
      }
      const files = [...new Set((await runGit(worktree, ["diff", "--name-only", "-z", localCommit])).split("\0").filter(Boolean))];
      const session: PullSession = { worktree, localCommit, remoteCommit, branch, conflicts: [...entries.keys()] };
      const sessionFile = await pullSessionPath(cwd, token);
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
  return withGitSyncLock(cwd, async () => {
    try {
      const session = JSON.parse(fs.readFileSync(await pullSessionPath(cwd, token), "utf8")) as PullSession;
      if (cancel) {
        await removePullSession(cwd, token, session);
        return { ok: true, message: "Review closed. Your local checkpoint is preserved." };
      }
      const currentHead = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
      const currentBranch = (await runGit(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
      if (currentHead !== session.localCommit || currentBranch !== session.branch || (await projectGit(cwd).status(["--untracked-files=no"])).files.length) {
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
async function forceSyncPath(cwd: string, token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Invalid force synchronization review.");
  return resolveGitAdministrativePath(cwd, `openbar-force-reviews/${token}.json`);
}
export async function prepareForceSync(projectDir: string, direction: ForceSyncDirection): Promise<{ ok: true; review: ForceSyncReview } | { ok: false; message: string }> {
  if (direction !== "pull" && direction !== "push") return { ok: false, message: "Choose force pull or force push." };
  const initial = await getOverleafGitStatus(projectDir);
  if (!initial.isOverleafRemote) return { ok: false, message: "Connect this project to Git first." };
  const checkpoint = await commitOverleafGit(projectDir, `OpenBar: checkpoint before force ${direction}`);
  if (!checkpoint.ok) return { ok: false, message: checkpoint.message };
  const cwd = resolveGitDir(projectDir);
  return withGitSyncLock(cwd, async () => {
    try {
      if ((await projectGit(cwd).status(["--untracked-files=no"])).files.length) throw new Error("Commit the remaining tracked changes before forcing synchronization.");
      const branch = (await runGit(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
      await runGit(cwd, ["fetch", "origin", branch]);
      const localCommit = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
      const remoteCommit = (await runGit(cwd, ["rev-parse", "FETCH_HEAD"])).trim();
      const [ahead, behind] = (await runGit(cwd, ["rev-list", "--left-right", "--count", `${localCommit}...${remoteCommit}`])).trim().split(/\s+/).map(Number);
      const files = (await runGit(cwd, ["diff", "--name-only", "-z", localCommit, remoteCommit])).split("\0").filter(Boolean);
      const { randomUUID } = await import("node:crypto");
      const review: ForceSyncReview = { token: randomUUID(), direction, branch, localCommit, remoteCommit, files, ahead, behind };
      const file = await forceSyncPath(cwd, review.token);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(review), { mode: 0o600 });
      return { ok: true as const, review };
    } catch (error) { return { ok: false as const, message: gitErrorMessage(error) }; }
  });
}

/** First explicit confirmation creates a separate receipt required by the final confirmation. */
export async function confirmForceSync(projectDir: string, token: string): Promise<{ ok: true; confirmation: string } | { ok: false; message: string }> {
  try {
    const file = await forceSyncPath(resolveGitDir(projectDir), token);
    const session = JSON.parse(fs.readFileSync(file, "utf8")) as ForceSyncSession;
    const { randomUUID } = await import("node:crypto");
    session.confirmation = randomUUID();
    fs.writeFileSync(file, JSON.stringify(session), { mode: 0o600 });
    return { ok: true, confirmation: session.confirmation };
  } catch (error) { return { ok: false, message: gitErrorMessage(error) }; }
}

export async function finishForceSync(projectDir: string, token: string, confirmation: string, phrase: string, cancel = false): Promise<{ ok: boolean; message: string; recoveryRefs?: string[] }> {
  const cwd = resolveGitDir(projectDir);
  return withGitSyncLock(cwd, async () => {
    try {
      const file = await forceSyncPath(cwd, token);
      const session = JSON.parse(fs.readFileSync(file, "utf8")) as ForceSyncSession;
      if (cancel) { fs.rmSync(file); return { ok: true, message: "Force synchronization cancelled." }; }
      if (!session.confirmation || confirmation !== session.confirmation || phrase !== `FORCE ${session.direction.toUpperCase()}`) throw new Error("Both confirmations are required before forcing synchronization.");
      const status = await getOverleafGitStatus(projectDir);
      if (!status.isOverleafRemote || status.branch !== session.branch || status.lastCommit?.hash !== session.localCommit || (await projectGit(cwd).status(["--untracked-files=no"])).files.length) throw new Error("The local project changed. Start a fresh force synchronization review.");
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
  const incomingFiles = baseCommit && remoteCommit ? await changedGitPaths(cwd, [baseCommit, remoteCommit]) : [];
  const outgoingFiles = baseCommit ? await changedGitPaths(cwd, [baseCommit, "HEAD"]) : [];
  const localFiles = new Set([...outgoingFiles, ...(status.changedFiles || [])]);
  const overlappingFiles = incomingFiles.filter(file => localFiles.has(file));
  const conflictedFiles = splitNulRecords(await runGit(cwd, ["diff", "--name-only", "--diff-filter=U", "-z"]).catch(() => ""));
  const recovery = (await runGit(cwd, ["for-each-ref", "--count=40", "--sort=-creatordate", "--format=%(refname) %(objectname)", "refs/openbar/recovery/"]).catch(() => "")).trim().split("\n").filter(Boolean);
  return { status, localCommit: status.lastCommit?.hash, remoteCommit: remoteCommit || null, baseCommit: baseCommit || null, incomingFiles, outgoingFiles, overlappingFiles, conflictedFiles, recovery, nextStep: (status.behind || 0) > 0 ? "Call sync_project with action=review_pull to obtain base/local/remote text for each conflict. Resolve every file and apply_pull with the returned token. Each choice selects an entire file. A changed local HEAD or tracked working tree requires a fresh review." : "Local and remote commit counts are in status. Use the existing project save operation to publish local commits." };
}
