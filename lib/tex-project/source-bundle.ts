/**
 * Continuous virtual source built from the real include graph.
 */

import { createHash } from "node:crypto";

import { fileBanner } from "./source-bundle-format";
import { recoverSourceTransaction } from "./source-transaction";
import { traverseInputGraph, type GraphNode, type SourceDiagnostic } from "./source-graph";

export type { ClientSourceBundle, ClientSourceSegment } from "./source-bundle-format";
export { fileBanner, splitBundleSource, bannerRanges, fileBytesUnchanged } from "./source-bundle-format";

export type VirtualSourceSegment = {
  id: string;
  filePath: string;
  virtualFrom: number;
  virtualTo: number;
  fileFrom: number;
  fileTo: number;
  fileHash: string;
  editable: boolean;
};

export type SourceBundle = {
  rootFile: string;
  source: string;
  revision: number;
  bundleHash: string;
  segments: VirtualSourceSegment[];
  diagnostics: SourceDiagnostic[];
};

export function buildSourceBundle(manuscriptDir: string, rootFile?: string, revision = 0, projectLockHeld = false): SourceBundle {
  const recovery = recoverSourceTransaction(manuscriptDir, projectLockHeld);
  const graph = traverseInputGraph(manuscriptDir, rootFile);
  const parts: string[] = [];
  const segments: VirtualSourceSegment[] = [];
  let cursor = 0;
  const occurrenceNodes = graph.occurrences.length ? graph.occurrences : graph.nodes;
  const occurrenceCounts = new Map<string, number>();
  for (const node of occurrenceNodes) {
    const banner = fileBanner(node.filePath);
    const chunk = `${banner}${node.source.replace(/\n?$/, "\n")}`;
    const virtualFrom = cursor;
    const virtualTo = cursor + chunk.length;
    const occurrence = (occurrenceCounts.get(node.filePath) || 0) + 1;
    occurrenceCounts.set(node.filePath, occurrence);
    segments.push({
      id: occurrence === 1 ? node.id : `${node.id}#occurrence-${occurrence}`,
      filePath: node.filePath,
      virtualFrom,
      virtualTo,
      fileFrom: banner.length,
      fileTo: banner.length + node.source.length,
      fileHash: node.hash,
      editable: node.editable,
    });
    parts.push(chunk);
    cursor = virtualTo;
  }
  const source = parts.join("");
  return {
    rootFile: graph.rootFile,
    source,
    revision,
    bundleHash: createHash("sha256").update(source).digest("hex"),
    segments,
    diagnostics: [...recovery.diagnostics, ...graph.diagnostics],
  };
}

export function locateVirtualOffset(bundle: SourceBundle, virtualOffset: number): VirtualSourceSegment | undefined {
  if (!Number.isInteger(virtualOffset) || virtualOffset < 0 || virtualOffset > bundle.source.length) return undefined;
  return bundle.segments.find((segment) => virtualOffset >= segment.virtualFrom && virtualOffset < segment.virtualTo)
    || (virtualOffset === bundle.source.length ? bundle.segments.at(-1) : undefined);
}

export function virtualToFileOffset(segment: VirtualSourceSegment, virtualOffset: number): number {
  const bodyLength = Math.max(0, segment.fileTo - segment.fileFrom);
  return Math.min(bodyLength, Math.max(0, virtualOffset - segment.virtualFrom - segment.fileFrom));
}

export function mapVirtualRange(bundle: SourceBundle, from: number, to: number): {
  segment?: VirtualSourceSegment;
  fileFrom: number;
  fileTo: number;
  multiFile: boolean;
} {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > bundle.source.length) {
    return { multiFile: false, fileFrom: 0, fileTo: 0 };
  }
  if (from === to && from === bundle.source.length && !bundle.segments.length) {
    return { multiFile: false, fileFrom: 0, fileTo: 0 };
  }
  const start = locateVirtualOffset(bundle, from);
  const end = locateVirtualOffset(bundle, to > from ? to - 1 : from);
  if (!start || !end) return { multiFile: false, fileFrom: 0, fileTo: 0 };
  if (start.id !== end.id) return { segment: start, fileFrom: 0, fileTo: 0, multiFile: true };
  return {
    segment: start,
    fileFrom: virtualToFileOffset(start, from),
    fileTo: virtualToFileOffset(start, to),
    multiFile: false,
  };
}

export function owningFiles(nodes: GraphNode[]): string[] {
  return nodes.map((node) => node.filePath);
}
