import fs from "node:fs";
import path from "node:path";

import { sha256, writeTextAtomic } from "./codec";
import { withProjectWriteLock } from "@/lib/research/project-lock";
import { traverseInputGraph } from "./source-graph";

const JOURNAL_VERSION = 1 as const;
const JOURNAL_NAME = "source-transaction.json";

export type SourceTransactionWrite = {
  filePath: string;
  previous: string | null;
  next: string | null;
};

export type SourceTransactionInput = {
  requestId: string;
  writes: SourceTransactionWrite[];
};

type SourceTransactionJournal = {
  version: typeof JOURNAL_VERSION;
  requestId: string;
  createdAt: string;
  files: Array<SourceTransactionWrite & { previousHash: string | null; nextHash: string | null }>;
};

type TransactionDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  filePath?: string;
};

export type SourceTransactionRecovery = {
  ok: boolean;
  journalPath: string;
  recovered: boolean;
  affectedPaths: string[];
  message?: string;
  diagnostics: TransactionDiagnostic[];
};

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Transaction journals may touch manuscript source and the map records used
 * by coordinated TODO conversion. Runtime state and Git metadata stay out. */
function isAllowedTransactionLocation(relative: string, prefix = false): boolean {
  const parts = relative.split("/").filter(Boolean);
  if (!parts.length) return prefix;
  const lower = parts.map(part => part.toLowerCase());
  if (lower[0] === ".openbar" || lower[0] === "openbarry") {
    if (prefix && parts.length === 1) return true;
    if (parts.length === 2 && lower[1] === "mindmap.tex") return true;
    if (lower[1] !== "mindmaps") return false;
    if (prefix && parts.length === 2) return true;
    return parts.length === 3 && /^[a-z0-9][a-z0-9._-]*\.tex$/i.test(parts[2]!);
  }
  return !parts.some(part => part.startsWith("."));
}

function journalPathFor(manuscriptDir: string): string {
  const root = path.resolve(manuscriptDir);
  const stateDir = path.basename(root).toLowerCase() === "manuscript" ? "openbarry" : ".OpenBar";
  return path.join(root, stateDir, JOURNAL_NAME);
}

export function sourceTransactionJournalPath(manuscriptDir: string): string {
  return journalPathFor(manuscriptDir);
}

function relativeFile(manuscriptDir: string, filePath: string): string {
  const root = path.resolve(manuscriptDir);
  const normalized = filePath.trim().replace(/\\/g, "/");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split("/").includes("..")) {
    throw new Error(`Invalid transaction path "${filePath}".`);
  }
  const absolute = path.resolve(root, normalized);
  if (!isInside(root, absolute)) throw new Error(`Transaction path escapes the manuscript: "${filePath}".`);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (!isAllowedTransactionLocation(relative)) throw new Error(`Transaction path is reserved for project or Git metadata: "${filePath}".`);
  const realRoot = fs.realpathSync.native(root);
  let current = root;
  for (const component of path.relative(root, absolute).split(path.sep)) {
    current = path.join(current, component);
    try {
      fs.lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
    // Validate existing parents even if the final target has not been created.
    // A dangling link cannot be resolved safely and is rejected as well.
    let resolved: string;
    try { resolved = fs.realpathSync.native(current); }
    catch { throw new Error(`Transaction path cannot be resolved safely: "${filePath}".`); }
    if (!isInside(realRoot, resolved)) throw new Error(`Transaction path resolves outside the manuscript: "${filePath}".`);
    const realRelative = path.relative(realRoot, resolved).split(path.sep).join("/");
    if (!isAllowedTransactionLocation(realRelative, current !== absolute)) throw new Error(`Transaction path resolves to project or Git metadata: "${filePath}".`);
  }
  return relative;
}

function validatedWrites(manuscriptDir: string, writes: SourceTransactionWrite[]): SourceTransactionJournal["files"] {
  const seen = new Set<string>();
  let editableSources: Set<string> | undefined;
  return writes.map((write) => {
    if (!write || typeof write !== "object") throw new Error("A transaction file entry must be an object.");
    const filePath = relativeFile(manuscriptDir, write.filePath);
    if (!/\.tex$/i.test(filePath)) {
      editableSources ??= new Set(traverseInputGraph(manuscriptDir).nodes.filter(node => node.editable).map(node => node.filePath));
      const absolute = path.resolve(manuscriptDir, filePath);
      const actual = fs.realpathSync.native(absolute);
      const realRoot = fs.realpathSync.native(path.resolve(manuscriptDir));
      const realRelative = path.relative(realRoot, actual).split(path.sep).join("/");
      if (!editableSources.has(realRelative)) throw new Error(`Transaction path is not an editable manuscript source: "${write.filePath}".`);
    }
    if (seen.has(filePath)) throw new Error(`Transaction lists "${filePath}" more than once.`);
    seen.add(filePath);
    if (write.previous !== null && typeof write.previous !== "string") throw new Error(`Transaction previous bytes for "${filePath}" are invalid.`);
    if (write.next !== null && typeof write.next !== "string") throw new Error(`Transaction next bytes for "${filePath}" are invalid.`);
    return {
      filePath,
      previous: write.previous,
      next: write.next,
      previousHash: write.previous === null ? null : sha256(write.previous),
      nextHash: write.next === null ? null : sha256(write.next),
    };
  });
}

function validatedJournalFiles(manuscriptDir: string, entries: unknown[]): SourceTransactionJournal["files"] {
  const files = validatedWrites(manuscriptDir, entries as SourceTransactionWrite[]);
  return files.map((file, index) => {
    const entry = entries[index];
    if (!entry || typeof entry !== "object") throw new Error("A transaction journal file entry must be an object.");
    const record = entry as Record<string, unknown>;
    if (record.previousHash !== file.previousHash || record.nextHash !== file.nextHash) {
      throw new Error(`Transaction journal hashes do not match stored bytes for "${file.filePath}".`);
    }
    return file;
  });
}

export function writeSourceTransactionJournal(manuscriptDir: string, input: SourceTransactionInput): string {
  const journalPath = journalPathFor(manuscriptDir);
  if (typeof input?.requestId !== "string" || !input.requestId.trim() || input.requestId.length > 200) {
    throw new Error("A source transaction needs a bounded request id.");
  }
  const files = validatedWrites(manuscriptDir, input.writes);
  if (!files.length) throw new Error("A source transaction needs at least one file.");
  const journal: SourceTransactionJournal = {
    version: JOURNAL_VERSION,
    requestId: input.requestId.trim(),
    createdAt: new Date().toISOString(),
    files,
  };
  writeTextAtomic(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return journalPath;
}

function readBytes(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function writeBytes(file: string, value: string | null): void {
  if (value === null) {
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return;
  }
  writeTextAtomic(file, value);
}

function failure(
  journalPath: string,
  code: string,
  message: string,
  affectedPaths: string[],
): SourceTransactionRecovery {
  return {
    ok: false,
    journalPath,
    recovered: false,
    affectedPaths,
    message,
    diagnostics: [{ severity: "error", code, message, ...(affectedPaths.length ? { filePath: affectedPaths[0] } : {}) }],
  };
}

function recoverUnderLock(manuscriptDir: string, journalPath: string): SourceTransactionRecovery {
  if (!fs.existsSync(journalPath)) {
    return { ok: true, journalPath, recovered: false, affectedPaths: [], diagnostics: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  } catch (error) {
    return failure(journalPath, "source_transaction_invalid", `Could not read the source transaction journal: ${error instanceof Error ? error.message : String(error)}`, [path.relative(manuscriptDir, journalPath).split(path.sep).join("/")]);
  }
  if (!parsed || typeof parsed !== "object") return failure(journalPath, "source_transaction_invalid", "The source transaction journal is not an object.", [path.relative(manuscriptDir, journalPath).split(path.sep).join("/")]);
  const record = parsed as Partial<SourceTransactionJournal>;
  if (record.version !== JOURNAL_VERSION || typeof record.requestId !== "string" || !record.requestId.trim() || !Array.isArray(record.files)) {
    return failure(journalPath, "source_transaction_invalid", "The source transaction journal has an unsupported format.", [path.relative(manuscriptDir, journalPath).split(path.sep).join("/")]);
  }
  let files: SourceTransactionWrite[];
  try {
    files = validatedJournalFiles(manuscriptDir, record.files);
  } catch (error) {
    return failure(journalPath, "source_transaction_invalid", `The source transaction journal is unsafe: ${error instanceof Error ? error.message : String(error)}`, [path.relative(manuscriptDir, journalPath).split(path.sep).join("/")]);
  }
  const plan: Array<{ filePath: string; abs: string; previous: string | null }> = [];
  const conflicts: string[] = [];
  for (const file of files) {
    const abs = path.resolve(manuscriptDir, file.filePath);
    const current = readBytes(abs);
    if (current === file.next) plan.push({ filePath: file.filePath, abs, previous: file.previous });
    else if (current !== file.previous) conflicts.push(file.filePath);
  }
  if (conflicts.length) {
    return failure(journalPath, "source_transaction_conflict", `Source transaction recovery found changed files: ${conflicts.join(", ")}.`, conflicts);
  }
  const affected: string[] = [];
  for (const item of plan) {
    try {
      writeBytes(item.abs, item.previous);
    } catch (error) {
      affected.push(item.filePath);
      continue;
    }
  }
  if (affected.length) {
    return failure(journalPath, "source_transaction_recovery_failed", `Source transaction recovery could not restore: ${affected.join(", ")}.`, affected);
  }
  try {
    fs.unlinkSync(journalPath);
  } catch (error) {
    return failure(journalPath, "source_transaction_recovery_failed", `Source transaction recovery restored the files but could not clear its journal: ${error instanceof Error ? error.message : String(error)}`, [path.relative(manuscriptDir, journalPath).split(path.sep).join("/")]);
  }
  return { ok: true, journalPath, recovered: true, affectedPaths: [], diagnostics: [] };
}

export function recoverSourceTransaction(manuscriptDir: string, projectLockHeld = false): SourceTransactionRecovery {
  const journalPath = journalPathFor(manuscriptDir);
  if (!fs.existsSync(journalPath)) {
    return { ok: true, journalPath, recovered: false, affectedPaths: [], diagnostics: [] };
  }
  if (projectLockHeld) return recoverUnderLock(manuscriptDir, journalPath);
  return withProjectWriteLock(manuscriptDir, () => recoverUnderLock(manuscriptDir, journalPath));
}

export function clearSourceTransactionJournal(manuscriptDir: string, projectLockHeld = false): void {
  const journalPath = journalPathFor(manuscriptDir);
  if (!fs.existsSync(journalPath)) return;
  const clear = () => {
    try {
      fs.unlinkSync(journalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
  if (projectLockHeld) clear();
  else withProjectWriteLock(manuscriptDir, clear);
}
