/**
 * Persist a virtual source-range replacement onto the owning include-graph file.
 */

import fs from "node:fs";
import path from "node:path";

import { failResult, okResult, type OperationResult } from "@/lib/research/operation-result";
import type { SourcePatch } from "@/lib/research/operations";
import { sha256, withWriteLock, withWriteLockAsync, writeTextAtomic } from "./codec";
import { expandProjectForConversion } from "./latexpand";
import { conversionSourceHash, manuscriptFilePath } from "./pandoc";
import { buildSourceBundle, mapVirtualRange } from "./source-bundle";
import { bannerRanges, fileBanner, fileBytesUnchanged, splitBundleSource } from "./source-bundle-format";

export function persistVirtualRange(input: {
  manuscriptDir: string;
  from: number;
  to: number;
  text: string;
  expectedBundleHash?: string;
  dryRun?: boolean;
}): OperationResult<{ filePath: string; bundleHash: string; dryRun?: boolean; patches?: SourcePatch[] }> {
  const initial = buildSourceBundle(input.manuscriptDir);
  const lockTarget = path.resolve(input.manuscriptDir, initial.rootFile || "paper.tex");
  return withWriteLock(lockTarget, () => {
    const bundle = buildSourceBundle(input.manuscriptDir);
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
    writeTextAtomic(abs, next);
    const after = buildSourceBundle(input.manuscriptDir);
    return okResult({ filePath: mapped.segment!.filePath, bundleHash: after.bundleHash }, { diskHash: after.bundleHash, revision: after.revision });
  });
}

export function persistSourceBundle(input: {
  manuscriptDir: string;
  nextSource: string;
  expectedBundleHash?: string;
  dryRun?: boolean;
}): OperationResult<{ bundleHash: string; written: string[]; dryRun?: boolean; patches?: SourcePatch[] }> {
  const parts = splitBundleSource(input.nextSource);
  const initial = buildSourceBundle(input.manuscriptDir);
  const lockTarget = path.resolve(input.manuscriptDir, initial.rootFile || "paper.tex");
  return withWriteLock(lockTarget, () => {
    const bundle = buildSourceBundle(input.manuscriptDir);
    if (input.expectedBundleHash && bundle.bundleHash !== input.expectedBundleHash) {
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
        { bundleHash: bundle.bundleHash, written: [], ...(input.dryRun ? { dryRun: true as const, patches: [] } : {}) },
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
    const committed: typeof writes = [];
    try {
      for (const write of writes) {
        writeTextAtomic(write.abs, write.next);
        committed.push(write);
      }
    } catch (error) {
      for (const write of committed.reverse()) {
        try {
          writeTextAtomic(write.abs, write.previous);
        } catch {
          // Keep the original failure visible. The operation remains under
          // the same lock so a later recovery pass sees a stable file set.
        }
      }
      throw error;
    }
    const after = buildSourceBundle(input.manuscriptDir);
    return okResult(
      { bundleHash: after.bundleHash, written: writes.map((item) => item.filePath) },
      { diskHash: after.bundleHash, revision: after.revision },
    );
  });
}

export async function applyConversionWrite(input: {
  manuscriptDir: string;
  filePath: string;
  output: string;
  loss: "none" | "partial" | "unsupported";
  acknowledgeLoss: boolean;
  expectedSourceFileHash?: string;
  expectedSourceBundleHash?: string;
  expectedExpandedSourceHash?: string;
  expandProject?: boolean;
  dryRun?: boolean;
}): Promise<OperationResult<{ written: string; dryRun?: boolean }>> {
  if (input.loss !== "none" && !input.acknowledgeLoss) {
    return failResult("conversion_loss", "Conversion reported loss. Pass acknowledgeLoss=true to apply.", false);
  }
  const rel = input.filePath.replace(/\\/g, "/");
  const source = manuscriptFilePath(input.manuscriptDir, rel);
  if (!source.ok) return failResult("invalid_path", source.message, false);
  const output = manuscriptFilePath(input.manuscriptDir, `${rel}.converted.html`);
  if (!output.ok) return failResult("invalid_path", output.message, false);
  const root = fs.realpathSync.native(path.resolve(input.manuscriptDir));
  const initialBundle = buildSourceBundle(input.manuscriptDir);
  const lockTarget = path.resolve(input.manuscriptDir, initialBundle.rootFile || rel);
  return withWriteLockAsync(lockTarget, async () => {
    const sourceAtLock = manuscriptFilePath(input.manuscriptDir, rel);
    if (!sourceAtLock.ok) return failResult("invalid_path", sourceAtLock.message, false);
    const outputAtLock = manuscriptFilePath(input.manuscriptDir, `${rel}.converted.html`);
    if (!outputAtLock.ok) return failResult("invalid_path", outputAtLock.message, false);
    if (!fs.existsSync(sourceAtLock.abs)) {
      return failResult("stale_disk_state", `Conversion source "${rel}" is missing.`, { retryable: true });
    }
    const written = path.relative(root, outputAtLock.abs).split(path.sep).join("/");
    if (input.expectedSourceFileHash) {
      let currentHash: string;
      try {
        currentHash = sha256(fs.readFileSync(sourceAtLock.abs));
      } catch {
        return failResult("stale_disk_state", `Conversion source "${rel}" is missing.`, { retryable: true });
      }
      if (currentHash !== input.expectedSourceFileHash) {
        return failResult("stale_disk_state", `Conversion source "${rel}" changed after preview.`, {
          retryable: true,
          currentHash,
        });
      }
    }
    if (input.expectedSourceBundleHash) {
      const currentHash = buildSourceBundle(input.manuscriptDir).bundleHash;
      if (currentHash !== input.expectedSourceBundleHash) {
        return failResult("stale_disk_state", "The source bundle changed after preview.", {
          retryable: true,
          currentHash,
        });
      }
    }
    if (input.expandProject && input.expectedExpandedSourceHash) {
      const expansion = await expandProjectForConversion(input.manuscriptDir);
      const currentHash = conversionSourceHash(expansion.source);
      if (currentHash !== input.expectedExpandedSourceHash) {
        return failResult("stale_disk_state", "The expanded manuscript changed after preview.", {
          retryable: true,
          currentHash,
          diagnostics: expansion.diagnostics,
        });
      }
    }
    if (input.dryRun) return okResult({ written, dryRun: true });
    fs.mkdirSync(path.dirname(outputAtLock.abs), { recursive: true });
    writeTextAtomic(outputAtLock.abs, input.output);
    return okResult({ written });
  });
}
