import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import { ASSET_ROOTS, normalizeAssetRequest } from "./asset-resolver";

/**
 * OpenBar's TeX envelope codec.
 *
 * Structured records use JSON comments. Supporting documents can hold marked
 * TeX bodies or adjacent Markdown and HTML files. Paper sections are derived
 * directly from LaTeX by section-ranges.ts.
 */

/** Leading alnum, then alnum / `.` / `_` / `-`. Shared by envelope ids, labels, and figure names. */
export const FILE_SEGMENT = "[A-Za-z0-9][A-Za-z0-9._-]*";
const FILE_SEGMENT_RE = new RegExp(`^${FILE_SEGMENT}$`);

const DATA_BEGIN = /^%\s*OB-DATA-BEGIN\s+([^\s]+)\s+id=([^\s]+)\s*$/;
const DATA_END = /^%\s*OB-DATA-END\s+id=([^\s]+)\s*$/;
const EDIT_BEGIN = /^%\s*OB-EDIT-BEGIN\s+([^\s]+)\s+id=([^\s]+)\s*$/;
const EDIT_END = /^%\s*OB-EDIT-END\s+id=([^\s]+)\s*$/;

export interface DataBlock<T = unknown> {
  schema: string;
  id: string;
  data: T;
  start: number;
  end: number;
}

export interface EditBlock {
  schema: string;
  id: string;
  body: string;
  start: number;
  bodyStart: number;
  bodyEnd: number;
  end: number;
  hash: string;
}

export interface SectionMeta {
  id: string;
  title: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  order: number;
  label: string;
  /** Marks the first section in the LaTeX appendix. */
  appendix?: boolean;
}

export class TexEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TexEnvelopeError";
  }
}

const WRITE_LOCK_STALE_MS = 120_000;
const WRITE_LOCK_UPDATE_MS = 60_000;
const WRITE_LOCK_RETRIES = { retries: 40, minTimeout: 20, maxTimeout: 200 };

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  return starts;
}

function linesWithOffsets(source: string) {
  const starts = lineStarts(source);
  const lines = source.split(/\n/);
  return lines.map((line, index) => ({
    line: line.endsWith("\r") ? line.slice(0, -1) : line,
    start: starts[index] ?? source.length,
    end: index + 1 < starts.length ? starts[index + 1]! : source.length,
  }));
}

/** Read every `% OB-DATA` block. Reject malformed/nested envelopes loudly. */
export function parseDataBlocks(source: string): DataBlock[] {
  const blocks: DataBlock[] = [];
  let open: { schema: string; id: string; start: number; lines: string[] } | null = null;

  for (const entry of linesWithOffsets(source)) {
    const begin = entry.line.match(DATA_BEGIN);
    const end = entry.line.match(DATA_END);
    if (begin) {
      if (open) throw new TexEnvelopeError(`Nested OB-DATA block "${begin[2]}" is not allowed.`);
      open = { schema: begin[1]!, id: safeFileSegment(begin[2]!, "envelope id"), start: entry.start, lines: [] };
      continue;
    }
    if (end) {
      const endId = safeFileSegment(end[1]!, "envelope id");
      if (!open) throw new TexEnvelopeError(`OB-DATA block "${endId}" has no begin marker.`);
      if (endId !== open.id) throw new TexEnvelopeError(`OB-DATA end id "${endId}" does not match "${open.id}".`);
      const payload = open.lines.map((line) => {
        const match = line.match(/^% ?(.*)$/);
        if (!match) throw new TexEnvelopeError(`OB-DATA "${open!.id}" contains a non-comment line.`);
        return match[1]!;
      }).join("\n");
      let data: unknown;
      try {
        data = JSON.parse(payload);
      } catch (error) {
        throw new TexEnvelopeError(`OB-DATA "${open.id}" has invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
      blocks.push({ schema: open.schema, id: open.id, data, start: open.start, end: entry.end });
      open = null;
      continue;
    }
    if (open) open.lines.push(entry.line);
  }
  if (open) throw new TexEnvelopeError(`OB-DATA block "${open.id}" has no end marker.`);

  const duplicates = new Set<string>();
  for (const block of blocks) {
    const key = `${block.schema}\0${block.id}`;
    if (duplicates.has(key)) throw new TexEnvelopeError(`Duplicate OB-DATA block "${block.schema}" id="${block.id}".`);
    duplicates.add(key);
  }
  return blocks;
}

export function getDataBlock<T>(source: string, schema: string, id: string): DataBlock<T> | null {
  return (parseDataBlocks(source).find((block) => block.schema === schema && block.id === id) as DataBlock<T> | undefined) ?? null;
}

/** Serialize one comment-only data file in a deterministic, reviewable form. */
export function serializeDataFile(schema: string, id: string, data: unknown, heading?: string): string {
  assertEnvelopeId(id);
  const payload = stableJson(data).split("\n").map((line) => `% ${line}`).join("\n");
  const title = heading ? `% ${heading.trim()}\n` : "";
  return `${title}% OB-DATA-BEGIN ${schema} id=${id}\n${payload}\n% OB-DATA-END id=${id}\n`;
}

export function readDataFile<T>(file: string, schema: string, id: string): T | null {
  let source: string;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const block = getDataBlock<T>(source, schema, id);
  if (!block) throw new TexEnvelopeError(`${file} is missing OB-DATA ${schema} id=${id}.`);
  return block.data;
}

export function writeDataFile(file: string, schema: string, id: string, data: unknown, heading?: string): void {
  writeTextAtomic(file, serializeDataFile(schema, id, data, heading));
}

/** Parse one `% OB-EDIT` envelope. */
export function parseEditBlocks(source: string): EditBlock[] {
  const blocks: EditBlock[] = [];
  let open: { schema: string; id: string; start: number; bodyStart: number } | null = null;

  for (const entry of linesWithOffsets(source)) {
    const begin = entry.line.match(EDIT_BEGIN);
    const end = entry.line.match(EDIT_END);
    if (begin) {
      if (open) throw new TexEnvelopeError(`Nested OB-EDIT block "${begin[2]}" is not allowed.`);
      open = { schema: begin[1]!, id: safeFileSegment(begin[2]!, "envelope id"), start: entry.start, bodyStart: entry.end };
      continue;
    }
    if (end) {
      const endId = safeFileSegment(end[1]!, "envelope id");
      if (!open) throw new TexEnvelopeError(`OB-EDIT block "${endId}" has no begin marker.`);
      if (endId !== open.id) throw new TexEnvelopeError(`OB-EDIT end id "${endId}" does not match "${open.id}".`);
      const bodyEnd = entry.start;
      const body = source.slice(open.bodyStart, bodyEnd);
      blocks.push({
        schema: open.schema,
        id: open.id,
        body,
        start: open.start,
        bodyStart: open.bodyStart,
        bodyEnd,
        end: entry.end,
        hash: sha256(body),
      });
      open = null;
      continue;
    }
  }
  if (open) throw new TexEnvelopeError(`OB-EDIT block "${open.id}" has no end marker.`);

  const ids = new Set<string>();
  for (const block of blocks) {
    if (ids.has(block.id)) throw new TexEnvelopeError(`Duplicate OB-EDIT id="${block.id}".`);
    ids.add(block.id);
  }
  return blocks;
}

export function getEditBlock(source: string, id: string): EditBlock | null {
  return parseEditBlocks(source).find((block) => block.id === id) ?? null;
}

/**
 * Replace exactly one editable body, rejecting stale browser snapshots. The
 * caller is responsible for rendering Markdown into valid TeX first.
 */
export function patchEditBlock(
  file: string,
  id: string,
  baseHash: string,
  nextBody: string,
): { hash: string; source: string } {
  // The lock serializes read/hash-check/rename as one compare-and-swap across
  // browser actions, MCP, and separate local processes.
  return withWriteLock(file, () => writeEditBlock(file, id, baseHash, nextBody));
}

/** Compare-and-swap one edit body without taking a lock. Callers must serialize. */
export function writeEditBlock(
  file: string,
  id: string,
  baseHash: string,
  nextBody: string,
): { hash: string; source: string } {
  const source = fs.readFileSync(file, "utf8");
  const block = getEditBlock(source, id);
  if (!block) throw new TexEnvelopeError(`${file} is missing editable block "${id}".`);
  if (block.hash !== baseHash) {
    throw new TexEnvelopeError(`The "${id}" section changed outside this editor. Reload it before saving.`);
  }
  const normalized = normalizeTexBody(nextBody);
  const next = `${source.slice(0, block.bodyStart)}${normalized}${source.slice(block.bodyEnd)}`;
  writeTextAtomic(file, next);
  return { hash: sha256(normalized), source: next };
}

export function serializeEditBlock(schema: string, id: string, body: string): string {
  assertEnvelopeId(id);
  return `% OB-EDIT-BEGIN ${schema} id=${id}\n${normalizeTexBody(body)}% OB-EDIT-END id=${id}\n`;
}

export function normalizeTexBody(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\s+$/u, "");
  return normalized ? `${normalized}\n` : "";
}

export function withWriteLock<T>(file: string, operation: () => T): T {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const release = lockfile.lockSync(file, {
    lockfilePath: `${file}.ob-lock`,
    realpath: false,
    stale: WRITE_LOCK_STALE_MS,
    update: WRITE_LOCK_UPDATE_MS,
    retries: 0,
  });
  try {
    return operation();
  } finally {
    release();
  }
}

/** Async variant for conversions that must inspect the include graph while the lock is held. */
export async function withWriteLockAsync<T>(file: string, operation: () => Promise<T> | T): Promise<T> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const release = await lockfile.lock(file, {
    lockfilePath: `${file}.ob-lock`,
    realpath: false,
    stale: WRITE_LOCK_STALE_MS,
    update: WRITE_LOCK_UPDATE_MS,
    retries: WRITE_LOCK_RETRIES,
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}

export function writeTextAtomic(file: string, text: string): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(tmp, "w");
    fs.writeFileSync(descriptor, text, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tmp, file);
    try {
      const directoryDescriptor = fs.openSync(dir, "r");
      try {
        fs.fsyncSync(directoryDescriptor);
      } finally {
        fs.closeSync(directoryDescriptor);
      }
    } catch {
      // Directory fsync is unavailable on some platforms. The file itself is durable.
    }
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Preserve the original write error.
      }
    }
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // Preserve the original write error.
    }
    throw error;
  }
}

export function safeFileSegment(value: string, label = "path segment"): string {
  if (!FILE_SEGMENT_RE.test(value)) throw new TexEnvelopeError(`Unsafe ${label}: ${value}`);
  return value;
}

export function safeAssetPath(value: string): string {
  const normalized = normalizeAssetRequest(value);
  if (!normalized || !ASSET_ROOTS.some((root) => normalized.startsWith(`${root}/`))) {
    throw new TexEnvelopeError(`Figure must reference a safe image under an approved project asset root: ${value}`);
  }
  return normalized;
}

export function assertEnvelopeId(value: string): void {
  safeFileSegment(value, "envelope id");
}

/** Replace or append a comment-only OB-DATA block without touching other bytes. */
export function upsertDataBlock(source: string, schema: string, id: string, data: unknown, heading?: string): string {
  const serialized = `${serializeDataFile(schema, id, data, heading).replace(/\s+$/, "")}\n`;
  const existing = getDataBlock(source, schema, id);
  if (!existing) {
    const prefix = source.replace(/\s*$/, "");
    return prefix ? `${prefix}\n\n${serialized}` : serialized;
  }
  return `${source.slice(0, existing.start)}${serialized}${source.slice(existing.end).replace(/^\n/, "")}`;
}

export { type MacroMatch, findMacroMatches } from "../marker-codec";
