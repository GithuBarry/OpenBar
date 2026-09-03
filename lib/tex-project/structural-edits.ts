/**
 * Narrow structural file patches. Callers in project.ts wrap these with
 * readTexPaper so this module never imports the paper store.
 */

import fs from "node:fs";
import path from "node:path";

import { failResult, okResult, type OperationResult } from "@/lib/research/operation-result";
import { inspectRepository } from "./source-graph";
import { normalizeTeXInputPath } from "./source-bundle-format";
import { escapeTexText } from "./tex-encode";
import {
  parseSectionMeta,
  serializeEditBlock,
  serializeSectionMeta,
  sha256,
  TexEnvelopeError,
  withWriteLock,
  writeTextAtomic,
  type SectionMeta,
} from "./codec";
import { sectionCommandForLevel } from "./paper-compose";

export function requireManagedManuscript(manuscriptDir: string): OperationResult<{ ok: true }> {
  const inspection = inspectRepository(manuscriptDir);
  if (inspection.migrationRequired) {
    return failResult(
      "migration_required",
      "This repository does not have enough OpenBar section metadata for a safe in-place structural edit. Inspect the include graph and apply a migration plan first.",
      { retryable: false, diagnostics: inspection.diagnostics },
    );
  }
  return okResult({ ok: true });
}

export function patchSectionTitleFile(file: string, title: string, level: number): void {
  const source = fs.readFileSync(file, "utf8");
  const meta = parseSectionMeta(source);
  const nextMeta: SectionMeta = { ...meta, title };
  const next = source.replace(/^%\s*OB-SECTION\s+\{.*\}\s*$/m, serializeSectionMeta(nextMeta).trimEnd());
  const heading = findHeadingInvocation(next);
  if (!heading) {
    throw new TexEnvelopeError(`Could not find heading in ${path.basename(file)}.`);
  }
  const renamed = `${next.slice(0, heading.titleStart)}${escapeTexText(title)}${next.slice(heading.titleEnd)}`;
  writeTextAtomic(file, renamed);
}

export function patchSectionHeadingFile(
  file: string,
  heading: { level: SectionMeta["level"]; appendix?: boolean; title?: string },
): void {
  const source = fs.readFileSync(file, "utf8");
  const meta = parseSectionMeta(source);
  const nextMeta: SectionMeta = {
    ...meta,
    level: heading.level,
    title: heading.title ?? meta.title,
    ...(heading.appendix ? { appendix: true } : {}),
  };
  if (!heading.appendix) delete (nextMeta as { appendix?: boolean }).appendix;
  let next = source.replace(/^%\s*OB-SECTION\s+\{.*\}\s*$/m, serializeSectionMeta(nextMeta).trimEnd());
  const invocation = findHeadingInvocation(next);
  if (!invocation) {
    throw new TexEnvelopeError(`Could not find heading in ${path.basename(file)}.`);
  }
  next = `${next.slice(0, invocation.commandStart)}\\${sectionCommandForLevel(heading.level)}${next.slice(invocation.commandEnd)}`;
  writeTextAtomic(file, next);
}

type HeadingInvocation = {
  commandStart: number;
  commandEnd: number;
  titleStart: number;
  titleEnd: number;
};

/** Locate the first structural heading while preserving its star and short title. */
function findHeadingInvocation(source: string): HeadingInvocation | null {
  const lines = source.split(/(?<=\n)/);
  let offset = 0;
  for (const line of lines) {
    const prefix = /^(\s*)\\(section|subsection|subsubsection|paragraph|subparagraph)/.exec(line);
    if (!prefix || line.slice(prefix[1]!.length).startsWith("%")) {
      offset += line.length;
      continue;
    }
    const commandStart = offset + prefix[1]!.length + 1;
    let cursor = commandStart + prefix[2]!.length;
    if (line[cursor - offset] === "*") cursor += 1;
    while (/\s/.test(line[cursor - offset] || "")) cursor += 1;
    if (line[cursor - offset] === "[") {
      const optionalEnd = findDelimitedEnd(line, cursor - offset, "[", "]");
      if (optionalEnd == null) {
        offset += line.length;
        continue;
      }
      cursor = offset + optionalEnd;
      while (/\s/.test(line[cursor - offset] || "")) cursor += 1;
    }
    if (line[cursor - offset] !== "{") {
      offset += line.length;
      continue;
    }
    const titleEnd = findDelimitedEnd(line, cursor - offset, "{", "}");
    if (titleEnd == null) {
      offset += line.length;
      continue;
    }
    return {
      commandStart,
      commandEnd: commandStart + prefix[2]!.length,
      titleStart: cursor + 1,
      titleEnd: offset + titleEnd - 1,
    };
  }
  return null;
}

function findDelimitedEnd(value: string, start: number, open: string, close: string): number | null {
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === open) depth += 1;
    if (value[index] === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return null;
}

export function replaceRootSectionInputs(rootSource: string, inputLines: string[], managedPaths?: string[]): string {
  const lines = rootSource.split(/\n/);
  const defaultPaths = lines
    .map((line) => /^\s*\\(?:input|include)\s*\{([^}]+)\}/.exec(line)?.[1])
    .filter((raw): raw is string => typeof raw === "string")
    .filter((raw) => normalizeTeXInputPath(raw).startsWith("sections/"));
  const managed = new Set((managedPaths || defaultPaths)
    .map((raw) => normalizeTeXInputPath(raw)));
  const isManagedInput = (line: string) => {
    const raw = /^\s*\\(?:input|include)\s*\{([^}]+)\}/.exec(line)?.[1];
    return Boolean(raw && managed.has(normalizeTeXInputPath(raw)));
  };
  const hits = lines.flatMap((line, index) => isManagedInput(line) ? [index] : []);
  if (!hits.length) {
    const begin = lines.findIndex((line) => /\\begin\{document\}/.test(line));
    const insertAt = begin >= 0 ? begin + 1 : lines.length;
    lines.splice(insertAt, 0, ...inputLines);
    return lines.join("\n");
  }
  const hitSet = new Set(hits);
  const result: string[] = [];
  let desired = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (!hitSet.has(index)) {
      result.push(lines[index]!);
      continue;
    }
    if (desired < inputLines.length) result.push(inputLines[desired++]!);
    if (index === hits.at(-1) && desired < inputLines.length) {
      result.push(...inputLines.slice(desired));
      desired = inputLines.length;
    }
  }
  return result.join("\n");
}

export function sectionInputLine(filename: string): string {
  const normalized = filename.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.tex$/, "");
  return `\\input{${normalized.includes("/") ? normalized : `sections/${normalized}`}}`;
}

export function writeNewSectionFile(file: string, meta: SectionMeta): void {
  const content = [
    serializeSectionMeta(meta),
    `\\${sectionCommandForLevel(meta.level)}{${escapeTexText(meta.title)}}`,
    `\\label{${meta.label}}`,
    serializeEditBlock("openbarry/markdown@1", meta.id, "").trimEnd(),
    "",
  ].join("\n");
  writeTextAtomic(file, content);
}

export function detachSectionFile(file: string, detachedDir: string): string {
  fs.mkdirSync(detachedDir, { recursive: true });
  const base = path.basename(file);
  let destination = path.join(detachedDir, base);
  let suffix = 2;
  while (fs.existsSync(/*turbopackIgnore: true*/ destination)) {
    destination = path.join(detachedDir, `${path.basename(base, path.extname(base))}-${suffix}${path.extname(base)}`);
    suffix += 1;
  }
  fs.renameSync(file, destination);
  return destination;
}

export function hashFile(file: string): string | null {
  try {
    return sha256(fs.readFileSync(file));
  } catch {
    return null;
  }
}

export function withPaperStructureLock<T>(lockFile: string, operation: () => T): T {
  return withWriteLock(lockFile, operation);
}

export function safeSectionFilename(title: string, fallback: string): string {
  const normalized = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || fallback).slice(0, 72);
}
