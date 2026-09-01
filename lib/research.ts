/**
 * OpenBar — experiment pre-registration & research-question hygiene.
 *
 * This module encodes research hygiene practices that support clear,
 * evidence-grounded experimental work:
 *
 *   - Pre-register a hypothesis + expectations BEFORE running an experiment,
 *     so results can be honestly compared against what you predicted.
 *   - Don't get stuck on the method and miss the goal: every experiment names
 *     the *question* it answers and the *goal* it serves.
 *   - Prefer research questions that stay interesting whichever way the result
 *     goes (the "interesting-either-way" test).
 *   - Keep an idea deposit up to date, even when nebulous.
 *
 * These types are the contract for the pre-registration, question-bank, and
 * idea-deposit surfaces. Kept dependency-free like the rest of lib/.
 */

import { ArtifactRef, Maturity } from "./types";

// ---------------------------------------------------------------------------
// Pre-registration — the anti-HARKing artifact.
//
// A preregistration is authored while the experiment is still `predicted`.
// Once results land, the author records the `outcome` and whether the
// prediction held. Crucially, the *prediction text is frozen* — the platform
// diffs prediction vs outcome rather than letting the story get rewritten
// after the fact (HARKing: Hypothesizing After Results are Known).
// ---------------------------------------------------------------------------

export type PreregStatus =
  | "predicted" // hypothesis logged, experiment not yet run
  | "running" // experiment in progress
  | "confirmed" // result matched the prediction
  | "disconfirmed" // result contradicted the prediction (still valuable!)
  | "inconclusive" // ran, but no clear signal
  | "abandoned"; // experiment dropped

export interface Prediction {
  /** Frozen once status leaves `predicted`. The honest, dated prediction. */
  text: string;
  /** A concrete, checkable expected outcome (e.g. "ASR rises above 60%"). */
  expected: string;
  /** ISO date the prediction was frozen. */
  frozenAt?: string;
}

export interface Preregistration {
  id: string;
  projectId: string;
  title: string;
  /** The research question this experiment answers (links the goal, not just the method). */
  question: string;
  /** Why this matters — motivation. Rendered as LaTeX/markdown. */
  motivation: string;
  /** The pre-registered hypothesis & expectation, frozen when the run starts. */
  prediction: Prediction;
  /** How the experiment will be run and measured (method + metric + decision rule). */
  method: string;
  /** Concrete stop/go decision rule set in advance ("keep if ASR>60% by 500 steps"). */
  decisionRule?: string;
  status: PreregStatus;
  /** Recorded after the fact. Frozen prediction is diffed against this. */
  outcome?: {
    text: string;
    /** Did the frozen prediction hold? null while unknown. */
    predictionHeld: boolean | null;
    recordedAt: string;
  };
  /**
   * The "interesting-either-way" self-check: is the question worth answering
   * regardless of which way the result goes? The author rates it and
   * justifies the rating.
   */
  interestingEitherWay?: {
    rating: "yes" | "partly" | "no";
    why: string;
  };
  createdAt: string;
  updatedAt: string;
  refs: ArtifactRef[];
}

// ---------------------------------------------------------------------------
// Idea deposit — the up-to-date bank of nebulous future directions.
// ---------------------------------------------------------------------------

export interface Idea {
  id: string;
  title: string;
  /** Free-form sketch; nebulous is fine. Markdown + LaTeX. */
  sketch: string;
  /** Maturity of the idea itself (usually empty or hypothesized). */
  maturity: Maturity;
  /** Author's read on payoff and risk, to support the Aug "what next" decision. */
  promise?: "low" | "medium" | "high";
  risk?: "low" | "medium" | "high";
  /** The interesting-either-way test, applied to the idea. */
  interestingEitherWay?: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** Optional link to a project if it graduates into one. */
  promotedTo?: string;
}

/**
 * Score how well a preregistration follows good practice. Surfaced as a nudge,
 * never a gate. Points for: a real question, motivation, a frozen prediction
 * with a concrete expectation, a decision rule, and passing the
 * interesting-either-way test.
 */
export function preregHygiene(p: Preregistration): {
  score: number; // 0..1
  missing: string[];
} {
  const checks: [boolean, string][] = [
    [p.question.trim().length > 10, "Name the research question this answers."],
    [p.motivation.trim().length > 20, "Say why it matters (motivation)."],
    [p.prediction.text.trim().length > 10, "Write a real hypothesis."],
    [p.prediction.expected.trim().length > 5, "State a concrete expected outcome."],
    [!!p.decisionRule && p.decisionRule.trim().length > 5, "Set a stop/go decision rule in advance."],
    [!!p.interestingEitherWay && p.interestingEitherWay.rating !== "no", "Check it's interesting either way."],
  ];
  const passed = checks.filter(([ok]) => ok).length;
  return {
    score: passed / checks.length,
    missing: checks.filter(([ok]) => !ok).map(([, msg]) => msg),
  };
}

export const PREREG_STATUS_META: Record<
  PreregStatus,
  { label: string; tone: "neutral" | "active" | "good" | "warn" | "bad" }
> = {
  predicted: { label: "Predicted", tone: "neutral" },
  running: { label: "Running", tone: "active" },
  confirmed: { label: "Confirmed", tone: "good" },
  disconfirmed: { label: "Disconfirmed", tone: "warn" },
  inconclusive: { label: "Inconclusive", tone: "warn" },
  abandoned: { label: "Abandoned", tone: "bad" },
};
