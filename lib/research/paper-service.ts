/** Read the paper with the shared operation result envelope. */

import { TexEnvelopeError } from "@/lib/tex-project/codec";
import { readTexPaper, type TexPaper } from "@/lib/tex-project/project";

import { failResult, okResult, type OperationResult } from "./operation-result";

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
