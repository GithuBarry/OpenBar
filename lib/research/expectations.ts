/**
 * Shared product expectations for people and WebMCP agents.
 *
 * Keep these rules short, model-neutral, and project-independent. Scientific
 * standards, labels, and vocabulary remain editable in AGENTS.md and skills.
 */

export const OPENBAR_EXPECTATIONS_VERSION = "2026-09-04";

export const OPENBAR_EXPECTATIONS = [
  "Read the relevant paper context before proposing or applying an edit.",
  "Preserve the scientific argument, useful unfinished tables and figures, and unresolved markers.",
  "Make one useful local contribution and preserve unrelated cards, fields, and map placement.",
  "Treat TeX as the source of truth for TODO identity, text, timestamps, and completion.",
  "Keep Primary coverage complete; an unplaced TODO is still covered in Primary Unplaced.",
  "Use seven independent progress states with user-defined meaning; never infer completion from progress or children.",
  "Distinguish local persistence, remote synchronization, compile success, and research completion.",
  "Use expected revisions and stable source locations; report conflicts and affected paths instead of overwriting them.",
  "Prepare advisor summaries from substantive edits on demand, not from edit counts or automatic project-victory claims.",
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
