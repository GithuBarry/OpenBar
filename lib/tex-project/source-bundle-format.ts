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
  ownerFilePath?: string,
): BundleSourcePart | undefined {
  const path = normalizeTeXInputPath(rawOrPath);
  const ownerDir = ownerFilePath?.includes("/") ? ownerFilePath.slice(0, ownerFilePath.lastIndexOf("/") + 1) : "";
  const relative = normalizeBundlePath(`${ownerDir}${path}`);
  const rootRelative = normalizeBundlePath(path);
  if (!relative || !rootRelative) return undefined;
  const exact = parts.find((part) => part.filePath === relative)
    || parts.find((part) => part.filePath === rootRelative)
    || parts.find((part) => part.filePath === rawOrPath);
  if (exact) return exact;
  const suffixes = parts.filter((part) => part.filePath.endsWith(`/${rootRelative}`) || part.filePath === rootRelative);
  return suffixes.length === 1 ? suffixes[0] : undefined;
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

const INCLUDE_LINE = /^(\s*)\\(input|include)\s*\{([^}]+)\}([ \t]*%.*)?\s*$/;

export function sliceRootByIncludes(rootBody: string): RootSlice[] {
  const slices: RootSlice[] = [];
  const lines = rootBody.split("\n");
  let cursor = 0;
  let texFrom = 0;
  let texParts: string[] = [];

  const flushTex = (to: number) => {
    if (!texParts.length) {
      texFrom = to;
      return;
    }
    const text = texParts.join("\n");
    slices.push({ kind: "tex", text, from: texFrom, to });
    texParts = [];
    texFrom = to;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineFrom = cursor;
    const lineTo = cursor + line.length + (i < lines.length - 1 ? 1 : 0);
    const match = INCLUDE_LINE.exec(line);
    const raw = match?.[3] || "";
    if (match && raw && !isPassthroughInclude(raw)) {
      flushTex(lineFrom);
      slices.push({
        kind: "include",
        command: match[2] as "input" | "include",
        raw,
        line,
        filePath: normalizeTeXInputPath(raw),
        from: lineFrom,
        to: lineTo,
      });
      texFrom = lineTo;
    } else {
      texParts.push(line);
    }
    cursor = lineTo;
  }
  flushTex(rootBody.length);
  return slices;
}

export function joinRootSlices(slices: RootSlice[]): string {
  const chunks: string[] = [];
  for (const slice of slices) {
    if (slice.kind === "tex") chunks.push(slice.text);
    else chunks.push(slice.line);
  }
  return chunks.join("\n");
}

export function replaceBundlePart(source: string, filePath: string, nextBody: string): string {
  const parts = splitBundleSource(source);
  if (!parts.length) return nextBody;
  return parts
    .map((part) => `${fileBanner(part.filePath)}${part.filePath === filePath ? nextBody : part.body}`)
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
  target.offsets.push(...next.offsets);
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
  const lines = body.text.split("\n");
  let cursor = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const hasNewline = index < lines.length - 1;
    const lineEnd = cursor + line.length + (hasNewline ? 1 : 0);
    const match = INCLUDE_LINE.exec(line);
    const raw = match?.[3] || "";
    const part = match && raw && !isPassthroughInclude(raw)
      ? lookupBundlePartFrom(parts, raw, ownerFilePath)
      : undefined;
    if (!part || seen.has(part.filePath)) {
      appendMapped(result, mappedSlice(body.text, body.offsets, cursor, lineEnd));
    } else {
      const nextSeen = new Set(seen);
      nextSeen.add(part.filePath);
      const included = stripPreviewEnvelopeMapped(part.body, part.bodyFrom);
      const nested = inlineMappedBody(included, part.filePath, parts, nextSeen);
      // The old line-based inliner removed one trailing newline from the
      // included body before joining it at the include site. Preserve that
      // exact behavior while keeping the source offset map aligned.
      appendMapped(result, dropOneTrailingNewline(nested));
      if (hasNewline) {
        const newlineOffset = body.offsets[cursor + line.length] ?? body.offsets[cursor] ?? 0;
        appendMapped(result, { text: "\n", offsets: [newlineOffset] });
      }
    }
    cursor = lineEnd;
  }
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
