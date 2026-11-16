/**
 * Shared product expectations for people and WebMCP agents.
 *
 * Keep these rules short, model-neutral, and project-independent. Scientific
 * standards, labels, and vocabulary remain editable in AGENTS.md and skills.
 */

import { PROJECT_DELIVERY_GUIDANCE } from "./agent-guidance";

export const OPENBAR_EXPECTATIONS_VERSION = "2026-11-16";

export const OPENBAR_EXPECTATIONS = [
  "Read relevant context and tagged requests. Make the smallest requested edit, preserving unfinished structures and unrelated work.",
  PROJECT_DELIVERY_GUIDANCE,
  "Start from the intended full paper skeleton. Place each TODO beside the argument its outcome will strengthen, preserving stable TODO ids as evidence fills the paper and map.",
  "TeX owns TODO identity, text, timestamps, and completion. Primary covers each TODO through a card or Unplaced.",
  "Each map owns presentation and user-defined progress. Scientific vocabulary belongs in project instructions and skills.",
  "Use current revisions and source hashes. Report conflicts with affected paths.",
  "Report saving, remote synchronization, compilation, and research outcomes separately. Ground requested summaries in substantive edits.",
] as const;

export type OpenBarExpectations = {
  version: string;
  rules: readonly string[];
};

export function openBarExpectations(): OpenBarExpectations {
  return {
    version: OPENBAR_EXPECTATIONS_VERSION,
    rules: [...OPENBAR_EXPECTATIONS],
  };
}
