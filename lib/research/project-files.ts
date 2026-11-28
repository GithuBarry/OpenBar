import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { resolveConfinedPath, resolveConfinedRoot } from "@/lib/server/path-policy";
import { sha256, writeTextAtomic } from "@/lib/tex-project/codec";
import { clearSourceTransactionJournal, recoverSourceTransaction, writeSourceTransactionJournal, type SourceTransactionWrite } from "@/lib/tex-project/source-transaction";
import { bibliographyInputWrites, bibliographySourceFiles, bibliographyWrites, readBibliographyRaw, texPaths } from "@/lib/tex-project/project";
import { traverseInputGraph } from "@/lib/tex-project/source-graph";
import { withProjectWriteLock } from "./project-lock";
import { failResult, okResult, type OperationResult } from "./operation-result";
import { paperProseDiagnostics } from "./paper-prose-lint";
import { beginAgentReplyCapture, completeAgentReplyCapture } from "./agent-reply-receipts";
import { APPLY_PROJECT_EDITS_INPUT, READ_PROJECT_FILES_INPUT, isProtectedProjectPath, type ProjectFileEntry, type ProjectFilesEditInput, type ProjectFilesEditReceipt, type ProjectFilesRead, type ProjectFilesReadInput } from "./project-files-contract";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_BYTES = 50 * 1024 * 1024;

class ProjectFileError extends Error {
  constructor(message: string, readonly code = "invalid_path", readonly filePath?: string, readonly currentHash?: string) { super(message); }
}

function rootPath(projectDir: string): string {
  const root = resolveConfinedRoot(projectDir);
  if (!root) throw new ProjectFileError("This project directory is unavailable.");
  return root;
}

/** Resolve existing links and new parents before checking the managed-state boundary. */
function projectPath(root: string, requested: string): { absolute: string; relative: string } {
  if (requested.includes("\0") || path.isAbsolute(requested) || /^[A-Za-z]:/.test(requested)) throw new ProjectFileError("Use a path relative to this project.");
  const absolute = resolveConfinedPath(root, path.resolve(root, requested.replaceAll("\\", "/")), { allowMissing: true });
  if (!absolute) throw new ProjectFileError(`Path "${requested}" must stay inside this project.`, "invalid_path", requested);
  let ancestor = absolute;
  const missing: string[] = [];
  while (!fs.existsSync(ancestor)) { missing.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
  const resolved = path.join(fs.realpathSync.native(ancestor), ...missing);
  const relative = path.relative(root, resolved).split(path.sep).join("/");
  const lexical = path.relative(root, absolute).split(path.sep).join("/");
  if (isProtectedProjectPath(relative) || isProtectedProjectPath(lexical)) throw new ProjectFileError(`OpenBar manages "${requested}" through its state tools.`, "invalid_path", requested);
  return { absolute: resolved, relative: relative || "." };
}

function failure(error: unknown): OperationResult<never> {
  if (error instanceof ProjectFileError) return failResult(error.code, error.message, {
    retryable: error.code === "stale_disk_state",
    ...(error.currentHash ? { currentHash: error.currentHash } : {}),
    ...(error.filePath ? { diagnostics: [{ severity: "error", code: error.code, message: error.message, filePath: error.filePath }] } : {}),
  });
  throw error;
}

/** Directory listings and bounded file bytes share the same project capability. */
export function readProjectFiles(projectDir: string, input: ProjectFilesReadInput): OperationResult<ProjectFilesRead> {
  const parsed = READ_PROJECT_FILES_INPUT.safeParse(input);
  if (!parsed.success) return failResult("invalid_arguments", parsed.error.issues.map(issue => issue.message).join(" "));
  return withProjectWriteLock(projectDir, () => {
    try {
      const root = rootPath(projectDir), entries: ProjectFileEntry[] = [], seen = new Set<string>();
      const recovery = recoverSourceTransaction(texPaths(root).manuscriptDir, true);
      if (!recovery.ok) return failResult("source_transaction_recovery_failed", recovery.message || "Recover the previous file transaction before reading.", { retryable: true, diagnostics: recovery.diagnostics });
      let remaining = parsed.data.maxBytes ?? 100_000, hasMore = false;
      const limit = parsed.data.limit ?? 200;
      const add = (entry: ProjectFileEntry) => {
        if (seen.has(entry.path)) return;
        seen.add(entry.path);
        if (entries.length < limit) entries.push(entry);
        else hasMore = true;
      };
      const requestedPaths = new Map<string, { requested: string; file: ReturnType<typeof projectPath>; stat: fs.Stats }>();
      for (const requested of parsed.data.paths || ["."]) {
        const file = projectPath(root, requested);
        if (!fs.existsSync(file.absolute)) throw new ProjectFileError(`File "${requested}" is missing.`, "invalid_path", requested);
        const stat = fs.statSync(file.absolute);
        requestedPaths.set(file.relative, { requested, file, stat });
      }
      // Reserve the response budget for explicitly requested file contents.
      const requestedEntries = [...requestedPaths.values()];
      for (const { requested, file, stat } of [...requestedEntries.filter(entry => !entry.stat.isDirectory()), ...requestedEntries.filter(entry => entry.stat.isDirectory())]) {
        if (stat.isDirectory()) {
          for (const name of fs.readdirSync(file.absolute).sort()) {
            let child: ReturnType<typeof projectPath>;
            try { child = projectPath(root, path.join(file.relative, name)); }
            catch (error) { if (error instanceof ProjectFileError) continue; throw error; }
            const childStat = fs.statSync(child.absolute);
            if (childStat.isDirectory()) add({ path: child.relative, kind: "directory" });
            else if (childStat.isFile()) add({ path: child.relative, kind: "file", bytes: childStat.size });
          }
        } else if (stat.isFile()) {
          if (stat.size > MAX_FILE_BYTES) throw new ProjectFileError(`Read files up to ${MAX_FILE_BYTES / 1024 / 1024} MiB at a time.`, "invalid_arguments", requested);
          const bytes = fs.readFileSync(file.absolute), offset = Math.min(parsed.data.offset ?? 0, bytes.length);
          const selected = bytes.subarray(offset, offset + remaining);
          let content: string, encoding: "utf8" | "base64";
          try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(selected); encoding = selected.includes(0) ? "base64" : "utf8"; }
          catch { content = ""; encoding = "base64"; }
          if (encoding === "base64") content = selected.toString("base64");
          remaining -= selected.length;
          add({ path: file.relative, kind: "file", bytes: bytes.length, hash: sha256(bytes), content, encoding, offset, truncated: offset + selected.length < bytes.length });
        } else throw new ProjectFileError(`Choose an ordinary file or directory for "${requested}".`, "invalid_path", requested);
      }
      return okResult({ entries, hasMore });
    } catch (error) { return failure(error); }
  });
}

/** Each admitted writer preflights every hash, then uses the existing recovery journal. */
export function applyProjectEdits(projectDir: string, input: ProjectFilesEditInput, actor: "human" | "webmcp" = "human", projectId = path.basename(projectDir)): OperationResult<ProjectFilesEditReceipt> {
  const parsed = APPLY_PROJECT_EDITS_INPUT.safeParse(input);
  if (!parsed.success) return failResult("invalid_arguments", parsed.error.issues.map(issue => issue.message).join(" "));
  return withProjectWriteLock(projectDir, () => {
    try {
      const root = rootPath(projectDir), seen = new Set<string>();
      const paths = texPaths(root);
      const recovery = recoverSourceTransaction(paths.manuscriptDir, true);
      if (!recovery.ok) return failResult("source_transaction_recovery_failed", recovery.message || "Recover the previous file transaction before editing.", { retryable: true, diagnostics: recovery.diagnostics });
      let totalBytes = 0;
      const writes: SourceTransactionWrite[] = [], files: ProjectFilesEditReceipt["files"] = [];
      for (const edit of parsed.data.edits) {
        const target = projectPath(root, edit.path);
        if (target.relative === "." || seen.has(target.relative)) throw new ProjectFileError(`Use each file path once in a batch: "${edit.path}".`, "invalid_arguments", edit.path);
        seen.add(target.relative);
        let previous: Buffer | null = null;
        let previousMode: number | undefined;
        if (fs.existsSync(target.absolute)) {
          const stat = fs.statSync(target.absolute);
          if (!stat.isFile()) throw new ProjectFileError(`Choose an ordinary file for "${edit.path}".`, "invalid_path", edit.path);
          previousMode = stat.mode & 0o777;
          if (stat.size > MAX_FILE_BYTES) throw new ProjectFileError("Edit files up to 20 MiB at a time.", "invalid_arguments", edit.path);
          previous = fs.readFileSync(target.absolute);
        }
        const previousHash = previous === null ? null : sha256(previous);
        if (previousHash !== edit.expectedHash) throw new ProjectFileError(`File "${edit.path}" changed. Read its current hash and retry.`, "stale_disk_state", edit.path, previousHash || undefined);
        if (edit.content === null && previous === null) throw new ProjectFileError(`Choose an existing file to delete: "${edit.path}".`, "invalid_arguments", edit.path);
        let next: Buffer | null = null;
        if (edit.content !== null) {
          if (Buffer.byteLength(edit.content) > MAX_FILE_BYTES * 4 / 3 + 4) throw new ProjectFileError("Edit files up to 20 MiB at a time.", "invalid_arguments", edit.path);
          if (edit.encoding === "base64") {
            const encoded = edit.content.replace(/\s/g, "");
            next = Buffer.from(encoded, "base64");
            if (next.toString("base64") !== encoded) throw new ProjectFileError(`Use valid base64 content for "${edit.path}".`, "invalid_arguments", edit.path);
          } else next = Buffer.from(edit.content, "utf8");
          if (next.length > MAX_FILE_BYTES) throw new ProjectFileError("Edit files up to 20 MiB at a time.", "invalid_arguments", edit.path);
        }
        totalBytes += (previous?.length || 0) + (next?.length || 0);
        if (totalBytes > MAX_BATCH_BYTES) throw new ProjectFileError("Keep a file batch's previous and replacement bytes within 50 MiB.", "invalid_arguments");
        writes.push({ filePath: target.relative, previous: previous?.toString("base64") ?? null, next: next?.toString("base64") ?? null, encoding: "base64", previousMode });
        files.push({ path: target.relative, previousHash, hash: next === null ? null : sha256(next), bytes: next?.length || 0 });
      }
      const sources = new Set(traverseInputGraph(paths.manuscriptDir).nodes.map(node => path.resolve(node.absPath)));
      const refreshReferences = writes.some(write => /\.bib$/i.test(write.filePath) || sources.has(path.join(root, write.filePath)) || path.join(root, write.filePath) === paths.paperFile);
      if (refreshReferences) {
        try { bibliographyInputWrites(root, readBibliographyRaw(root)); }
        catch (error) { throw new ProjectFileError(error instanceof Error ? error.message : "Prepare the generated bibliography before editing.", "conflict"); }
      }
      const proseDiagnostics = actor === "webmcp" || parsed.data.dryRun ? paperProseDiagnostics(writes) : [];
      if (parsed.data.dryRun) return okResult({ files, dryRun: true }, proseDiagnostics.length ? { diagnostics: proseDiagnostics } : {});
      const replyCapture = beginAgentReplyCapture(projectDir, projectId, actor);
      const requestId = randomUUID();
      writeSourceTransactionJournal(root, { requestId, writes, scope: "project" });
      const derivedFiles: string[] = [];
      try {
        for (const write of writes) {
          const file = path.join(root, write.filePath);
          if (write.next === null) fs.unlinkSync(file);
          else writeTextAtomic(file, Buffer.from(write.next, "base64"));
        }
        if (refreshReferences) {
          let planned: ReturnType<typeof bibliographyWrites>;
          try {
            const declared = bibliographySourceFiles(root);
            const rawSources = [path.join(paths.manuscriptDir, "references.bib"), path.join(root, "references.bib")];
            const raw = writes.some(write => /\.bib$/i.test(write.filePath)) && !declared.length && !rawSources.some(file => fs.existsSync(file)) ? "" : readBibliographyRaw(root);
            // File edits retain authored TeX bytes. The export path migrates
            // managed include names while this transaction refreshes derived state.
            planned = bibliographyWrites(root, raw, false).filter(write => isProtectedProjectPath(path.relative(root, write.file)));
          } catch (error) { throw new ProjectFileError(error instanceof Error ? error.message : "Prepare the generated bibliography before editing.", "conflict"); }
          const combined = new Map(writes.map(write => [write.filePath, write]));
          for (const write of planned) {
            const relative = path.relative(root, write.file).split(path.sep).join("/");
            const existing = combined.get(relative);
            const previous = existing ? existing.previous : (fs.existsSync(write.file) ? fs.readFileSync(write.file).toString("base64") : null);
            combined.set(relative, { filePath: relative, previous, next: Buffer.from(write.source).toString("base64"), encoding: "base64", derived: "bibliography" });
            derivedFiles.push(relative);
          }
          writeSourceTransactionJournal(root, { requestId, writes: [...combined.values()], scope: "project" });
          for (const write of planned) writeTextAtomic(write.file, write.source);
          for (const file of files) {
            const content = fs.existsSync(path.join(root, file.path)) ? fs.readFileSync(path.join(root, file.path)) : null;
            file.hash = content === null ? null : sha256(content);
            file.bytes = content?.length || 0;
          }
        }
      } catch (error) {
        const restored = recoverSourceTransaction(paths.manuscriptDir, true);
        if (!restored.ok) return failResult("source_transaction_recovery_failed", restored.message || "Recover this file transaction before editing.", { retryable: true, diagnostics: restored.diagnostics });
        throw error;
      }
      clearSourceTransactionJournal(root, true);
      const warnings = completeAgentReplyCapture(projectDir, projectId, replyCapture);
      return okResult(
        { files, dryRun: false, ...(derivedFiles.length ? { derivedFiles } : {}) },
        {
          ...(warnings.length ? { warnings } : {}),
          ...(proseDiagnostics.length ? { diagnostics: proseDiagnostics } : {}),
        },
      );
    } catch (error) { return failure(error); }
  });
}
