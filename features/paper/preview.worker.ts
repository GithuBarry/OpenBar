/// <reference lib="webworker" />

import type { BibEntry } from "@/lib/bibtex";
import { renderPreviewDocument, type PreviewResult } from "@/lib/tex-project/preview-html";
import { inlineBundleIncludes } from "@/lib/tex-project/source-bundle-format";
import { countPaperWords } from "./paper-stats";

export type PreviewChange = { from: number; to: number; insert: string };
export type PreviewBatch = {
  baseRevision: number;
  revision: number;
  changes: PreviewChange[];
  length: number;
};

export type PreviewWorkerIn =
  | {
    type: "reset";
    generation: number;
    revision: number;
    source: string;
    bibliography?: BibEntry[];
    assetBaseUrl?: string;
  }
  | {
    type: "changes";
    generation: number;
    batches: PreviewBatch[];
  };

export type PaperPreviewResult = PreviewResult & { wordCount: number };

export type PreviewWorkerOut = {
  type: "result" | "desync";
  generation: number;
  revision: number;
  result?: PaperPreviewResult;
};

let source = "";
let bibliography: BibEntry[] | undefined;
let assetBaseUrl: string | undefined;
let generation = 0;
let latestRevision = 0;
let rendering = false;

function applyChanges(changes: PreviewChange[]): boolean {
  // CodeMirror reports all ranges against the transaction's start document.
  // Applying from the end keeps earlier coordinates stable.  This also makes
  // multi-range replace transactions deterministic when the inserted text has
  // the same length as the replaced text (a length check alone cannot detect
  // the corruption).
  const ordered = [...changes].sort((a, b) => b.from - a.from);
  let nextLowerBound = source.length;
  for (const change of ordered) {
    if (
      !Number.isInteger(change.from)
      || !Number.isInteger(change.to)
      || change.from < 0
      || change.to < change.from
      || change.to > source.length
      || change.to > nextLowerBound
    ) return false;
    source = `${source.slice(0, change.from)}${change.insert}${source.slice(change.to)}`;
    nextLowerBound = change.from;
  }
  return true;
}

function pump(): void {
  if (rendering) return;
  rendering = true;
  const revision = latestRevision;
  const snapshot = source;
  const result = { ...renderPreviewDocument(snapshot, { bibliography, assetBaseUrl }), wordCount: countPaperWords(inlineBundleIncludes(snapshot)) };
  // Publish this completed snapshot even when another edit is queued. The
  // next message will schedule a newer render; withholding every result
  // during continuous typing makes the preview appear frozen indefinitely.
  const response: PreviewWorkerOut = { type: "result", generation, revision, result };
  self.postMessage(response);
  rendering = false;
}

self.onmessage = (event: MessageEvent<PreviewWorkerIn>) => {
  const message = event.data;
  if (!message || typeof message !== "object") return;
  if (message.type === "reset") {
    if (message.generation < generation) return;
    source = message.source;
    bibliography = message.bibliography;
    assetBaseUrl = message.assetBaseUrl;
    generation = message.generation;
    latestRevision = message.revision;
    pump();
    return;
  }
  if (message.type === "changes") {
    if (message.generation !== generation || !message.batches.length) {
      self.postMessage({ type: "desync", generation: message.generation, revision: latestRevision } satisfies PreviewWorkerOut);
      return;
    }
    for (const batch of message.batches) {
      // Every batch addresses one transaction-start document. Never flatten
      // batches: later ranges are relative to the document produced by the
      // preceding batch.
      if (
        batch.baseRevision !== latestRevision
        || batch.revision !== latestRevision + 1
        || !applyChanges(batch.changes)
        || source.length !== batch.length
      ) {
        self.postMessage({ type: "desync", generation: message.generation, revision: batch.revision } satisfies PreviewWorkerOut);
        return;
      }
      latestRevision = batch.revision;
    }
    pump();
  }
};
