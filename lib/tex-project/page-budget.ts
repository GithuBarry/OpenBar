import fs from "node:fs";
import path from "node:path";

import { texPaths } from "./project";

export type PaperPageBudget = {
  totalPages: number;
  firstNumberedPage: number;
  mainMatterPages: number;
  lastNumberedSection: {
    number: number;
    title: string;
    startsOnPage: number;
  };
  measuredAt: string;
};

type NumberedSection = {
  number: number;
  page: number;
  title: string;
};

const SECTION_LABEL = /\\newlabel\{(sec-[^}]+)\}\{\{([^{}]*)\}\{(\d+)\}\{([^{}]*)\}/g;

function plainTitle(value: string): string {
  return value
    .replace(/\\[A-Za-z@]+\s*/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads LaTeX's compiled auxiliary file. The managed section labels give an
 * exact page for each numbered manuscript section without parsing PDF text.
 */
export function inspectPaperPageBudget(projectDir: string, artifactId?: string): PaperPageBudget | undefined {
  const safeArtifactId = artifactId && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(artifactId) ? artifactId : undefined;
  const auxFile = safeArtifactId
    ? path.join(texPaths(projectDir).buildDir, "artifacts", safeArtifactId, "paper.aux")
    : path.join(texPaths(projectDir).buildDir, "paper.aux");
  let aux: string;
  let measuredAt: string;
  try {
    const stat = fs.statSync(auxFile);
    aux = fs.readFileSync(auxFile, "utf8");
    measuredAt = stat.mtime.toISOString();
  } catch {
    return undefined;
  }

  const sections: NumberedSection[] = [];
  SECTION_LABEL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SECTION_LABEL.exec(aux))) {
    const number = Number(match[2]);
    const page = Number(match[3]);
    if (!Number.isInteger(number) || number < 1 || !Number.isInteger(page) || page < 1) continue;
    sections.push({ number, page, title: plainTitle(match[4] || "") || `Section ${number}` });
  }
  if (!sections.length) return undefined;

  sections.sort((a, b) => a.number - b.number || a.page - b.page);
  const first = sections[0]!;
  const last = sections.at(-1)!;
  const totalPages = Number(/\\@abspage@last\{(\d+)\}/.exec(aux)?.[1]) || last.page;

  return {
    totalPages: Math.max(totalPages, last.page),
    firstNumberedPage: first.page,
    mainMatterPages: last.page - first.page + 1,
    lastNumberedSection: {
      number: last.number,
      title: last.title,
      startsOnPage: last.page,
    },
    measuredAt,
  };
}
