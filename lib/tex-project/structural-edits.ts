/**
 * Narrow structural file patches. Callers in project.ts wrap these with
 * readTexPaper so this module never imports the paper store.
 */

import { headingInvocation, stripSectionComments } from "./section-ranges";
import fs from "node:fs";
import path from "node:path";

import { escapeTexText } from "./tex-encode";
import {
  sha256,
  TexEnvelopeError,
  writeTextAtomic,
  type SectionMeta,
} from "./codec";
import { withProjectWriteLock } from "@/lib/research/project-lock";
import { sectionCommandForLevel } from "./paper-compose";

export function patchSectionTitleFile(file: string, title: string, level: number, from = 0): void {
  const source = fs.readFileSync(file, "utf8");
  const start = from || source.search(/\\(?:section|subsection|subsubsection|paragraph|subparagraph)\b/);
  const heading = headingInvocation(source, start);
  if (!heading) throw new TexEnvelopeError(`Could not find heading in ${path.basename(file)}.`);
  writeTextAtomic(file, stripSectionComments(`${source.slice(0, heading.titleFrom)}${escapeTexText(title)}${source.slice(heading.titleTo)}`));
}

export function patchSectionHeadingFile(
  file: string,
  heading: { level: SectionMeta["level"]; appendix?: boolean; title?: string },
  from = 0,
): void {
  const source = fs.readFileSync(file, "utf8");
  const start = from || source.search(/\\(?:section|subsection|subsubsection|paragraph|subparagraph)\b/);
  const next = source.slice(0, start) + source.slice(start).replace(/^\\(?:section|subsection|subsubsection|paragraph|subparagraph)/,
    `\\${sectionCommandForLevel(heading.level)}`);
  writeTextAtomic(file, stripSectionComments(next));
}

export function hashFile(file: string): string | null {
  try {
    return sha256(fs.readFileSync(file));
  } catch {
    return null;
  }
}

export function withPaperStructureLock<T>(lockFile: string, operation: () => T): T {
  return withProjectWriteLock(lockFile, operation);
}
