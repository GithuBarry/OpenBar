/**
 * Shared product expectations for people and WebMCP agents.
 *
 * Keep these rules short, model-neutral, and project-independent. Scientific
 * standards, labels, and vocabulary remain editable in AGENTS.md and skills.
 */

export const OPENBAR_EXPECTATIONS_VERSION = "2026-11-04";

export const OPENBAR_EXPECTATIONS = [
  "Read relevant context and tagged requests. Make the smallest requested edit, preserving unfinished structures and unrelated work.",
  "Keep work-in-progress papers visibly unfinished throughout: place TODOs where their results most strengthen the argument, with local questions, notes, partial tables, and missing-result markers until each open point is resolved.",
  "Start from the intended full paper skeleton. Fill its sections, argument steps, comparisons, tables, and figures as evidence arrives, and expose reopened gaps when changes reduce completion.",
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
