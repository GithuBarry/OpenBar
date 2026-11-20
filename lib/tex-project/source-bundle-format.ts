import { maskTexLiterals } from "./tex-literals";
import { PAPER_REFERENCES_FILE } from "./paper-compose";

/**
 * Browser-safe SourceBundle banners and range helpers.
 * Keep Node filesystem code in source-bundle.ts / source-persist.ts.
 */

export const SOURCE_FILE_BANNER_PREFIX = "% === openbarry:file ";

export function fileBanner(filePath: string): string {
  return `${SOURCE_FILE_BANNER_PREFIX}${filePath} ===\n`;
}

export type BundleSourcePart = {
  filePath: string;
  bannerFrom: number;
  bodyFrom: number;
  bodyTo: number;
  body: string;
};

const BANNER_RE = /^% === openbarry:file (.+) ===\n/gm;

export function splitBundleSource(source: string): BundleSourcePart[] {
  const hits = [...source.matchAll(BANNER_RE)];
  return hits.map((hit, index) => {
    const bannerFrom = hit.index ?? 0;
    const bodyFrom = bannerFrom + hit[0].length;
    const bodyTo = hits[index + 1]?.index ?? source.length;
    return {
      filePath: hit[1] || "",
      bannerFrom,
      bodyFrom,
      bodyTo,
      body: source.slice(bodyFrom, bodyTo),
    };
  });
}

type LineHunk = { start: number; end: number; lines: string[] };

/** Compute minimal changed line hunks from `base` to `target` using LCS on trimmed diff window. */
function diffLineHunks(base: string[], target: string[]): LineHunk[] | null {
  let prefix = 0;
  while (prefix < base.length && prefix < target.length && base[prefix] === target[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < base.length - prefix
    && suffix < target.length - prefix
    && base[base.length - 1 - suffix] === target[target.length - 1 - suffix]
  ) suffix += 1;

  const bMid = base.slice(prefix, base.length - suffix);
  const tMid = target.slice(prefix, target.length - suffix);
  if (!bMid.length && !tMid.length) return [];
  // Bound DP table for huge diffs; fall back to single-file hunk if very large.
  if (bMid.length * tMid.length > 250_000) {
    return [{ start: prefix, end: base.length - suffix, lines: tMid }];
  }
  const m = bMid.length;
  const n = tMid.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i]![j] = bMid[i] === tMid[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const hunks: LineHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && bMid[i] === tMid[j]) {
      i += 1;
      j += 1;
      continue;
    }
    const startI = i;
    const startJ = j;
    while (i < m || j < n) {
      if (i < m && j < n && bMid[i] === tMid[j]) break;
      if (i < m && (j >= n || dp[i + 1]![j]! >= dp[i]![j + 1]!)) i += 1;
      else j += 1;
    }
    hunks.push({ start: prefix + startI, end: prefix + i, lines: tMid.slice(startJ, j) });
  }
  return hunks;
}

/** Conservative line-level 3-way merge. Returns null on any overlapping or adjacent conflict. */
export function mergeTextThreeWay(base: string, remote: string, local: string): string | null {
  if (local === base) return remote;
  if (remote === base) return local;
  if (local === remote) return local;
  const baseLines = base.split("\n");
  const remoteHunks = diffLineHunks(baseLines, remote.split("\n"));
  const localHunks = diffLineHunks(baseLines, local.split("\n"));
  if (!remoteHunks || !localHunks) return null;

  const combined: Array<LineHunk & { side: "remote" | "local" }> = [
    ...remoteHunks.map((h) => ({ ...h, side: "remote" as const })),
    ...localHunks.map((h) => ({ ...h, side: "local" as const })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);

  const mergedHunks: LineHunk[] = [];
  for (const hunk of combined) {
    const prev = mergedHunks.at(-1);
    if (prev && hunk.start <= prev.end) {
      // Allow identical changes at the exact same range; reject any true overlap/adjacency.
      if (prev.start === hunk.start && prev.end === hunk.end && prev.lines.join("\n") === hunk.lines.join("\n")) {
        continue;
      }
      return null;
    }
    mergedHunks.push({ start: hunk.start, end: hunk.end, lines: hunk.lines });
  }

  const out: string[] = [];
  let cursor = 0;
  for (const hunk of mergedHunks) {
    out.push(...baseLines.slice(cursor, hunk.start));
    out.push(...hunk.lines);
    cursor = hunk.end;
  }
  out.push(...baseLines.slice(cursor));
  return out.join("\n");
}

/** Reapply edits made during a save to the server's rebuilt include graph or newer disk snapshot. */
export function rebaseBundleSource(saved: string, live: string, canonical: string):
  | { ok: true; source: string }
  | { ok: false; files: string[] } {
  if (live === saved) return { ok: true, source: canonical };
  const savedParts = splitBundleSource(saved);
  const liveParts = splitBundleSource(live);
  const canonicalParts = splitBundleSource(canonical);
  if (!savedParts.length || savedParts[0]?.bannerFrom !== 0 || liveParts[0]?.bannerFrom !== 0
    || !canonicalParts.length || canonicalParts[0]?.bannerFrom !== 0 || savedParts.length !== liveParts.length
    || savedParts.some((part, index) => part.filePath !== liveParts[index]?.filePath)) {
    return { ok: false, files: [] };
  }
  const changed = new Map<string, { before: string; after: string }>();
  const conflicts = new Set<string>();
  for (let index = 0; index < savedParts.length; index += 1) {
    const before = savedParts[index]!;
    const after = liveParts[index]!;
    const existing = changed.get(before.filePath);
    if (existing && (existing.before !== before.body || existing.after !== after.body)) conflicts.add(before.filePath);
    else changed.set(before.filePath, { before: before.body, after: after.body });
  }
  const canonicalByFile = new Map<string, string>();
  for (const part of canonicalParts) {
    const existing = canonicalByFile.get(part.filePath);
    if (existing !== undefined && existing !== part.body) conflicts.add(part.filePath);
    canonicalByFile.set(part.filePath, part.body);
  }
  const mergedByFile = new Map<string, string>();
  for (const [file, edit] of changed) {
    if (edit.before === edit.after) continue;
    const canonicalBody = canonicalByFile.get(file);
    if (canonicalBody === undefined) {
      conflicts.add(file);
      continue;
    }
    if (fileBytesUnchanged(edit.before, canonicalBody)) {
      mergedByFile.set(file, edit.after);
      continue;
    }
    const merged = mergeTextThreeWay(edit.before, canonicalBody, edit.after);
    if (merged === null) conflicts.add(file);
    else mergedByFile.set(file, merged);
  }
  if (conflicts.size) return { ok: false, files: [...conflicts] };
  return {
    ok: true,
    source: canonicalParts.map((part, index) => {
      const merged = mergedByFile.get(part.filePath);
      const body = merged !== undefined ? merged : part.body;
      const sep = index < canonicalParts.length - 1 && body.length > 0 && !body.endsWith("\n") ? "\n" : "";
      return `${fileBanner(part.filePath)}${body}${sep}`;
    }).join(""),
  };
}

export function bannerRanges(source: string): Array<{ from: number; to: number }> {
  return splitBundleSource(source).map((part) => ({ from: part.bannerFrom, to: part.bodyFrom }));
}

/** True when live body is the on-disk file plus at most the bundler's trailing newline. */
export function fileBytesUnchanged(disk: string, liveBody: string): boolean {
  if (disk === liveBody) return true;
  return !disk.endsWith("\n") && liveBody === `${disk}\n`;
}

export function normalizeTeXInputPath(raw: string): string {
  const trimmed = raw.trim().replace(/^\{/, "").replace(/\}$/, "").replace(/\\/g, "/");
  if (!trimmed) return trimmed;
  return pathHasExtension(trimmed) ? trimmed : `${trimmed}.tex`;
}

function pathHasExtension(value: string): boolean {
  const last = value.slice(value.lastIndexOf("/") + 1);
  const dot = last.lastIndexOf(".");
  return dot > 0 && dot < last.length - 1;
}

export function isPassthroughInclude(raw: string): boolean {
  const normalized = normalizeTeXInputPath(raw);
  const path = normalized.toLowerCase();
  return (
    path.endsWith(".sty")
    || path.endsWith(".cls")
    || path.endsWith(".bib")
    || /(^|\/)references\.tex$/.test(path)
    || normalized === ".OpenBar/references.tex"
    || normalized === PAPER_REFERENCES_FILE
    || path.includes("openbarry/references")
  );
}

export function lookupBundlePart(parts: BundleSourcePart[], rawOrPath: string): BundleSourcePart | undefined {
  return lookupBundlePartFrom(parts, rawOrPath);
}

export function lookupBundlePartFrom(
  parts: BundleSourcePart[],
  rawOrPath: string,
  _ownerFilePath?: string,
): BundleSourcePart | undefined {
  const path = normalizeTeXInputPath(rawOrPath);
  const rootRelative = normalizeBundlePath(path);
  if (!rootRelative) return undefined;
  // The source bundle mirrors TeX's manuscript-root working directory. An
  // include written in `nested/parent.tex` still names `child.tex` at the
  // manuscript root, so owner-relative and suffix matching would select a
  // different file from the compiler when duplicate basenames exist.
  return parts.find((part) => part.filePath === rootRelative)
    || parts.find((part) => part.filePath === rawOrPath);
}

function normalizeBundlePath(value: string): string | null {
  const pieces: string[] = [];
  for (const piece of value.replace(/\\/g, "/").split("/")) {
    if (!piece || piece === ".") continue;
    if (piece === "..") {
      if (!pieces.length) return null;
      pieces.pop();
      continue;
    }
    pieces.push(piece);
  }
  return pieces.join("/");
}

export function stripPreviewEnvelope(body: string): string {
  return body
    .replace(/^%\s*OB-SECTION\s+\{.*\}\s*\n?/gm, "")
    .replace(/^%\s*OB-EDIT-(?:BEGIN|END)[^\n]*\n?/gm, "");
}

export type RootSlice =
  | { kind: "tex"; text: string; from: number; to: number }
  | {
    kind: "include";
    command: "input" | "include";
    raw: string;
    line: string;
    filePath: string;
    from: number;
    to: number;
  };

type IncludeMatch = {
  command: "input" | "include";
  raw: string;
  from: number;
  to: number;
};

/** Find executable braced includes while retaining their offsets in `source`. */
function findIncludeCommands(source: string): IncludeMatch[] {
  const masked = maskTexLiterals(source);
  const includePattern = /\\(input|include)\s*\{([^{}]*)\}/g;
  const matches: IncludeMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = includePattern.exec(masked))) {
    matches.push({
      command: match[1] as "input" | "include",
      raw: match[2] || "",
      from: match.index ?? 0,
      to: includePattern.lastIndex,
    });
  }
  return matches;
}

/**
 * Keep a standalone include line together for the nested editor. Inline and
 * multiple includes retain exact command spans so surrounding source stays
 * owned by its original file and offset range.
 */
function rootIncludeSlice(rootBody: string, include: IncludeMatch): Extract<RootSlice, { kind: "include" }> {
  const lineFrom = rootBody.lastIndexOf("\n", include.from - 1) + 1;
  const lineBreak = rootBody.indexOf("\n", include.to);
  const lineTo = lineBreak < 0 ? rootBody.length : lineBreak;
  const prefix = rootBody.slice(lineFrom, include.from);
  const suffix = rootBody.slice(include.to, lineTo).replace(/\r$/, "");
  const standalone = include.to <= lineTo
    && /^[ \t]*$/.test(prefix)
    && /^[ \t]*(?:%[^\r\n]*)?[ \t]*$/.test(suffix);
  const from = standalone ? lineFrom : include.from;
  const to = standalone ? (lineBreak < 0 ? lineTo : lineBreak + 1) : include.to;
  return {
    kind: "include",
    command: include.command,
    raw: include.raw,
    line: rootBody.slice(from, standalone ? lineTo : to),
    filePath: normalizeTeXInputPath(include.raw),
    from,
    to,
  };
}

export function sliceRootByIncludes(rootBody: string): RootSlice[] {
  const slices: RootSlice[] = [];
  let cursor = 0;
  for (const include of findIncludeCommands(rootBody)) {
    if (!include.raw || isPassthroughInclude(include.raw)) continue;
    const slice = rootIncludeSlice(rootBody, include);
    if (slice.from < cursor) continue;
    if (slice.from > cursor) {
      slices.push({ kind: "tex", text: rootBody.slice(cursor, slice.from), from: cursor, to: slice.from });
    }
    slices.push(slice);
    cursor = slice.to;
  }
  if (cursor < rootBody.length) {
    slices.push({ kind: "tex", text: rootBody.slice(cursor), from: cursor, to: rootBody.length });
  }
  return slices;
}

export function joinRootSlices(slices: RootSlice[]): string {
  const chunks: string[] = [];
  for (const slice of slices) {
    if (slice.kind === "tex") chunks.push(slice.text);
    else {
      chunks.push(slice.line);
      // Standalone include slices own their line terminator in `to` while
      // `line` retains the historical line-without-terminator value.
      if (slice.to > slice.from + slice.line.length) chunks.push("\n");
    }
  }
  return chunks.join("");
}

export function replaceBundlePart(source: string, filePath: string, nextBody: string): string {
  const parts = splitBundleSource(source);
  if (!parts.length) return nextBody;
  return parts
    .map((part, index) => {
      const body = part.filePath === filePath ? nextBody : part.body;
      // Keep the next file banner on its own line after an editor trims EOF.
      const separator = index < parts.length - 1 && body.length > 0 && !body.endsWith("\n") ? "\n" : "";
      return `${fileBanner(part.filePath)}${body}${separator}`;
    })
    .join("");
}

/**
 * Replace `\input`/`\include` of graph files with those files' bodies so preview
 * and heading order follow paper.tex instead of dumping includes after `\end{document}`.
 */
export function inlineBundleIncludes(source: string): string {
  return inlineBundleIncludesMapped(source).source;
}

export type InlineBundleSource = {
  source: string;
  /** Map an offset in the rendered/inlined source back to the bundle source. */
  mapOffset: (offset: number) => number;
  /** Identify which bundled file owns an inlined offset. */
  mapFilePath?: (offset: number) => string | undefined;
};

type MappedText = { text: string; offsets: number[] };

function mappedSlice(text: string, offsets: number[], from: number, to: number): MappedText {
  return { text: text.slice(from, to), offsets: offsets.slice(from, to) };
}

function appendMapped(target: MappedText, next: MappedText): void {
  target.text += next.text;
  for (const offset of next.offsets) target.offsets.push(offset);
}

function dropOneTrailingNewline(value: MappedText): MappedText {
  if (!value.text.endsWith("\n")) return value;
  return {
    text: value.text.slice(0, -1),
    offsets: value.offsets.slice(0, -1),
  };
}

function stripPreviewEnvelopeMapped(body: string, baseOffset: number): MappedText {
  const result: MappedText = { text: "", offsets: [] };
  const lines = body.split("\n");
  let cursor = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const hasNewline = index < lines.length - 1;
    const lineEnd = cursor + line.length + (hasNewline ? 1 : 0);
    const removed = /^%\s*OB-SECTION\s+\{.*\}\s*\n?$/.test(`${line}${hasNewline ? "\n" : ""}`)
      || /^%\s*OB-EDIT-(?:BEGIN|END)[^\n]*\n?$/.test(`${line}${hasNewline ? "\n" : ""}`);
    if (!removed) {
      appendMapped(result, {
        text: body.slice(cursor, lineEnd),
        offsets: Array.from({ length: lineEnd - cursor }, (_, offset) => baseOffset + cursor + offset),
      });
    }
    cursor = lineEnd;
  }
  return result;
}

function inlineMappedBody(
  body: MappedText,
  ownerFilePath: string,
  parts: ReturnType<typeof splitBundleSource>,
  seen: Set<string>,
): MappedText {
  const result: MappedText = { text: "", offsets: [] };
  let cursor = 0;
  for (const include of findIncludeCommands(body.text)) {
    const part = include.raw && !isPassthroughInclude(include.raw)
      ? lookupBundlePartFrom(parts, include.raw, ownerFilePath)
      : undefined;
    if (!part || seen.has(part.filePath)) continue;
    appendMapped(result, mappedSlice(body.text, body.offsets, cursor, include.from));
    const nextSeen = new Set(seen);
    nextSeen.add(part.filePath);
    const included = stripPreviewEnvelopeMapped(part.body, part.bodyFrom);
    const nested = inlineMappedBody(included, part.filePath, parts, nextSeen);
    // Drop one included trailing newline because the original include
    // invocation retains the source bytes that followed it. This preserves
    // the established line behavior and also handles inline or multiple
    // includes without shifting the offset map.
    appendMapped(result, dropOneTrailingNewline(nested));
    cursor = include.to;
  }
  appendMapped(result, mappedSlice(body.text, body.offsets, cursor, body.text.length));
  return result;
}

export function inlineBundleIncludesMapped(source: string): InlineBundleSource {
  const parts = splitBundleSource(source);
  if (!parts.length) return { source, mapOffset: (offset) => Math.max(0, Math.min(source.length, offset)) };
  const root = parts[0]!;
  const rootMapped: MappedText = {
    text: root.body,
    offsets: Array.from({ length: root.body.length }, (_, offset) => root.bodyFrom + offset),
  };
  const mapped = inlineMappedBody(rootMapped, root.filePath, parts, new Set([root.filePath]));
  return {
    source: mapped.text,
    mapOffset: (offset) => {
      if (offset <= 0) return mapped.offsets[0] ?? 0;
      if (offset >= mapped.text.length) return source.length;
      return mapped.offsets[offset] ?? source.length;
    },
    mapFilePath: (offset) => {
      if (offset < 0 || offset >= mapped.offsets.length) return undefined;
      const origin = mapped.offsets[offset];
      const owner = parts.find((part) => origin >= part.bodyFrom && origin < part.bodyTo);
      return owner?.filePath;
    },
  };
}

export type ClientSourceSegment = {
  id: string;
  filePath: string;
  virtualFrom: number;
  virtualTo: number;
  fileFrom: number;
  fileTo: number;
  fileHash: string;
  editable: boolean;
};

export type ClientSourceBundle = {
  rootFile: string;
  source: string;
  revision: number;
  bundleHash: string;
  segments: ClientSourceSegment[];
  diagnostics: Array<{
    severity: "error" | "warning" | "info";
    code: string;
    message: string;
    filePath?: string;
  }>;
};
