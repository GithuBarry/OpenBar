/**
 * Coordinated local conversion of an authored mindmap card into a TeX TODO.
 * Remote Git synchronization is intentionally outside this module.
 */

import fs from "node:fs";
import path from "node:path";

import { applyMindmapAction } from "@/features/mindmap/mindmap-state";
import { assertUniqueMindmapTodoIds } from "@/lib/mindmap-index";
import { mindmapDiskHash, normalizeMindmap } from "@/lib/mindmap/mindmap";
import type { Mindmap } from "@/lib/types";
import { ordinaryMindmapCardContent } from "./todo-map";
import { requestFingerprint, readRequestReplay, recordRequestReplay, RequestReplayStoreError } from "./request-replay";
import { failResult, type OperationResult } from "./operation-result";
import { insertTodoAtSection } from "./paper-todo-persist";
import { buildSourceBundle } from "@/lib/tex-project/source-bundle";
import { fileBytesUnchanged, splitBundleSource } from "@/lib/tex-project/source-bundle-format";
import { buildSourceContextIndex } from "@/lib/research/source-context";
import { canonicalizeArtifactRef, type PaperSectionRefTarget } from "@/lib/research/artifact-link";
import {
  DRAFT_MINDMAP_ID,
  resolveMindmapStorageIdentity,
  serializeMindmapRecord,
  readMindmapRecord,
  texPaths,
} from "@/lib/tex-project/project";
import { sha256, writeTextAtomic } from "@/lib/tex-project/codec";
import { withProjectWriteLockAsync } from "@/lib/research/project-lock";
import { clearSourceTransactionJournal, recoverSourceTransaction, writeSourceTransactionJournal } from "@/lib/tex-project/source-transaction";

export type ConversionLocalStatus = {
  paper: "saved" | "failed";
  map: "saved" | "failed" | "not_attempted";
  message?: string;
};

export type MindmapTodoConversionLocal = {
  todoId: string;
  mindmap: Mindmap;
  local: ConversionLocalStatus;
  sectionId?: string;
  file?: string;
  sourceHash?: string;
};

export type MindmapTodoConversionServiceResult = OperationResult<MindmapTodoConversionLocal>;

export type MindmapTodoConversionInput = {
  projectDir: string;
  slug: string;
  mindmap: Mindmap;
  cardId: string;
  sectionId?: string;
  expectedMapDiskHash?: string;
  expectedBundleHash?: string;
  requestId?: string;
  /** The MCP idempotent-write wrapper owns replay persistence for this call. */
  replayOwner?: "service" | "caller";
  replayFingerprint?: string;
};

type ConversionFailure = OperationResult<never>;

function requestIdFor(input: MindmapTodoConversionInput): string {
  return input.requestId?.trim() || `convert-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function relativePath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function conversionFailure(code: string, message: string, retryable = false, currentHash?: string): ConversionFailure {
  return {
    ok: false,
    code,
    message,
    retryable,
    ...(currentHash ? { currentHash } : {}),
    diagnostics: [{ severity: "error", code, message }],
  };
}

function fileWritesForInsertedBundle(
  manuscriptDir: string,
  bundle: ReturnType<typeof buildSourceBundle>,
  nextSource: string,
): Array<{ filePath: string; previous: string | null; next: string }> {
  const parts = splitBundleSource(nextSource);
  if (parts.length !== bundle.segments.length) throw new Error("The source bundle shape changed during TODO conversion.");
  const writes: Array<{ filePath: string; previous: string | null; next: string }> = [];
  const seen = new Set<string>();
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    const segment = bundle.segments[index]!;
    if (part.filePath !== segment.filePath) throw new Error(`The source bundle file order changed at ${part.filePath}.`);
    if (seen.has(part.filePath)) continue;
    seen.add(part.filePath);
    const absolute = path.join(manuscriptDir, part.filePath);
    const previous = fs.readFileSync(absolute, "utf8");
    if (fileBytesUnchanged(previous, part.body)) continue;
    if (!segment.editable) throw new Error(`File "${part.filePath}" is not editable.`);
    if (sha256(previous) !== segment.fileHash) throw new Error(`File "${part.filePath}" changed during TODO conversion.`);
    writes.push({ filePath: part.filePath, previous, next: part.body });
  }
  return writes;
}

function currentMap(projectDir: string, id: string): Mindmap | null {
  const record = readMindmapRecord(projectDir, id);
  return record ? normalizeMindmap(record) : null;
}

function sectionRefTargets(bundle: ReturnType<typeof buildSourceBundle>, manuscriptDir: string): PaperSectionRefTarget[] {
  const context = buildSourceContextIndex(manuscriptDir, bundle.rootFile, bundle);
  return context.sections.map((section) => ({
    id: section.id,
    title: section.title,
    level: section.level,
    ...(section.label ? { label: section.label } : {}),
    file: section.file,
    order: section.order,
    headingPath: section.headingPath,
    bodyHash: section.bodyHash,
    sourceHash: section.sourceHash,
    sourceRange: section.sourceRange,
  }));
}

function success(
  todoId: string,
  map: Mindmap,
  sectionId?: string,
  file?: string,
  sourceHash?: string,
): MindmapTodoConversionServiceResult {
  return {
    ok: true,
    value: {
      todoId,
      mindmap: { ...map, diskHash: mindmapDiskHash(map) },
      local: { paper: "saved", map: "saved" },
      ...(sectionId ? { sectionId } : {}),
      ...(file ? { file } : {}),
      ...(sourceHash ? { sourceHash } : {}),
    },
    revision: map.revision,
    diskHash: mindmapDiskHash(map),
  };
}

export async function convertMindmapCardToTodo(input: MindmapTodoConversionInput): Promise<MindmapTodoConversionServiceResult> {
  const paths = texPaths(input.projectDir);
  const mapId = input.mindmap.id || DRAFT_MINDMAP_ID;
  const requestId = requestIdFor(input);
  const sectionId = input.sectionId?.trim() || undefined;
  const submittedIdentity = resolveMindmapStorageIdentity(input.projectDir, mapId);
  if (input.mindmap.role && input.mindmap.role !== submittedIdentity.role) {
    return conversionFailure(
      "map_identity_conflict",
      `Mindmap "${submittedIdentity.id}" declares role "${input.mindmap.role}" but its storage role is "${submittedIdentity.role}".`,
      false,
    );
  }
  const ownsReplay = input.replayOwner !== "caller";
  const fingerprint = input.replayFingerprint || requestFingerprint({
    operation: "convert_card_to_todo",
    slug: input.slug,
    mapId,
    cardId: input.cardId,
    ...(sectionId ? { sectionId } : {}),
  });
  // A conversion edits the paper and one map in one transaction. The project
  // lock gives both resources one ordering boundary and prevents deadlocks
  // between concurrent paper, map, and conversion saves.
  return withProjectWriteLockAsync(input.projectDir, async () => {
    const map = currentMap(input.projectDir, mapId);
    if (!map) return conversionFailure("unknown_map", `Unknown mindmap "${mapId}".`);
    if (ownsReplay) {
      let replay: ReturnType<typeof readRequestReplay>;
      try {
        replay = readRequestReplay(input.projectDir, requestId);
      } catch (error) {
        if (error instanceof RequestReplayStoreError) return conversionFailure("request_replay_recovery_pending", error.message, true);
        throw error;
      }
      if (replay) {
        if (replay.operation !== "convert_card_to_todo" || replay.fingerprint !== fingerprint) {
          return conversionFailure("request_conflict", `Request id "${requestId}" was already used for another operation.`);
        }
        const replayTodoId = typeof replay.result.todoId === "string" ? replay.result.todoId : "";
        const replayNode = map.nodes.find((node) => node.id === input.cardId);
        if (replayTodoId && replayNode?.todoId === replayTodoId) return success(replayTodoId, map, sectionId);
      }
    }
    const currentMapDiskHash = mindmapDiskHash(map);
    if (input.expectedMapDiskHash && currentMapDiskHash !== input.expectedMapDiskHash) {
      return conversionFailure("stale_disk_state", "The mindmap changed on disk. Reload before converting this card.", true, currentMapDiskHash);
    }
    const node = map.nodes.find((item) => item.id === input.cardId);
    if (!node) return conversionFailure("unknown_card", `Unknown mindmap card "${input.cardId}".`);
    if (node.todoId?.trim()) return success(node.todoId.trim(), map, sectionId);
    const content = ordinaryMindmapCardContent(node);
    const title = content.title.trim();
    const text = content.body.trim();
    if (!title && !text) return conversionFailure("invalid_arguments", "The card needs a title or details before it can become a TODO.");

    const bundle = buildSourceBundle(paths.manuscriptDir, undefined, 0, true);
    if (input.expectedBundleHash && bundle.bundleHash !== input.expectedBundleHash) {
      return conversionFailure("stale_disk_state", "The paper changed on disk. Reload before converting this card.", true, bundle.bundleHash);
    }
    const textFormat = node.contentFormat === "tex" ? "tex" : "plain";
    const inserted = insertTodoAtSection(bundle.source, sectionId, text, undefined, title || undefined, textFormat);
    if (!inserted.sectionFound) return conversionFailure(sectionId ? "unknown_section" : "invalid_tex", inserted.error || "The paper has no writable source location.");
    if (inserted.error) return conversionFailure("invalid_tex", inserted.error);

    const bound = applyMindmapAction(map, { type: "bind-todo", id: input.cardId, todoId: inserted.id }).mindmap;
    const sections = sectionRefTargets(bundle, paths.manuscriptDir);
    const normalizedNextMap = normalizeMindmap({
      ...bound,
      projectId: input.slug,
      revision: (map.revision ?? 0) + 1,
    });
    const nextMap = {
      ...normalizedNextMap,
      nodes: normalizedNextMap.nodes.map((node) => ({
        ...node,
        ...(node.refs ? { refs: node.refs.map((ref) => canonicalizeArtifactRef(ref, sections)) } : {}),
      })),
    } satisfies Mindmap;
    assertUniqueMindmapTodoIds(nextMap);
    const encoded = serializeMindmapRecord(input.projectDir, nextMap);
    const mapFilePath = relativePath(paths.manuscriptDir, encoded.identity.file);
    const mapPrevious = fs.existsSync(encoded.identity.file) ? fs.readFileSync(encoded.identity.file, "utf8") : null;
    const writes = fileWritesForInsertedBundle(paths.manuscriptDir, bundle, inserted.source);
    writes.push({ filePath: mapFilePath, previous: mapPrevious, next: encoded.source });

    try {
      writeSourceTransactionJournal(paths.manuscriptDir, {
        requestId,
        writes: writes.map((write) => ({ filePath: write.filePath, previous: write.previous, next: write.next })),
      });
      for (const write of writes) writeTextAtomic(path.join(paths.manuscriptDir, write.filePath), write.next);
      clearSourceTransactionJournal(paths.manuscriptDir, true);
    } catch (error) {
      const recovery = recoverSourceTransaction(paths.manuscriptDir, true);
      const affected = [...new Set([...writes.map((write) => write.filePath), ...recovery.affectedPaths])];
      return conversionFailure(
        recovery.ok ? "local_save_failed" : "source_transaction_recovery_failed",
        recovery.ok
          ? `Could not save the paper and mindmap locally: ${error instanceof Error ? error.message : String(error)}`
          : `Local save failed and recovery needs attention for: ${affected.join(", ")}.`,
        true,
      );
    }

    if (ownsReplay) {
      try {
        // The conversion holds the project lock while committing the paper and
        // map. Replay metadata uses its own lock path, so this is a distinct
        // lock acquisition rather than a reentrant project-lock attempt.
        recordRequestReplay(input.projectDir, {
          requestId,
          operation: "convert_card_to_todo",
          fingerprint,
          result: { todoId: inserted.id, mapId, cardId: input.cardId, ...(inserted.sectionId ? { sectionId: inserted.sectionId } : {}) },
        });
      } catch {
        // The source transaction is already durable. A later retry still sees
        // the bound card and remains idempotent while replay metadata recovers.
      }
    }
    const after = buildSourceBundle(paths.manuscriptDir, undefined, 0, true);
    return success(inserted.id, nextMap, inserted.sectionId, mapFilePath, after.bundleHash);
  });
}
