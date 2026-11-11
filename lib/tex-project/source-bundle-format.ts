import { maskTexLiterals } from "./tex-literals";

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

/** Reapply edits made during a save to the server's rebuilt include graph. */
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
  for (const [file, edit] of changed) {
    if (edit.before === edit.after) continue;
    const canonicalBody = canonicalByFile.get(file);
    if (canonicalBody === undefined || !fileBytesUnchanged(edit.before, canonicalBody)) conflicts.add(file);
  }
  if (conflicts.size) return { ok: false, files: [...conflicts] };
  return {
    ok: true,
    source: canonicalParts.map((part) => {
      const edit = changed.get(part.filePath);
      return `${fileBanner(part.filePath)}${edit && edit.before !== edit.after ? edit.after : part.body}`;
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
