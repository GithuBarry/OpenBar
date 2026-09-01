/**
 * Paper read/patch operations. Wraps the existing hash CAS in
 * `lib/tex-project/project.ts`. No MCP, no React.
 *
 * WebMCP and server actions should import these functions rather than
 * talking to the filesystem directly.
 */

import { TexEnvelopeError } from "@/lib/tex-project/codec";
import {
  findPaperSection,
  patchPaperSections,
  readTexPaper,
  replacePaperTex,
  type PaperSection,
  type PaperSectionPatch,
  type TexPaper,
} from "@/lib/tex-project/project";

import { failResult, okResult, type OperationResult } from "./operation-result";

export type { PaperSection, PaperSectionPatch, TexPaper };

function mapError(error: unknown): OperationResult<never> {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof TexEnvelopeError) {
    if (/changed outside this editor/i.test(message)) {
      return failResult("stale_disk_state", message, true);
    }
    if (/must be TeX/i.test(message) || /markdown/i.test(message)) {
      return failResult("invalid_tex", message, false);
    }
    if (/Unsafe/i.test(message)) {
      return failResult("invalid_arguments", message, false);
    }
  }
  if (/Unknown paper section/i.test(message)) {
    return failResult("unknown_section", message, false);
  }
  return failResult("invalid_arguments", message, false);
}

export function readPaper(projectDir: string, projectId: string, title: string): OperationResult<TexPaper> {
  try {
    const paper = readTexPaper(projectDir, projectId, title);
    if (!paper) return failResult("unknown_section", "No TeX paper at this project path.", false);
    return okResult(paper);
  } catch (error) {
    return mapError(error);
  }
}

export function readSection(projectDir: string, id: string): OperationResult<PaperSection> {
  try {
    const section = findPaperSection(projectDir, id);
    if (!section) return failResult("unknown_section", `Unknown paper section: ${id}`, false);
    return okResult(section);
  } catch (error) {
    return mapError(error);
  }
}

export function patchSection(
  projectDir: string,
  id: string,
  baseHash: string,
  tex: string,
  heading?: { level?: number; appendix?: boolean },
): OperationResult<PaperSection> {
  const result = patchSections(projectDir, [{ id, baseHash, tex, ...heading }]);
  if (!result.ok) return result;
  const section = result.value[0];
  if (!section) return failResult("unknown_section", `Unknown paper section: ${id}`, false);
  return okResult(section);
}

/**
 * One lock, verify every hash, then commit all. A stale or unknown section
 * rejects the whole batch so a mid-loop conflict cannot save a prefix.
 */
export function patchSections(projectDir: string, patches: PaperSectionPatch[]): OperationResult<PaperSection[]> {
  if (!patches.length) return okResult([]);
  try {
    for (const patch of patches) {
      const section = findPaperSection(projectDir, patch.id);
      if (!section) return failResult("unknown_section", `Unknown paper section: ${patch.id}`, false);
      if (section.hash !== patch.baseHash) {
        return failResult(
          "stale_disk_state",
          `The "${patch.id}" section changed outside this editor. Reload it before saving.`,
          true,
        );
      }
    }
    return okResult(patchPaperSections(projectDir, patches));
  } catch (error) {
    return mapError(error);
  }
}

/** Full-document replace when section titles still match. Structure changes stay explicit operations. */
export function replacePaper(
  projectDir: string,
  projectId: string,
  title: string,
  source: string,
): OperationResult<TexPaper> {
  try {
    return okResult(replacePaperTex(projectDir, projectId, title, source));
  } catch (error) {
    return mapError(error);
  }
}
