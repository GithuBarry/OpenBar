/**
 * Persist a virtual source-range replacement onto the owning include-graph file.
 */

import fs from "node:fs";
import path from "node:path";

import { failResult, okResult, type OperationResult } from "@/lib/research/operation-result";
import type { SourcePatch } from "@/lib/research/operations";
import { sha256, writeTextAtomic } from "./codec";
import { withProjectWriteLock } from "@/lib/research/project-lock";
import { buildSourceBundle, mapVirtualRange, type SourceBundle } from "./source-bundle";
import { clearSourceTransactionJournal, recoverSourceTransaction, writeSourceTransactionJournal } from "./source-transaction";
import { bannerRanges, fileBanner, fileBytesUnchanged, splitBundleSource } from "./source-bundle-format";

import { beginAgentReplyCapture, completeAgentReplyCapture } from "@/lib/research/agent-reply-receipts";
import { AGENT_MENTION_PATTERN } from "@/lib/research/agent-mentions";

export type PaperInboxWriter = { projectDir: string, actor: "human" | "webmcp" };

/** Watch mention-bearing source or changed includes, after validation and under the paper's write lock. */
function preparePaperInboxUpdate(writer: PaperInboxWriter | undefined, files: Array<{ previous: string, next: string }>) {
  if (!writer || !files.some(({ previous, next }) => AGENT_MENTION_PATTERN.test(previous) || AGENT_MENTION_PATTERN.test(next)
    || /\\(?:input|include)\s*\{/.test(previous) || /\\(?:input|include)\s*\{/.test(next))) return;
  const project = path.basename(writer.projectDir);
  const capture = beginAgentReplyCapture(writer.projectDir, project, writer.actor);
  return () => completeAgentReplyCapture(writer.projectDir, project, capture);
}

export function persistVirtualRange(input: {
  manuscriptDir: string;
  inboxWriter?: PaperInboxWriter;
  from: number;
  to: number;
  text: string;
  expectedBundleHash?: string;
  dryRun?: boolean;
}): OperationResult<{ filePath: string; bundleHash: string; dryRun?: boolean; patches?: SourcePatch[] }> {
  return withProjectWriteLock(input.manuscriptDir, () => {
    const bundle = buildSourceBundle(input.manuscriptDir, undefined, 0, true);
    const recoveryFailure = bundle.diagnostics.find((diagnostic) => diagnostic.code.startsWith("source_transaction_") && diagnostic.severity === "error");
    if (recoveryFailure) {
      return failResult("source_transaction_recovery_failed", recoveryFailure.message, {
        retryable: true,
        currentHash: bundle.bundleHash,
        diagnostics: bundle.diagnostics,
      });
    }
    if (input.expectedBundleHash && bundle.bundleHash !== input.expectedBundleHash) {
      return failResult("stale_disk_state", "Source bundle hash does not match.", {
        retryable: true,
        currentHash: bundle.bundleHash,
        conflict: { currentRevision: bundle.revision, currentHash: bundle.bundleHash, refresh: "reread" },
      });
    }
    const mapped = mapVirtualRange(bundle, input.from, input.to);
    const touchesBanner = bannerRanges(bundle.source).some((range) => (
      input.from === input.to
        ? input.from >= range.from && input.from < range.to
        : input.from < range.to && input.to > range.from
    ));
    if (touchesBanner) {
      return failResult("invalid_tex", "File banners are structural and cannot be edited.", false);
    }
    if (mapped.multiFile) {
      return failResult("multi_file_span", "Replacement spans multiple include-graph files. Use a transaction operation.", false);
    }
    if (!mapped.segment) return failResult("invalid_path", "Range is outside the source bundle.", false);
    if (!mapped.segment.editable) {
      return failResult("invalid_path", `File "${mapped.segment.filePath}" is not an editable OpenBar region.`, false);
    }
    const abs = path.join(input.manuscriptDir, mapped.segment.filePath);
    const current = fs.readFileSync(abs, "utf8");
    if (sha256(current) !== mapped.segment.fileHash) {
      return failResult("stale_disk_state", `File "${mapped.segment.filePath}" changed on disk.`, {
        retryable: true,
        currentHash: sha256(current),
      });
    }
    const next = `${current.slice(0, mapped.fileFrom)}${input.text}${current.slice(mapped.fileTo)}`;
    const patch: SourcePatch = {
      filePath: mapped.segment.filePath,
      from: mapped.fileFrom,
      to: mapped.fileTo,
      next: input.text,
      previous: current.slice(mapped.fileFrom, mapped.fileTo),
    };
    if (input.dryRun) {
      return okResult(
        { filePath: mapped.segment.filePath, bundleHash: bundle.bundleHash, dryRun: true, patches: [patch] },
        { diskHash: bundle.bundleHash, revision: bundle.revision },
      );
    }
    const updateInbox = preparePaperInboxUpdate(input.inboxWriter, [{ previous: current, next }]);
    writeTextAtomic(abs, next);
    updateInbox?.();
    const after = buildSourceBundle(input.manuscriptDir, undefined, 0, true);
    return okResult({ filePath: mapped.segment!.filePath, bundleHash: after.bundleHash }, { diskHash: after.bundleHash, revision: after.revision });
  });
}

export function persistSourceBundle(input: {
  manuscriptDir: string;
  inboxWriter?: PaperInboxWriter;
  nextSource: string;
  expectedBundleHash?: string;
  dryRun?: boolean;
  requestId?: string;
  includeBundle?: boolean;
}): OperationResult<{ bundleHash: string; written: string[]; bundle?: SourceBundle; graphChanged?: boolean; dryRun?: boolean; patches?: SourcePatch[] }> {
  const parts = splitBundleSource(input.nextSource);
  return withProjectWriteLock(input.manuscriptDir, () => {
    const bundle = buildSourceBundle(input.manuscriptDir, undefined, 0, true);
    const recoveryFailure = bundle.diagnostics.find((diagnostic) => diagnostic.code.startsWith("source_transaction_") && diagnostic.severity === "error");
    if (recoveryFailure) {
      return failResult("source_transaction_recovery_failed", recoveryFailure.message, {
        retryable: true,
        currentHash: bundle.bundleHash,
        diagnostics: bundle.diagnostics,
      });
    }
    if (input.expectedBundleHash && bundle.bundleHash !== input.expectedBundleHash) {
      // A previous attempt can have committed even when its response was lost.
      // Acknowledge that exact result while holding the write lock, so retries
      // can safely advance to the current hash without replacing any disk data.
      if (input.nextSource === bundle.source) {
        return okResult(
          { bundleHash: bundle.bundleHash, written: [], ...(input.includeBundle ? { bundle, graphChanged: true } : {}), ...(input.dryRun ? { dryRun: true as const, patches: [] } : {}) },
          { diskHash: bundle.bundleHash, revision: bundle.revision },
        );
      }
      return failResult("stale_disk_state", "Source bundle hash does not match.", {
        retryable: true,
        currentHash: bundle.bundleHash,
        conflict: { currentRevision: bundle.revision, currentHash: bundle.bundleHash, refresh: "reread" },
      });
    }
    if (parts.length !== bundle.segments.length) {
      return failResult(
        "invalid_tex",
        "File banners were added or removed. Restore the include-graph banners before saving.",
        false,
      );
    }
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      const expectedBanner = fileBanner(part.filePath);
      if (part.bannerFrom !== (index === 0 ? 0 : parts[index - 1]!.bodyTo) || input.nextSource.slice(part.bannerFrom, part.bodyFrom) !== expectedBanner) {
        return failResult("invalid_tex", "File banners are structural and cannot be edited.", false);
      }
      if (parts[index]!.filePath !== bundle.segments[index]!.filePath) {
        return failResult("invalid_tex", "File banner order does not match the include graph.", false);
      }
    }
    const writes: Array<{ abs: string; next: string; filePath: string; previous: string }> = [];
    const liveBodies = new Map<string, string>();
    for (let index = 0; index < parts.length; index += 1) {
      const segment = bundle.segments[index]!;
      const liveBody = parts[index]!.body;
      const priorBody = liveBodies.get(segment.filePath);
      if (priorBody !== undefined) {
        if (priorBody !== liveBody) {
          return failResult(
            "invalid_tex",
            `Repeated source occurrences for "${segment.filePath}" must contain the same text before saving.`,
            false,
          );
        }
        continue;
      }
      liveBodies.set(segment.filePath, liveBody);
      const abs = path.join(input.manuscriptDir, segment.filePath);
      const disk = fs.readFileSync(abs, "utf8");
      if (fileBytesUnchanged(disk, liveBody)) continue;
      if (!segment.editable) {
        return failResult("invalid_path", `File "${segment.filePath}" is read-only in the source bundle.`, false);
      }
      if (sha256(disk) !== segment.fileHash) {
        return failResult("stale_disk_state", `File "${segment.filePath}" changed on disk.`, {
          retryable: true,
          currentHash: sha256(disk),
        });
      }
      writes.push({ abs, next: liveBody, filePath: segment.filePath, previous: disk });
    }
    if (!writes.length) {
      return okResult(
        { bundleHash: bundle.bundleHash, written: [], ...(input.includeBundle ? { bundle } : {}), ...(input.dryRun ? { dryRun: true as const, patches: [] } : {}) },
        { diskHash: bundle.bundleHash, revision: bundle.revision },
      );
    }
    if (input.dryRun) {
      return okResult(
        {
          bundleHash: bundle.bundleHash,
          written: writes.map((item) => item.filePath),
          dryRun: true,
          patches: writes.map((write) => ({
            filePath: write.filePath,
            from: 0,
            to: write.previous.length,
            next: write.next,
            previous: write.previous,
          })),
        },
        { diskHash: bundle.bundleHash, revision: bundle.revision },
      );
    }
    const updateInbox = preparePaperInboxUpdate(input.inboxWriter, writes);
    const committed: typeof writes = [];
    try {
      writeSourceTransactionJournal(input.manuscriptDir, {
        requestId: input.requestId || `source-${process.pid}-${Date.now()}`,
        writes: writes.map(({ filePath, previous, next }) => ({ filePath, previous, next })),
      });
      for (const write of writes) {
        writeTextAtomic(write.abs, write.next);
        committed.push(write);
      }
    } catch (error) {
      const recovery = recoverSourceTransaction(input.manuscriptDir, true);
      if (!recovery.ok) {
        const affected = [...new Set([...committed.map((write) => write.filePath), ...recovery.affectedPaths])];
        throw new Error(`Source batch write failed: ${error instanceof Error ? error.message : String(error)} Recovery failed for: ${affected.join(", ") || "the transaction journal"}.`);
      }
      throw error;
    }
    clearSourceTransactionJournal(input.manuscriptDir, true);
    updateInbox?.();
    const after = buildSourceBundle(input.manuscriptDir, undefined, 0, true);
    const graphChanged = bundle.segments.length !== after.segments.length
      || bundle.segments.some((segment, index) => segment.filePath !== after.segments[index]?.filePath);
    return okResult(
      { bundleHash: after.bundleHash, written: writes.map((item) => item.filePath), ...(input.includeBundle ? { bundle: after, graphChanged } : {}) },
      { diskHash: after.bundleHash, revision: after.revision },
    );
  });
}
