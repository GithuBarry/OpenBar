/**
 * Static TeX `\input` / `\include` graph from a declared root.
 */

import fs from "node:fs";
import path from "node:path";

import { sha256 } from "./codec";
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

function resolveInput(manuscriptDir: string, parentAbs: string, raw: string): string | null {
  const trimmed = raw.trim().replace(/^\{/, "").replace(/\}$/, "");
  if (!trimmed || /\\/.test(trimmed) || /#/.test(trimmed)) return null;
  const withExt = path.extname(trimmed) ? trimmed : `${trimmed}.tex`;
  const fromParent = path.resolve(path.dirname(parentAbs), withExt);
  const fromRoot = path.resolve(manuscriptDir, withExt);
  if (fs.existsSync(fromParent)) return fromParent;
  if (fs.existsSync(fromRoot)) return fromRoot;
  return fromRoot;
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
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
    sectionMeta = hasObSection(fs.readFileSync(absPath, "utf8"));
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
  let lineFrom = 0;
  let appendix = false;
  for (const line of source.split(/\n/)) {
    const code = stripTexComments(line);
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

function hasObSection(source: string): boolean {
  return /^%\s*OB-SECTION\s+\{/m.test(source);
}

function stripTexComments(source: string): string {
  let output = "";
  let backslashes = 0;
  for (const char of source) {
    if (char === "\\") {
      backslashes += 1;
      output += char;
      continue;
    }
    if (char === "%" && backslashes % 2 === 0) {
      while (output.length && output.at(-1) !== "\n") output = output.slice(0, -1);
      backslashes = 0;
      continue;
    }
    output += char;
    backslashes = 0;
  }
  return output;
}

export function locateTexRoot(manuscriptDir: string, preferred?: string): string {
  const root = path.resolve(manuscriptDir);
  const safeCandidate = (candidate: string): string | null => {
    const normalized = candidate.trim().replace(/\\/g, "/");
    if (!normalized || path.posix.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized)) return null;
    if (normalized.split("/").some((part) => part === "..")) return null;
    const abs = path.resolve(root, normalized);
    return isInside(root, abs) ? abs : null;
  };
  const existingFile = (candidate: string | null): string | null => {
    if (!candidate || !fs.existsSync(candidate)) return null;
    try {
      if (!fs.statSync(candidate).isFile()) return null;
      const realRoot = fs.realpathSync.native(root);
      const realCandidate = fs.realpathSync.native(candidate);
      return isInside(realRoot, realCandidate) ? candidate : null;
    } catch {
      return null;
    }
  };
  const requested = existingFile(safeCandidate(preferred || ""));
  if (requested) return requested;
  for (const candidate of ["paper.tex", "main.tex", "ms.tex"]) {
    const conventional = existingFile(safeCandidate(candidate));
    if (conventional) return conventional;
  }
  try {
    const rootFiles = fs.readdirSync(root)
      .filter((file) => /\.(?:tex|ltx)$/i.test(file))
      .sort((a, b) => a.localeCompare(b));
    for (const file of rootFiles) {
      const candidate = existingFile(safeCandidate(file));
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
    const sectionMeta = hasObSection(source);
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

  if (!fs.existsSync(/*turbopackIgnore: true*/ rootAbs)) {
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
  const managed = graph.nodes.filter((node) => node.kind === "section");
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
