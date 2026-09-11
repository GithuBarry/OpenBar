/**
 * Static TeX `\input` / `\include` graph from a declared root.
 */

import fs from "node:fs";
import path from "node:path";

import { discoverTexHeadings } from "./tex-structure";
import { getDataBlock, sha256 } from "./codec";
import { isEnvironment, isMacro, mandatoryArgs, nodesToPlainText, parseTex } from "./tex-ast";

export type SourceDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  filePath?: string;
  repair?: {
    kind: "missing-edit-end";
    sectionId: string;
    filePath?: string;
  };
};

export type GraphNode = {
  id: string;
  filePath: string;
  absPath: string;
  hash: string;
  source: string;
  editable: boolean;
  appendix: boolean;
  kind: "root" | "section" | "style" | "bibliography" | "include" | "unmanaged";
};

const VERBATIM_ENVS = new Set(["verbatim", "Verbatim", "lstlisting", "minted", "alltt"]);

function posixRel(from: string, to: string): string {
  return path.relative(from, to).split(path.sep).join("/");
}

/**
 * TeX is invoked with `cwd === manuscriptDir`. Ordinary `\input` and
 * `\include` names therefore resolve from that directory, including when the
 * invocation appears in a nested source file. Keep this policy in one place
 * so graph traversal and compiler snapshots identify the same files.
 */
function resolveInput(manuscriptDir: string, _parentAbs: string, raw: string): string | null {
  const trimmed = raw.trim().replace(/^\{/, "").replace(/\}$/, "");
  if (!trimmed || /\\/.test(trimmed) || /#/.test(trimmed)) return null;
  const withExt = path.extname(trimmed) ? trimmed : `${trimmed}.tex`;
  const fromRoot = path.resolve(manuscriptDir, withExt);
  if (fs.existsSync(fromRoot)) return fromRoot;
  return fromRoot;
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function safeRootCandidate(root: string, candidate: string): string | null {
  const normalized = candidate.trim().replace(/\\/g, "/");
  if (!normalized || path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) return null;
  if (normalized.split("/").some((part) => part === "..")) return null;
  const abs = path.resolve(root, normalized);
  return isInside(root, abs) ? abs : null;
}

/** Return a configured root only when it currently exists as an in-root file. */
export function existingConfiguredTexRoot(manuscriptDir: string, preferred: string): string | undefined {
  const root = path.resolve(manuscriptDir);
  const candidate = safeRootCandidate(root, preferred);
  if (!candidate) return undefined;
  try {
    if (!fs.statSync(candidate).isFile()) return undefined;
    const realRoot = fs.realpathSync.native(root);
    const realCandidate = fs.realpathSync.native(candidate);
    return isInside(realRoot, realCandidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function classify(rel: string, hasSectionMeta: boolean): GraphNode["kind"] {
  const lower = rel.toLowerCase();
  if (lower.endsWith(".sty") || lower.endsWith(".cls")) return "style";
  if (lower.endsWith(".bib") || /(^|\/)(references|bibliography)(?:\.[^/]*)?$/.test(lower)) return "bibliography";
  if (hasSectionMeta) return "section";
  return "include";
}

function classifyResolvedFile(rel: string, absPath: string): GraphNode["kind"] {
  let sectionMeta = false;
  try {
    sectionMeta = hasTexSections(fs.readFileSync(absPath, "utf8"));
  } catch {
    // The child visit reports the read failure with the file path.
  }
  return classify(rel, sectionMeta);
}

type IncludeReference = {
  command: "input" | "include";
  raw: string;
  dynamic: boolean;
  from: number;
  to: number;
  appendix: boolean;
};

function nodeStartOffset(node: unknown): number | undefined {
  if (!node || typeof node !== "object") return undefined;
  const position = (node as { position?: { start?: { offset?: unknown } } }).position;
  const offset = position?.start?.offset;
  return typeof offset === "number" && Number.isInteger(offset) ? offset : undefined;
}

function includeInvocationEnd(source: string, from: number, command: "input" | "include"): number {
  const prefix = new RegExp(`^\\\\${command}\\s*`).exec(source.slice(from));
  if (!prefix) return from;
  let index = from + prefix[0].length;
  if (source[index] !== "{") return index;
  let depth = 0;
  for (; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return source.length;
}

function walkIncludes(source: string): IncludeReference[] {
  const ast = parseTex(source);
  const found: IncludeReference[] = [];
  const visit = (nodes: unknown[], inVerbatim: boolean, state: { appendix: boolean }) => {
    for (const node of nodes) {
      if (isEnvironment(node) && VERBATIM_ENVS.has(node.env || "")) {
        continue;
      }
      if (inVerbatim) continue;
      if (isMacro(node)) {
        const name = (node.content || "").replace(/\*$/, "");
        if (name === "appendix") {
          state.appendix = true;
          continue;
        }
        if (name === "input" || name === "include") {
          const arg = nodesToPlainText(mandatoryArgs(node)[0] ?? []).trim();
          const dynamic = !arg || /\\/.test(arg);
          const command = name as "input" | "include";
          const from = nodeStartOffset(node) ?? source.length;
          found.push({
            command,
            raw: arg,
            dynamic,
            from,
            to: includeInvocationEnd(source, from, command),
            appendix: state.appendix,
          });
        }
        continue;
      }
      if (node && typeof node === "object" && Array.isArray((node as { content?: unknown }).content)) {
        const content = (node as { content: unknown[] }).content;
        visit(content, false, state);
      }
    }
  };
  visit(ast.content, false, { appendix: false });
  const astFound = found;
  if (astFound.length) return astFound;
  const fallback: IncludeReference[] = [];
  const codeSource = stripTexComments(source);
  let lineFrom = 0;
  let appendix = false;
  for (const line of source.split(/\n/)) {
    const code = codeSource.slice(lineFrom, lineFrom + line.length);
    const appendixAt = code.search(/\\appendix\b/);
    const includes = /\\(input|include)\s*\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = includes.exec(code))) {
      const command = match[1] as "input" | "include";
      const matchAt = match.index ?? 0;
      const from = lineFrom + matchAt;
      fallback.push({
        command,
        raw: match[2] || "",
        dynamic: /\\/.test(match[2] || ""),
        from,
        to: from + match[0].length,
        appendix: appendix || (appendixAt >= 0 && appendixAt < matchAt),
      });
    }
    if (appendixAt >= 0) appendix = true;
    lineFrom += line.length + 1;
  }
  return fallback;
}

function hasTexSections(source: string): boolean {
  return discoverTexHeadings(source).length > 0;
}

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function maskLiteralRange(output: string[], source: string, from: number, to: number): void {
  for (let index = from; index < to; index += 1) {
    if (source[index] !== "\r" && source[index] !== "\n") output[index] = " ";
  }
}

function environmentCommandAt(source: string, index: number, command: "begin" | "end"): { name: string; to: number } | undefined {
  if (source[index] !== "\\" || isEscaped(source, index)) return undefined;
  const match = new RegExp(`^\\\\${command}\\s*\\{([^}\\r\\n]+)\\}`).exec(source.slice(index));
  const name = match?.[1]?.trim();
  return name && match ? { name, to: index + match[0].length } : undefined;
}

function verbCommandEnd(source: string, index: number): number | undefined {
  if (source[index] !== "\\" || isEscaped(source, index)) return undefined;
  const prefix = /^\\verb\*?/.exec(source.slice(index));
  if (!prefix) return undefined;
  const delimiter = source[index + prefix[0].length];
  if (!delimiter || delimiter === "\r" || delimiter === "\n") return undefined;
  for (let cursor = index + prefix[0].length + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === delimiter) return cursor + 1;
    if (source[cursor] === "\r" || source[cursor] === "\n") return cursor;
  }
  return source.length;
}

function stripTexComments(source: string): string {
  const output = source.split("");
  let inComment = false;
  let verbatimEnvironment: string | undefined;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (inComment) {
      if (char === "\r" || char === "\n") inComment = false;
      else output[index] = " ";
      continue;
    }
    if (verbatimEnvironment) {
      const end = environmentCommandAt(source, index, "end");
      if (end?.name === verbatimEnvironment) {
        maskLiteralRange(output, source, index, end.to);
        index = end.to - 1;
        verbatimEnvironment = undefined;
      } else if (char !== "\r" && char !== "\n") {
        output[index] = " ";
      }
      continue;
    }
    const begin = environmentCommandAt(source, index, "begin");
    if (begin && VERBATIM_ENVS.has(begin.name)) {
      maskLiteralRange(output, source, index, begin.to);
      index = begin.to - 1;
      verbatimEnvironment = begin.name;
      continue;
    }
    const verbEnd = verbCommandEnd(source, index);
    if (verbEnd !== undefined) {
      maskLiteralRange(output, source, index, verbEnd);
      index = verbEnd - 1;
      continue;
    }
    if (char === "%" && !isEscaped(source, index)) {
      output[index] = " ";
      inComment = true;
    }
  }
  return output.join("");
}

function configuredMainFile(manuscriptDir: string): string | undefined {
  const recordFiles = [
    path.join(manuscriptDir, ".OpenBar", "project.tex"),
    path.join(manuscriptDir, "openbarry", "project.tex"),
  ];
  for (const file of recordFiles) {
    try {
      const source = fs.readFileSync(file, "utf8");
      const record = getDataBlock<Record<string, unknown>>(source, "openbarry/project@1", "project")?.data;
      const mainFile = typeof record?.mainFile === "string" ? record.mainFile.trim() : "";
      if (mainFile) return mainFile;
    } catch {
      // Root discovery remains available for legacy or partially migrated projects.
    }
  }
  return undefined;
}

export function locateTexRoot(manuscriptDir: string, preferred?: string): string {
  const root = path.resolve(manuscriptDir);
  const existingFile = (candidate: string | null): string | null => {
    return candidate ? existingConfiguredTexRoot(root, path.relative(root, candidate)) || null : null;
  };
  const selected = preferred?.trim() || configuredMainFile(root) || "";
  const selectedCandidate = safeRootCandidate(root, selected);
  const requested = existingFile(selectedCandidate);
  if (requested) return requested;
  // Preserve a valid configured address even while its file is missing. This
  // gives graph and compile callers a stable missing-root diagnostic instead
  // of silently switching to another manuscript entry point.
  if (selectedCandidate) return selectedCandidate;
  for (const candidate of ["paper.tex", "main.tex", "ms.tex"]) {
    const conventional = existingFile(safeRootCandidate(root, candidate));
    if (conventional) return conventional;
  }
  try {
    const rootFiles = fs.readdirSync(root)
      .filter((file) => /\.(?:tex|ltx)$/i.test(file))
      .sort((a, b) => a.localeCompare(b));
    for (const file of rootFiles) {
      const candidate = existingFile(safeRootCandidate(root, file));
      if (!candidate) continue;
      const source = stripTexComments(fs.readFileSync(/*turbopackIgnore: true*/ candidate, "utf8"));
      if (/\\documentclass\b/.test(source) || /\\begin\s*\{document\}/.test(source)) return candidate;
    }
  } catch {
    // The fallback path below gives callers a stable missing-root diagnostic.
  }
  return path.resolve(root, "paper.tex");
}

export function traverseInputGraph(manuscriptDir: string, rootFile?: string): {
  rootFile: string;
  nodes: GraphNode[];
  occurrences: GraphNode[];
  diagnostics: SourceDiagnostic[];
} {
  const rootAbs = locateTexRoot(manuscriptDir, rootFile);
  const diagnostics: SourceDiagnostic[] = [];
  const nodes: GraphNode[] = [];
  const occurrences: GraphNode[] = [];
  const nodesByRealPath = new Map<string, GraphNode>();
  const visiting = new Set<string>();
  const seen = new Set<string>();

  const realRoot = (() => {
    try {
      return fs.realpathSync.native(path.resolve(manuscriptDir));
    } catch {
      return path.resolve(manuscriptDir);
    }
  })();

  const visit = (absPath: string, appendix: boolean, isRoot: boolean) => {
    let real: string;
    try {
      real = fs.realpathSync.native(absPath);
    } catch {
      diagnostics.push({
        severity: "error",
        code: "missing_include",
        message: `Missing TeX file: ${posixRel(realRoot, absPath)}`,
        filePath: posixRel(realRoot, absPath),
      });
      return;
    }
    if (!isInside(realRoot, real)) {
      diagnostics.push({
        severity: "error",
        code: "include_outside_root",
        message: `Include escapes the manuscript root: ${posixRel(realRoot, real)}`,
        filePath: posixRel(realRoot, real),
      });
      return;
    }
    if (visiting.has(real)) {
      diagnostics.push({
        severity: "error",
        code: "cyclic_include",
        message: `Cyclic include: ${posixRel(realRoot, real)}`,
        filePath: posixRel(realRoot, real),
      });
      return;
    }
    if (seen.has(real)) {
      const existing = nodesByRealPath.get(real);
      if (existing) occurrences.push({ ...existing, appendix });
      return;
    }
    visiting.add(real);
    seen.add(real);
    let source = "";
    try {
      source = fs.readFileSync(real, "utf8");
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "unreadable_include",
        message: error instanceof Error ? error.message : String(error),
        filePath: posixRel(realRoot, real),
      });
      visiting.delete(real);
      return;
    }
    const rel = posixRel(realRoot, real);
    const sectionMeta = hasTexSections(source);
    const kind = isRoot ? "root" : classify(rel, sectionMeta);
    const node: GraphNode = {
      // Keep the relative path itself as the identity. A punctuation-to-dash
      // slug can collide (`a/b.tex` and `a-b.tex`) and mis-map virtual ranges.
      id: rel || "root",
      filePath: rel,
      absPath: real,
      hash: sha256(source),
      source,
      editable: kind === "root" || kind === "section" || kind === "include" || kind === "unmanaged",
      appendix,
      kind,
    };
    nodes.push(node);
    nodesByRealPath.set(real, node);
    occurrences.push(node);
    const includes = walkIncludes(source);
    for (const item of includes) {
      if (item.dynamic) {
        diagnostics.push({
          severity: "warning",
          code: "dynamic_include",
          message: `Dynamic include is read-only: \\${item.command}{${item.raw || "..."}}`,
          filePath: rel,
        });
        continue;
      }
      const resolved = resolveInput(realRoot, real, item.raw);
      if (!resolved) {
        diagnostics.push({
          severity: "warning",
          code: "dynamic_include",
          message: `Could not resolve \\${item.command}{${item.raw}}`,
          filePath: rel,
        });
        continue;
      }
      visit(resolved, appendix || item.appendix, false);
    }
    visiting.delete(real);
  };

  let rootIsFile = false;
  try { rootIsFile = fs.statSync(/*turbopackIgnore: true*/ rootAbs).isFile(); } catch { /* graph reports a missing root */ }
  if (!rootIsFile) {
    diagnostics.push({
      severity: "error",
      code: "missing_root",
      message: `TeX root not found: ${posixRel(realRoot, rootAbs)}`,
      filePath: posixRel(realRoot, rootAbs),
    });
    return { rootFile: posixRel(realRoot, rootAbs), nodes, occurrences, diagnostics };
  }
  visit(rootAbs, false, true);
  return { rootFile: posixRel(realRoot, rootAbs), nodes, occurrences, diagnostics };
}

export function inspectRepository(manuscriptDir: string): {
  migrationRequired: boolean;
  rootFile: string;
  managedSectionCount: number;
  diagnostics: SourceDiagnostic[];
} {
  const graph = traverseInputGraph(manuscriptDir);
  const managed = graph.nodes.filter((node) => node.editable && discoverTexHeadings(node.source).length > 0);
  return {
    migrationRequired: managed.length === 0,
    rootFile: graph.rootFile,
    managedSectionCount: managed.length,
    diagnostics: graph.diagnostics,
  };
}

/**
 * Explicit full-project expansion for Pandoc conversion. Inlines `\input` /
 * `\include` of section and include files in an isolated string (not a temp
 * write). Style and bibliography inputs stay as commands so conversion does
 * not ingest `.sty` / `.bib` as TeX.
 */
export function expandIncludesForConversion(manuscriptDir: string, rootFile?: string): {
  source: string;
  diagnostics: SourceDiagnostic[];
} {
  const graph = traverseInputGraph(manuscriptDir, rootFile);
  const diagnostics = [...graph.diagnostics];
  const realRoot = (() => {
    try {
      return fs.realpathSync.native(path.resolve(manuscriptDir));
    } catch {
      return path.resolve(manuscriptDir);
    }
  })();
  const rootAbs = locateTexRoot(manuscriptDir, rootFile);

  const expandFile = (abs: string, seen: Set<string>): string => {
    let real: string;
    try {
      real = fs.realpathSync.native(abs);
    } catch {
      diagnostics.push({
        severity: "error",
        code: "missing_include",
        message: `Missing TeX file: ${posixRel(realRoot, path.resolve(abs))}`,
        filePath: posixRel(realRoot, path.resolve(abs)),
      });
      return "";
    }
    if (!isInside(realRoot, real)) {
      diagnostics.push({
        severity: "error",
        code: "include_outside_root",
        message: `Include escapes the manuscript root: ${posixRel(realRoot, real)}`,
        filePath: posixRel(realRoot, real),
      });
      return "";
    }
    if (seen.has(real)) {
      diagnostics.push({
        severity: "warning",
        code: "cyclic_include",
        message: `Skipped cyclic include ${posixRel(realRoot, real)}`,
        filePath: posixRel(realRoot, real),
      });
      return "";
    }
    seen.add(real);
    let source: string;
    try {
      source = fs.readFileSync(real, "utf8");
    } catch (error) {
      diagnostics.push({
        severity: "error",
        code: "unreadable_include",
        message: error instanceof Error ? error.message : String(error),
        filePath: posixRel(realRoot, real),
      });
      return "";
    }
    const includes = walkIncludes(source);
    for (const item of [...includes].reverse()) {
      if (item.dynamic) continue;
      const resolved = resolveInput(manuscriptDir, real, item.raw);
      if (!resolved) continue;
      let resolvedReal: string;
      try {
        resolvedReal = fs.realpathSync.native(resolved);
      } catch {
        diagnostics.push({
          severity: "error",
          code: "missing_include",
          message: `Missing TeX file: ${posixRel(realRoot, resolved)}`,
          filePath: posixRel(realRoot, resolved),
        });
        continue;
      }
      if (!isInside(realRoot, resolvedReal)) {
        diagnostics.push({
          severity: "error",
          code: "include_outside_root",
          message: `Include escapes the manuscript root: ${posixRel(realRoot, resolvedReal)}`,
          filePath: posixRel(realRoot, resolvedReal),
        });
        continue;
      }
      const rel = posixRel(realRoot, resolvedReal);
      const kind = classifyResolvedFile(rel, resolvedReal);
      const at = item.from;
      const end = item.to;
      if (at < 0 || end <= at || end > source.length) continue;
      if (kind === "bibliography") continue;
      const replacement = kind === "style" ? "" : expandFile(resolvedReal, new Set(seen));
      source = `${source.slice(0, at)}${replacement}${source.slice(end)}`;
    }
    return source;
  };

  return { source: expandFile(rootAbs, new Set()), diagnostics };
}

/** Text ranges in LaTeX include order, retaining each owning file's offsets. */
export function orderedSourceRanges(graph: ReturnType<typeof traverseInputGraph>): Array<{ node: GraphNode; from: number; to: number }> {
  const result: Array<{ node: GraphNode; from: number; to: number }> = [];
  const root = graph.nodes.find(node => node.kind === "root");
  if (!root) return result;
  const manuscriptDir = path.resolve(root.absPath, ...graph.rootFile.split("/").map(() => ".."));
  const byPath = new Map(graph.nodes.map(node => [node.absPath, node]));
  const active = new Set<string>();
  const walk = (node: GraphNode) => {
    if (active.has(node.absPath) || !node.editable) return;
    active.add(node.absPath);
    let from = 0;
    for (const include of walkIncludes(node.source)) {
      if (include.dynamic) continue;
      const resolved = resolveInput(manuscriptDir, node.absPath, include.raw);
      let child: GraphNode | undefined;
      try { child = resolved ? byPath.get(fs.realpathSync.native(resolved)) : undefined; } catch { /* graph reports missing files */ }
      if (!child?.editable) continue;
      result.push({ node, from, to: include.from });
      walk(child);
      from = include.to;
    }
    result.push({ node, from, to: node.source.length });
    active.delete(node.absPath);
  };
  walk(root);
  return result;
}
