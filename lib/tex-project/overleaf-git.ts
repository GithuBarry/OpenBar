import { pathspec, simpleGit } from "simple-git";
import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

import { texPaths } from "./project";
import { recoverSourceTransaction, sourceTransactionJournalPath } from "./source-transaction";
import { sha256, withWriteLockAsync, writeTextAtomic } from "./codec";
import { gitProcessEnv } from "@/lib/server/git-credential-store";
import { overleafProjectId, redactGitRemote, redactSensitiveText } from "@/lib/server/git-url";
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

export function isSensitivePath(file: string): boolean {
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

type CheckpointJournal = {
  version: 1;
  branch: string;
  beforeHead: string;
  afterHead: string;
  originalIndexHash: string | null;
  preparedIndexHash: string;
  preparedIndex: string;
};

async function checkpointJournalPath(cwd: string): Promise<string> {
  return resolveGitAdministrativePath(cwd, "openbar-checkpoint-recovery.json");
}

function syncDirectory(directory: string): void {
  try {
    const descriptor = fs.openSync(directory, "r");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  } catch { /* Directory fsync is unavailable on some filesystems. */ }
}

async function writeCheckpointJournal(cwd: string, journal: CheckpointJournal): Promise<void> {
  const file = await checkpointJournalPath(cwd);
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(journal));
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
    syncDirectory(path.dirname(file));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}

async function clearCheckpointJournal(cwd: string): Promise<void> {
  const file = await checkpointJournalPath(cwd);
  fs.rmSync(file, { force: true });
  syncDirectory(path.dirname(file));
}

/** Preserve the interrupted state for inspection, including any external Git lock. */
async function checkpointRecoveryMessage(cwd: string): Promise<string | undefined> {
  const file = await checkpointJournalPath(cwd);
  if (!fs.existsSync(file)) return undefined;
  const indexPath = await resolveGitAdministrativePath(cwd, "index");
  const lockPresent = fs.existsSync(`${indexPath}.lock`);
  let description = "The checkpoint journal could not be validated.";
  try {
    const journal = JSON.parse(fs.readFileSync(file, "utf8")) as CheckpointJournal;
    const valid = journal.version === 1 && typeof journal.branch === "string"
      && typeof journal.beforeHead === "string" && typeof journal.afterHead === "string"
      && (journal.originalIndexHash === null || typeof journal.originalIndexHash === "string")
      && typeof journal.preparedIndexHash === "string" && typeof journal.preparedIndex === "string"
      && sha256(Buffer.from(journal.preparedIndex, "base64")) === journal.preparedIndexHash;
    if (valid) {
      const branch = (await runGit(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
      const refs = await runGit(cwd, ["for-each-ref", "--format=%(refname)%00%(objectname)", `refs/heads/${journal.branch}`]);
      const ref = refs.split("\n").map(line => line.split("\0")).find(parts => parts[0] === `refs/heads/${journal.branch}`)?.[1] || "";
      const indexHash = fs.existsSync(indexPath) ? sha256(fs.readFileSync(indexPath)) : null;
      if (branch !== journal.branch) description = "The Git branch changed after the interrupted checkpoint.";
      else if (ref === journal.beforeHead && indexHash === journal.originalIndexHash) description = "The branch and index still match their state before the checkpoint.";
      else if (ref === journal.afterHead && indexHash === journal.preparedIndexHash) {
        description = "The branch and index both match the completed checkpoint.";
        if (!lockPresent) {
          // Clear only an already-complete receipt, after a second observation.
          // No native Git lock, index, or ref is modified by this recovery.
          const branchAgain = (await runGit(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
          const refsAgain = await runGit(cwd, ["for-each-ref", "--format=%(refname)%00%(objectname)", `refs/heads/${journal.branch}`]);
          const refAgain = refsAgain.split("\n").map(line => line.split("\0")).find(parts => parts[0] === `refs/heads/${journal.branch}`)?.[1] || "";
          const indexAgain = fs.existsSync(indexPath) ? sha256(fs.readFileSync(indexPath)) : null;
          if (branchAgain === journal.branch && refAgain === journal.afterHead && indexAgain === journal.preparedIndexHash && !fs.existsSync(`${indexPath}.lock`)) {
            await clearCheckpointJournal(cwd);
            return undefined;
          }
          description = "The Git state changed while checking the completed checkpoint.";
        }
      }
      else if (ref === journal.afterHead && indexHash === journal.originalIndexHash) description = "The checkpoint advanced the branch while the index retained its earlier state.";
      else description = "The branch or index changed after the interrupted checkpoint.";
    }
  } catch { /* Keep the journal and require inspection when state is uncertain. */ }
  return `An interrupted OpenBar checkpoint needs Git recovery. ${description} ${lockPresent ? "A Git index lock is present. Confirm all Git operations have finished before resolving that lock. " : ""}Preserve the current index and the openbar-checkpoint-recovery.json file in Git's administrative directory. Inspect the branch and staged changes with Git, reconcile the index while preserving your staged work, then remove the recovery journal and retry.`;
}

/** Local summaries use simple-git's parsers and a separate environment per command. */
function projectGit(cwd: string) {
  const env = gitProcessEnv({ ...process.env, GIT_OPTIONAL_LOCKS: "0" });
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

class GitCommandError extends Error {
  constructor(message: string, readonly exitCode?: number) { super(message); }
}

async function runGit(cwd: string, args: string[], options: { indexPath?: string; onProgress?: (line: string) => void } = {}): Promise<string> {
  const { execa } = await import("execa");
  const environment = { ...process.env, ...(options.indexPath ? { GIT_INDEX_FILE: options.indexPath } : {}), ...(["status", "diff"].includes(args[0]) ? { GIT_OPTIONAL_LOCKS: "0" } : {}) };
  const gitArgs = args[0] === "diff" ? ["-c", "diff.autoRefreshIndex=false", ...args] : args;
  const child = execa("git", gitArgs, {
    cwd,
    env: gitProcessEnv(environment),
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
  let flushProgress = () => {};
  if (options.onProgress && child.stderr) {
    const decoder = new StringDecoder("utf8");
    let pending = "";
    let oversized = false;
    let lines = 0;
    const emit = (line: string) => {
      if (lines >= 2000) return;
      const safe = redactSensitiveText(line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")).trim();
      if (!safe) return;
      lines += 1;
      try { options.onProgress?.(safe.slice(0, 500)); } catch { /* A closed client must not interrupt Git. */ }
    };
    const consume = (chunk: string, final = false) => {
      for (const char of chunk) {
        if (char === "\n" || char === "\r") {
          if (oversized) emit("[Long Git output line omitted.]");
          else emit(pending);
          pending = "";
          oversized = false;
        } else if (!oversized) {
          pending += char;
          if (pending.length > 2048) { pending = ""; oversized = true; }
        }
      }
      if (final) {
        if (oversized) emit("[Long Git output line omitted.]");
        else emit(pending);
        pending = "";
      }
    };
    child.stderr.on("data", (chunk: Buffer) => consume(decoder.write(chunk)));
    flushProgress = () => consume(decoder.end(), true);
  }
  const result = await child;
  flushProgress();
  if (result.failed) {
    const reason = result.timedOut ? "Git exceeded the two-minute execution limit."
      : result.isMaxBuffer ? "Git output exceeded the 10 MiB limit."
      : result.originalMessage || `Git exited with status ${result.exitCode ?? result.signal ?? "unknown"}.`;
    const exitCode = !result.timedOut && !result.isMaxBuffer && !result.signal && typeof result.exitCode === "number" ? result.exitCode : undefined;
    throw new GitCommandError(redactSensitiveText(Buffer.from(result.stderr).toString() || reason), exitCode);
  }
  return Buffer.from(result.stdout).toString();
}

/** Disabling rename grouping reports both paths and preserves every filename byte. */
async function changedGitPaths(cwd: string, args: string[], options: { indexPath?: string } = {}): Promise<string[]> {
  return splitNulRecords(await runGit(cwd, ["diff", "--no-renames", "--name-only", "-z", ...args], options));
}

/** Keep the fetched commit independent of Git's shared FETCH_HEAD file. */
async function fetchGitBranchCommit(cwd: string, branch: string, onProgress?: (line: string) => void): Promise<string> {
  const temporaryRef = `refs/openbar/fetch/${crypto.randomUUID()}`;
  let fetched = "";
  try {
    await runGit(cwd, ["fetch", "--atomic", "--no-tags", "--no-write-fetch-head", ...(onProgress ? ["--progress"] : []), "origin",
      `+refs/heads/${branch}:refs/remotes/origin/${branch}`, `+refs/heads/${branch}:${temporaryRef}`], { onProgress });
    fetched = (await runGit(cwd, ["rev-parse", "--verify", `${temporaryRef}^{commit}`])).trim();
    return fetched;
  } finally {
    if (!fetched) {
      const listed = await runGit(cwd, ["for-each-ref", "--format=%(refname)%00%(objectname)", temporaryRef]);
      fetched = listed.split("\n").map(line => line.split("\0")).find(parts => parts[0] === temporaryRef)?.[1] || "";
    }
    if (fetched) await runGit(cwd, ["update-ref", "-d", temporaryRef, fetched]);
  }
}

/** List local work that an incoming tree would need to replace. */
async function findGitUpdateBlockers(cwd: string, from: string, to: string): Promise<string[]> {
  const incoming = await changedGitPaths(cwd, [from, to]);
  if (!incoming.length) return [];
  const output = await runGit(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const local = porcelainPaths(parsePorcelainZ(output));
  const ignoredCandidates = new Set(incoming);
  for (const target of incoming) {
    let parent = path.posix.dirname(target);
    while (parent !== ".") {
      try {
        const stat = fs.lstatSync(path.join(cwd, parent));
        if (!stat.isDirectory() || stat.isSymbolicLink()) ignoredCandidates.add(parent);
      } catch { /* A missing parent cannot contain local files. */ }
      parent = path.posix.dirname(parent);
    }
  }
  const candidates = [...ignoredCandidates];
  for (let offset = 0; offset < candidates.length; offset += 500) {
    const spec = candidates.slice(offset, offset + 500).map(file => `:(literal)${file}`);
    const ignored = await runGit(cwd, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", ...spec]);
    local.push(...splitNulRecords(ignored));
  }
  const unique = [...new Set(local)];
  return unique.filter(file => incoming.some(target => file === target || file.startsWith(`${target}/`) || target.startsWith(`${file}/`)));
}

function formatGitUpdateBlockers(paths: string[]): string {
  const safePaths = paths.slice(0, 10).map(file => isSensitivePath(file)
    ? "[sensitive path]"
    : JSON.stringify(file.replace(/[\u202a-\u202e\u2066-\u2069]/g, "").slice(0, 180)));
  const extra = paths.length > safePaths.length ? ` and ${paths.length - safePaths.length} more` : "";
  return `Local changes overlap the Git update: ${safePaths.join(", ")}${extra}. Save a copy and restore tracked files to the checkpoint, or move untracked files to a safe location, then retry. You can also commit the changes with your usual Git tools and start a new review. Your local changes are preserved.`;
}

/** An empty listing means the local tracking ref is absent. Command errors remain errors. */
async function hasRemoteTrackingBranch(cwd: string, branch: string): Promise<boolean> {
  const ref = `refs/remotes/origin/${branch}`;
  const output = await runGit(cwd, ["for-each-ref", "--format=%(refname)", ref]);
  return output.split("\n").includes(ref);
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
        const hasTrackingBranch = await hasRemoteTrackingBranch(cwd, branch);
        const counts = hasTrackingBranch
          ? (await runGit(cwd, ["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`])).trim()
          : `${(await runGit(cwd, ["rev-list", "--count", "HEAD"])).trim()} 0`;
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
const pendingStatusRefreshes = new Map<string, Promise<OverleafGitStatus>>();

export async function refreshOverleafGitStatus(projectDir: string): Promise<OverleafGitStatus> {
  const cwd = resolveGitDir(projectDir);
  const refreshKey = path.resolve(projectDir);
  const existing = pendingStatusRefreshes.get(refreshKey);
  if (existing) return existing;
  const refresh = (async () => {
    const current = await getOverleafGitStatus(projectDir);
    if (!current.isGitRepo || !current.remoteUrl) return current;
    if (!current.isOverleafRemote) {
      return { ...current, error: "Git remote unavailable: origin is not git.overleaf.com." };
    }
    try {
      return await withGitSyncLock(cwd, async () => {
        // Recheck the remote after waiting for a concurrent synchronization.
        const locked = await getOverleafGitStatus(projectDir);
        if (!locked.isGitRepo || !locked.remoteUrl || !locked.isOverleafRemote) return locked;
        await runGit(cwd, ["fetch", "--prune", "origin"]);
        return getOverleafGitStatus(projectDir);
      });
    } catch (error) {
      return { ...current, error: "Git status unavailable: " + gitErrorMessage(error) };
    }
  })();
  pendingStatusRefreshes.set(refreshKey, refresh);
  try { return await refresh; }
  finally { if (pendingStatusRefreshes.get(refreshKey) === refresh) pendingStatusRefreshes.delete(refreshKey); }
}

type DirectPullResult = { ok: boolean; message: string; uncertain?: boolean };
export type DirectPullReconciliation = { state: "resolved"; result: DirectPullResult } | { state: "pending"; message: string };
type DirectPullReceipt = { version: 1; projectKey: string; state: "pending" | "applying" | "resolved"; branch?: string; targetHead?: string; result?: DirectPullResult };

async function directPullReceiptPath(cwd: string, operationId: string): Promise<string> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(operationId)) throw new Error("Invalid Git pull operation ID.");
  const directory = await resolveGitAdministrativePath(cwd, "openbar-direct-pulls");
  return path.join(directory, `${operationId.toLowerCase()}.json`);
}

function readDirectPullReceipt(file: string, projectKey: string): DirectPullReceipt | undefined {
  if (!fs.existsSync(file)) return undefined;
  const receipt = JSON.parse(fs.readFileSync(file, "utf8")) as DirectPullReceipt;
  if (receipt.version !== 1 || receipt.projectKey !== projectKey || !["pending", "applying", "resolved"].includes(receipt.state)
    || (receipt.state === "applying" && (typeof receipt.branch !== "string" || !receipt.branch || typeof receipt.targetHead !== "string" || !/^[a-f0-9]{40,64}$/i.test(receipt.targetHead)))
    || (receipt.state === "resolved" && (!receipt.result || typeof receipt.result.ok !== "boolean" || typeof receipt.result.message !== "string" || receipt.result.uncertain))) {
    throw new Error("The Git pull operation receipt could not be verified. Keep the editor paused and inspect the project state.");
  }
  return receipt;
}

function saveDirectPullReceipt(file: string, receipt: DirectPullReceipt): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(receipt));
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
    syncDirectory(path.dirname(file));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
}

/** Resolve the exact request. A tombstone prevents an unseen request arriving later. */
export async function reconcileDirectPull(projectDir: string, operationId: string): Promise<DirectPullReconciliation> {
  const cwd = resolveGitDir(projectDir);
  if (!fs.existsSync(path.join(cwd, ".git"))) throw new Error("Directory is not a Git repository.");
  return withGitSyncLock(cwd, async () => {
    const file = await directPullReceiptPath(cwd, operationId);
    const projectKey = sha256(path.resolve(projectDir));
    const existing = readDirectPullReceipt(file, projectKey);
    if (existing?.state === "resolved") return { state: "resolved", result: existing.result! };
    if (existing?.state === "applying") {
      const completed = await withProjectWriteLockAsync(projectDir, async () => {
        if (fs.existsSync(sourceTransactionJournalPath(texPaths(projectDir).manuscriptDir))) return false;
        if (fs.existsSync(await checkpointJournalPath(cwd))) return false;
        const branch = (await runGit(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
        const head = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
        const dirty = (await projectGit(cwd).status(["--untracked-files=no"])).files.length;
        return branch === existing.branch && head === existing.targetHead && !dirty;
      });
      if (!completed) return { state: "pending", message: "The Git pull outcome needs inspection. Keep the editor paused and check the saved project state before retrying." };
      const result = { ok: true, message: "The Git pull completed." };
      saveDirectPullReceipt(file, { version: 1, projectKey, state: "resolved", result });
      return { state: "resolved", result };
    }
    const result = { ok: false, message: "The Git pull was cancelled before it started." };
    saveDirectPullReceipt(file, { version: 1, projectKey, state: "resolved", result });
    return { state: "resolved", result };
  });
}

export async function pullOverleafGit(projectDir: string, operationId: string): Promise<DirectPullResult> {
  const cwd = resolveGitDir(projectDir);
  if (!fs.existsSync(path.join(cwd, ".git"))) {
    return { ok: false, message: "Directory is not a git repository." };
  }

  return withGitSyncLock(cwd, async () => {
    const file = await directPullReceiptPath(cwd, operationId);
    const projectKey = sha256(path.resolve(projectDir));
    const existing = readDirectPullReceipt(file, projectKey);
    if (existing?.state === "resolved") return existing.result!;
    if (existing) return { ok: false, uncertain: true, message: "The Git pull outcome is still being checked. Keep the editor paused and retry the check." };
    saveDirectPullReceipt(file, { version: 1, projectKey, state: "pending" });
    const result: DirectPullResult = await (async () => {
      let mergeStarted = false;
      try {
      const pendingCheckpoint = await withProjectWriteLockAsync(projectDir, () => checkpointRecoveryMessage(cwd));
      if (pendingCheckpoint) return { ok: false, message: pendingCheckpoint };
      const remoteUrl = (await runGit(cwd, ["config", "--get", "remote.origin.url"])).trim();
      if (!isOverleafGitRemote(remoteUrl)) {
        return { ok: false, message: "Connect this project to Git before pulling updates." };
      }
      const branch = (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      if (!branch || branch === "HEAD") return { ok: false, message: "Select a named Git branch before pulling updates." };
      // Fetch while local saves remain available, then protect the worktree
      // update with the project lock. Git checks for overwritten local paths.
      const fetchedCommit = await fetchGitBranchCommit(cwd, branch);
      return await withProjectWriteLockAsync(projectDir, async () => {
        const recovery = recoverSourceTransaction(texPaths(projectDir).manuscriptDir, true);
        if (!recovery.ok) return { ok: false, message: recovery.message || "The manuscript transaction requires recovery before pulling Git updates." };
        const currentBranch = (await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
        if (currentBranch !== branch) return { ok: false, message: "The Git branch changed. Check updates and try again." };
        const currentHead = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
        const blockers = await findGitUpdateBlockers(cwd, currentHead, fetchedCommit);
        if (blockers.length) return { ok: false, message: formatGitUpdateBlockers(blockers) };
        saveDirectPullReceipt(file, { version: 1, projectKey, state: "applying", branch, targetHead: fetchedCommit });
        mergeStarted = true;
        const output = (await runGit(cwd, ["merge", "--ff-only", "--no-overwrite-ignore", fetchedCommit])).trim();
        return { ok: true, message: output || "Already up to date." };
      });
      } catch (error) {
        return { ok: false, message: `Could not pull Git updates: ${gitErrorMessage(error)}`, ...(mergeStarted ? { uncertain: true } : {}) };
      }
    })();
    if (result.uncertain) return result;
    try { saveDirectPullReceipt(file, { version: 1, projectKey, state: "resolved", result }); }
    catch { return { ok: false, uncertain: true, message: "The Git pull finished, but its completion could not be recorded. Keep the editor paused and inspect the project state." }; }
    return result;
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

export function isSafeCommittedPath(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  return !normalized.startsWith(".git/")
    && !normalized.includes("/.git/")
    && !/(^|\/)(?:\.OpenBar|\.openbarry|openbarry)\/(?:build|recovery)(?:\/|$)/.test(normalized)
    && !/(^|\/)(?:\.OpenBar|\.openbarry|openbarry)\/project-write(?:\.ob-lock)?$/.test(normalized)
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
  try {
    // Wait for any remote operation before taking the local write lock. This
    // keeps manuscript saves available while Git waits on the network.
    return await withGitSyncLock(cwd, () => withProjectWriteLockAsync(projectDir, async () => {
      const pendingCheckpoint = await checkpointRecoveryMessage(cwd);
      if (pendingCheckpoint) return { ok: false, status: "blocked", code: "checkpoint_recovery_required", message: pendingCheckpoint, paths: [] };
      // A Git checkpoint must contain a complete manuscript state. Resolve an
      // interrupted multi-file write while holding the same project lock.
      const recovery = recoverSourceTransaction(texPaths(projectDir).manuscriptDir, true);
      if (!recovery.ok) return { ok: false, status: "blocked", code: "source_transaction_recovery_failed", message: recovery.message || "The manuscript transaction requires recovery before creating a Git checkpoint.", paths: [] };
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
        let ordinaryLockIdentity: { dev: number; ino: number } | undefined;
        const lockIsOurs = () => {
          try {
            const current = fs.lstatSync(ordinaryLockPath);
            return Boolean(ordinaryLockIdentity && current.dev === ordinaryLockIdentity.dev && current.ino === ordinaryLockIdentity.ino);
          } catch { return false; }
        };
        try {
          // Git's native lock keeps concurrent staging atomic while advancing
          // only index entries that still match their pre-checkpoint version.
          ordinaryLock = fs.openSync(ordinaryLockPath, "wx");
          ownsOrdinaryLock = true;
          const acquiredLock = fs.fstatSync(ordinaryLock);
          ordinaryLockIdentity = { dev: acquiredLock.dev, ino: acquiredLock.ino };
          const alignedIndexPath = path.join(temporaryIndex.directory, "aligned-index");
          const originalIndexBytes = fs.existsSync(ordinaryIndexPath) ? fs.readFileSync(ordinaryIndexPath) : null;
          if (originalIndexBytes) fs.writeFileSync(alignedIndexPath, originalIndexBytes);
          else await runGit(cwd, ["read-tree", "--empty"], { indexPath: alignedIndexPath });
          const alignedOptions = { indexPath: alignedIndexPath };
          const currentIndex = indexEntries(await runGit(cwd, ["ls-files", "--stage", "-z", "--", ...indexPaths], alignedOptions));
          const advancePaths = stagedPaths.filter((file) => originalIndex.get(file) === baseIndex.get(file)
            && currentIndex.get(file) === originalIndex.get(file));
          if (advancePaths.length) {
            await runGit(cwd, ["reset", "--quiet", commitHash, "--", ...advancePaths.map((file) => `:(literal)${file}`)], alignedOptions);
          }
          const preparedIndex = fs.readFileSync(alignedIndexPath);
          fs.writeFileSync(ordinaryLock, preparedIndex);
          fs.fchmodSync(ordinaryLock, fs.existsSync(ordinaryIndexPath) ? fs.statSync(ordinaryIndexPath).mode & 0o777 : 0o644);
          fs.fsyncSync(ordinaryLock);
          fs.closeSync(ordinaryLock);
          ordinaryLock = undefined;
          await writeCheckpointJournal(cwd, {
            version: 1, branch, beforeHead: head, afterHead: commitHash,
            originalIndexHash: originalIndexBytes ? sha256(originalIndexBytes) : null,
            preparedIndexHash: sha256(preparedIndex), preparedIndex: preparedIndex.toString("base64"),
          });
          if (!lockIsOurs()) throw new Error("The Git index lock changed before checkpointing. Inspect Git state and the checkpoint recovery journal.");
          await runGit(cwd, ["update-ref", `refs/heads/${branch}`, commitHash, head || "0".repeat(commitHash.length)]);
          try {
            if (!lockIsOurs()) throw new Error("The Git index lock changed during checkpointing. Inspect Git state and the checkpoint recovery journal.");
            fs.renameSync(ordinaryLockPath, ordinaryIndexPath);
            ownsOrdinaryLock = false;
          } catch (error) {
            await runGit(cwd, head ? ["update-ref", `refs/heads/${branch}`, head, commitHash] : ["update-ref", "-d", `refs/heads/${branch}`, commitHash]);
            throw error;
          }
          await clearCheckpointJournal(cwd).catch(() => undefined);
        } finally {
          if (ordinaryLock !== undefined) fs.closeSync(ordinaryLock);
          if (ownsOrdinaryLock && lockIsOurs()) fs.rmSync(ordinaryLockPath, { force: true });
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
    }));
  } catch (error) {
    return { ok: false, status: "failed", code: "git_admin_path", message: "Local commit failed: " + gitErrorMessage(error), paths: [] };
  }
}

/** Push existing local commits to the validated Git branch. */
export async function syncOverleafGit(projectDir: string, expectedCommitHash?: string): Promise<OverleafGitRemoteSyncResult> {
  const cwd = resolveGitDir(projectDir);
  if (!fs.existsSync(path.join(cwd, ".git"))) return { ok: false, status: "failed", code: "not_git_repo", message: "Directory is not a git repository.", retryable: false };
  try {
    return await withGitSyncLock(cwd, async () => {
      try {
        const pendingCheckpoint = await withProjectWriteLockAsync(projectDir, () => checkpointRecoveryMessage(cwd));
        if (pendingCheckpoint) return { ok: false, status: "failed", code: "checkpoint_recovery_required", message: pendingCheckpoint, retryable: false };
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
        const remoteBranchExists = await hasRemoteTrackingBranch(cwd, branch);
        if (remoteBranchExists) {
          const counts = (await runGit(cwd, ["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`])).trim();
          if (!/^\d+\s+\d+$/.test(counts)) throw new Error("Git returned an invalid local and remote commit comparison.");
          const [localAhead, remoteAhead] = counts.split(/\s+/).map(Number);
          if (!Number.isSafeInteger(localAhead) || !Number.isSafeInteger(remoteAhead)) throw new Error("Git returned an invalid local and remote commit comparison.");
          ahead = localAhead;
          behind = remoteAhead;
        } else {
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

export type ProjectGitDestination = { kind: "local" | "git" } | { kind: "overleaf"; id: string; url: string };

/** Read the configured origin without contacting the remote. */
export async function getProjectGitDestination(projectDir: string): Promise<ProjectGitDestination> {
  const cwd = resolveGitDir(projectDir);
  if (!fs.existsSync(path.join(cwd, ".git"))) return { kind: "local" };
  const origin = await runGit(cwd, ["config", "--local", "--get", "remote.origin.url"]).catch(() => "");
  const id = overleafProjectId(redactGitRemote(origin.trim()) || "");
  return id ? { kind: "overleaf", id, url: `https://www.overleaf.com/project/${id}` } : { kind: "git" };
}

export class OverleafSetupError extends Error {}

/** Clone an explicitly selected project into a private staging directory. */
export async function cloneOverleafProject(staging: string, id: string): Promise<string[]> {
  if (!/^[a-f0-9]{24}$/.test(id)) throw new OverleafSetupError("Paste an Overleaf project URL.");
  try {
    await runGit(staging, ["-c", "http.followRedirects=false", "clone", "--no-tags", "--no-recurse-submodules", "--no-checkout",
      "--", `https://git.overleaf.com/${id}`, "."]);
    for (const [key, fallback] of [["user.name", "OpenBar"], ["user.email", "openbar@localhost"]] as const) {
      const identity = await runGit(staging, ["config", "--get", key]).catch(() => "");
      if (!identity.trim()) await runGit(staging, ["config", "--local", key, fallback]);
    }
    const head = await runGit(staging, ["rev-parse", "--verify", "HEAD"]).catch(() => "");
    if (!head.trim()) {
      if ((await runGit(staging, ["for-each-ref", "refs/remotes/origin"])).trim()) {
        throw new OverleafSetupError("The Overleaf repository needs a default branch before OpenBar can open it.");
      }
      return [];
    }
    const entries = splitNulRecords(await runGit(staging, ["ls-tree", "-rz", "HEAD"]));
    if (entries.some(entry => !/^100(?:644|755) blob /.test(entry))) {
      throw new OverleafSetupError("Choose an Overleaf project whose files are regular files. This repository contains a link or submodule.");
    }
    await runGit(staging, ["reset", "--hard", "HEAD"]);
    return entries.map(entry => entry.slice(entry.indexOf("\t") + 1));
  } catch (error) {
    if (error instanceof OverleafSetupError) throw error;
    throw new OverleafSetupError("OpenBar could not read this Overleaf project. Check the URL, Git access, and the host’s Overleaf Git token.");
  }
}

export function isBlankOverleafProject(staging: string, files: string[]): boolean {
  if (!files.length) return true;
  if (files.length !== 1 || files[0] !== "main.tex") return false;
  const source = fs.readFileSync(path.join(staging, "main.tex"), "utf8").trim();
  // Accept the stock blank-project template as well as an empty main file.
  return !source || /^\\documentclass\{article\}\s*(?:\\usepackage\{graphicx\}(?:[ \t]*% Required for inserting images)?\s*)?\\title\{[^{}\r\n]*\}\s*(?:\\author\{[^{}\r\n]*\}\s*)?(?:\\date\{[^{}\r\n]*\}\s*)?\\begin\{document\}\s*\\maketitle\s*\\section\{Introduction\}\s*\\end\{document\}$/.test(source);
}

/** Install an already-verified checkout's history without replacing the draft. */
export function attachOverleafCheckout(projectDir: string, staging: string, files: string[]): void {
  const cwd = resolveGitDir(projectDir);
  const gitDir = path.join(cwd, ".git");
  if (fs.existsSync(gitDir)) throw new OverleafSetupError("This project already has a Git checkout.");
  if (!isBlankOverleafProject(staging, files)) {
    const root = fs.realpathSync(cwd);
    const matches = files.every(file => {
      const local = path.join(root, file);
      try {
        return fs.realpathSync(local) === local
          && fs.statSync(local).isFile()
          && fs.readFileSync(local).equals(fs.readFileSync(path.join(staging, file)));
      } catch {
        return false;
      }
    });
    if (!matches) throw new OverleafSetupError("This Overleaf project has different files. Choose a blank Overleaf project to publish this draft, or import the other project separately.");
  }
  fs.renameSync(path.join(staging, ".git"), gitDir);
}

export type OverleafConflictChoice = { path: string; choice: "local" | "remote" | "merged"; text?: string };
export type OverleafPullReview = {
  token: string;
  localCommit: string;
  remoteCommit: string;
  files: string[];
  conflicts: { path: string; local: string | null; remote: string | null; base: string | null; merged: string | null; editable: boolean }[];
};
type PullSession = { worktree: string; localCommit: string; remoteCommit: string; branch: string; conflicts: string[]; resultHead?: string; applied?: boolean };
type PullFinishResult = { ok: boolean; message: string; applied?: boolean };

async function pullSessionPath(cwd: string, token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Invalid pull review.");
  return resolveGitAdministrativePath(cwd, `openbar-pull-reviews/${token}.json`);
}

async function removePullSession(cwd: string, token: string, session: PullSession) {
  if (fs.existsSync(session.worktree)) {
    await runGit(cwd, ["worktree", "remove", "--force", session.worktree]);
    fs.rmSync(path.dirname(session.worktree), { recursive: true, force: true });
  }
  fs.rmSync(await pullSessionPath(cwd, token), { force: true });
}

async function savePullSession(cwd: string, token: string, session: PullSession) {
  const file = await pullSessionPath(cwd, token);
  writeTextAtomic(file, JSON.stringify(session));
  fs.chmodSync(file, 0o600);
}

async function appliedPullResult(cwd: string, session: PullSession): Promise<PullFinishResult> {
  let cleanupError = "";
  if (fs.existsSync(session.worktree)) {
    try {
      await runGit(cwd, ["worktree", "remove", "--force", session.worktree]);
      fs.rmSync(path.dirname(session.worktree), { recursive: true, force: true });
    } catch (error) { cleanupError = " Temporary review cleanup needs attention: " + gitErrorMessage(error); }
  }
  return { ok: true, applied: true, message: "Git updates applied locally. Use Save to Git to publish the combined version." + cleanupError };
}

/** Prepare Git's three-way merge in a disposable worktree for human review. */
export async function prepareOverleafPull(projectDir: string, onProgress?: (line: string) => void): Promise<{ ok: true; review: OverleafPullReview } | { ok: false; message: string }> {
  const cwd = resolveGitDir(projectDir);
  const initial = await getOverleafGitStatus(projectDir);
  if (!initial.isOverleafRemote) return { ok: false, message: "Connect this project to Git before pulling updates." };
  // Preserve accepted local manuscript changes in history before merging.
  const checkpoint = await commitOverleafGit(projectDir, "OpenBar: checkpoint before Git pull");
  if (!checkpoint.ok) return { ok: false, message: checkpoint.message };
  return withGitSyncLock(cwd, async () => {
    let worktree: string | undefined;
    try {
      const branch = (await runGit(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
      const remoteCommit = await fetchGitBranchCommit(cwd, branch, onProgress);
      const localCommit = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
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
      await savePullSession(cwd, token, session);
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

export async function finishOverleafPull(projectDir: string, token: string, choices: OverleafConflictChoice[], cancel = false): Promise<PullFinishResult> {
  const cwd = resolveGitDir(projectDir);
  return withGitSyncLock(cwd, async () => {
    try {
      const sessionFile = await pullSessionPath(cwd, token);
      if (!fs.existsSync(sessionFile) && cancel) return { ok: true, message: "Review closed. Your local checkpoint is preserved." };
      const session = JSON.parse(fs.readFileSync(sessionFile, "utf8")) as PullSession;
      if (session.applied) return appliedPullResult(cwd, session);
      if (session.resultHead) {
        let present = false;
        try {
          await runGit(cwd, ["merge-base", "--is-ancestor", session.resultHead, `refs/heads/${session.branch}`]);
          present = true;
        } catch (error) {
          if (!(error instanceof GitCommandError) || error.exitCode !== 1) throw error;
        }
        if (present) {
          session.applied = true;
          await savePullSession(cwd, token, session).catch(() => undefined);
          return appliedPullResult(cwd, session);
        }
      }
      if (cancel) {
        await removePullSession(cwd, token, session);
        return { ok: true, message: "Review closed. Your local checkpoint is preserved." };
      }
      const currentHead = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
      const currentBranch = (await runGit(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
      if (currentHead !== session.localCommit || currentBranch !== session.branch) {
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
      const applied = await withProjectWriteLockAsync(projectDir, async () => {
        const pendingCheckpoint = await checkpointRecoveryMessage(cwd);
        if (pendingCheckpoint) return { ok: false as const, message: pendingCheckpoint };
        const recovery = recoverSourceTransaction(texPaths(projectDir).manuscriptDir, true);
        if (!recovery.ok) return { ok: false as const, message: recovery.message || "The manuscript transaction requires recovery before applying Git updates." };
        const currentHead = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
        const currentBranch = (await runGit(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
        if (currentHead !== session.localCommit || currentBranch !== session.branch) {
          return { ok: false as const, message: "The Git branch changed during review. Close this review and pull again to include the latest checkpoint." };
        }
        const blockers = await findGitUpdateBlockers(cwd, currentHead, resultHead);
        if (blockers.length) return { ok: false as const, message: formatGitUpdateBlockers(blockers) };
        session.resultHead = resultHead;
        await savePullSession(cwd, token, session);
        await runGit(cwd, ["merge", "--ff-only", "--no-overwrite-ignore", resultHead]);
        return { ok: true as const };
      });
      if (!applied.ok) return applied;
      session.applied = true;
      await savePullSession(cwd, token, session).catch(() => undefined);
      return appliedPullResult(cwd, session);
    } catch (error) {
      return { ok: false, message: gitErrorMessage(error) };
    }
  });
}

export type ForceSyncDirection = "pull" | "push";
export type ForceSyncReview = { token: string; direction: ForceSyncDirection; branch: string; localCommit: string; remoteCommit: string; files: string[]; ahead: number; behind: number };
type ForceSyncSession = ForceSyncReview & { confirmation?: string; phase?: "applying" | "applied" };
async function forceSyncPath(cwd: string, token: string) {
  if (!/^[a-f0-9-]{36}$/.test(token)) throw new Error("Invalid force synchronization review.");
  return resolveGitAdministrativePath(cwd, `openbar-force-reviews/${token}.json`);
}
async function saveForceSyncSession(cwd: string, session: ForceSyncSession): Promise<void> {
  const file = await forceSyncPath(cwd, session.token);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(session));
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
    syncDirectory(path.dirname(file));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporary, { force: true });
  }
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
      const remoteCommit = await fetchGitBranchCommit(cwd, branch);
      const localCommit = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
      const [ahead, behind] = (await runGit(cwd, ["rev-list", "--left-right", "--count", `${localCommit}...${remoteCommit}`])).trim().split(/\s+/).map(Number);
      const files = (await runGit(cwd, ["diff", "--name-only", "-z", localCommit, remoteCommit])).split("\0").filter(Boolean);
      const { randomUUID } = await import("node:crypto");
      const review: ForceSyncReview = { token: randomUUID(), direction, branch, localCommit, remoteCommit, files, ahead, behind };
      await saveForceSyncSession(cwd, review);
      return { ok: true as const, review };
    } catch (error) { return { ok: false as const, message: gitErrorMessage(error) }; }
  });
}

/** First explicit confirmation creates a separate receipt required by the final confirmation. */
export async function confirmForceSync(projectDir: string, token: string): Promise<{ ok: true; confirmation: string } | { ok: false; message: string }> {
  try {
    const cwd = resolveGitDir(projectDir);
    return await withGitSyncLock(cwd, async () => {
      const file = await forceSyncPath(cwd, token);
      const session = JSON.parse(fs.readFileSync(file, "utf8")) as ForceSyncSession;
      if (session.phase) return { ok: false as const, message: "This force synchronization has already started. Check its result before continuing." };
      const { randomUUID } = await import("node:crypto");
      session.confirmation = randomUUID();
      await saveForceSyncSession(cwd, session);
      return { ok: true as const, confirmation: session.confirmation };
    });
  } catch (error) { return { ok: false, message: gitErrorMessage(error) }; }
}

export async function finishForceSync(projectDir: string, token: string, confirmation: string, phrase: string, cancel = false): Promise<{ ok: boolean; message: string; recoveryRefs?: string[]; applied?: boolean; uncertain?: boolean }> {
  const cwd = resolveGitDir(projectDir);
  return withGitSyncLock(cwd, async () => {
    let mutationStarted = false;
    try {
      const file = await forceSyncPath(cwd, token);
      if (cancel && !fs.existsSync(file)) return { ok: true, message: "Force synchronization cancelled." };
      const session = JSON.parse(fs.readFileSync(file, "utf8")) as ForceSyncSession;
      mutationStarted = session.phase === "applying";
      const refs = [`refs/openbar/recovery/${token}/local`, `refs/openbar/recovery/${token}/overleaf`];
      const success = () => ({ ok: true as const, applied: true, message: session.direction === "pull" ? "Local project now matches the reviewed Git commit." : "Git now matches the reviewed local commit.", recoveryRefs: refs });
      const uncertain = () => ({ ok: false as const, uncertain: true, message: "The force synchronization may have completed. Keep this editor open and check the project state before continuing." });
      if (session.phase === "applied") return success();
      if (cancel && !session.phase) { fs.rmSync(file); return { ok: true, message: "Force synchronization cancelled." }; }
      if (!cancel && (!session.confirmation || confirmation !== session.confirmation || phrase !== `FORCE ${session.direction.toUpperCase()}`)) throw new Error("Both confirmations are required before forcing synchronization.");
      if (session.phase === "applying" && session.direction === "pull") {
        const completed = await withProjectWriteLockAsync(projectDir, async () => {
          if (await checkpointRecoveryMessage(cwd)) return false;
          if (fs.existsSync(sourceTransactionJournalPath(texPaths(projectDir).manuscriptDir))) return false;
          const branch = (await runGit(cwd, ["symbolic-ref", "--short", "HEAD"])).trim();
          const head = (await runGit(cwd, ["rev-parse", "HEAD"])).trim();
          const dirty = (await projectGit(cwd).status(["--untracked-files=no"])).files.length;
          return branch === session.branch && head === session.remoteCommit && !dirty;
        });
        if (!completed) return uncertain();
        session.phase = "applied";
        await saveForceSyncSession(cwd, session).catch(() => undefined);
        return success();
      }
      const remoteUrl = (await runGit(cwd, ["config", "--get", "remote.origin.url"])).trim();
      if (!isOverleafGitRemote(remoteUrl)) throw new Error("Connect this project to Git before forcing synchronization.");
      const remoteHead = (await runGit(cwd, ["ls-remote", "--heads", remoteUrl, `refs/heads/${session.branch}`])).trim().split(/\s+/)[0];
      if (session.phase === "applying" && session.direction === "push" && remoteHead === session.localCommit) {
        session.phase = "applied";
        await saveForceSyncSession(cwd, session).catch(() => undefined);
        return success();
      }
      if (cancel && session.phase) return uncertain();
      if (remoteHead !== session.remoteCommit) throw new Error("Git changed after your review. Start again to review its newest version.");
      const guarded = await withProjectWriteLockAsync(projectDir, async () => {
        const pendingCheckpoint = await checkpointRecoveryMessage(cwd);
        if (pendingCheckpoint) return { ok: false as const, message: pendingCheckpoint };
        const recovery = recoverSourceTransaction(texPaths(projectDir).manuscriptDir, true);
        if (!recovery.ok) return { ok: false as const, message: recovery.message || "The manuscript transaction requires recovery before forcing synchronization." };
        const status = await getOverleafGitStatus(projectDir);
        if (!status.isOverleafRemote || status.branch !== session.branch || status.lastCommit?.hash !== session.localCommit || (await projectGit(cwd).status(["--untracked-files=no"])).files.length) {
          return { ok: false as const, message: "The local project changed. Start a fresh force synchronization review." };
        }
        if (session.direction === "pull") {
          const blockers = await findGitUpdateBlockers(cwd, session.localCommit, session.remoteCommit);
          if (blockers.length) return { ok: false as const, message: formatGitUpdateBlockers(blockers) };
        }
        await runGit(cwd, ["update-ref", refs[0], session.localCommit]);
        await runGit(cwd, ["update-ref", refs[1], session.remoteCommit]);
        session.phase = "applying";
        await saveForceSyncSession(cwd, session);
        if (session.direction === "pull") {
          mutationStarted = true;
          await runGit(cwd, ["reset", "--keep", session.remoteCommit]);
          session.phase = "applied";
          await saveForceSyncSession(cwd, session).catch(() => undefined);
        }
        return { ok: true as const };
      });
      if (!guarded.ok) return guarded;
      if (session.direction === "push") {
        mutationStarted = true;
        await runGit(cwd, ["push", `--force-with-lease=refs/heads/${session.branch}:${session.remoteCommit}`, remoteUrl, `${session.localCommit}:refs/heads/${session.branch}`]);
        session.phase = "applied";
        await saveForceSyncSession(cwd, session).catch(() => undefined);
      }
      return success();
    } catch (error) { return { ok: false, message: gitErrorMessage(error), ...(mutationStarted ? { uncertain: true } : {}) }; }
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
