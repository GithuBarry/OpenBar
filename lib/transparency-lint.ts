/**
 * OpenBar — reasoning-transparency & research-rigor linter.
 *
 * Turns the methodology principles into concrete, checkable lints over a draft's
 * source. This is how "reasoning transparency" and "measurement validity" become
 * part of the pipeline instead of advice floating in a doc: the draft editor
 * shows these findings live, the dashboard rolls them up, and the MCP hands them
 * to agents.
 *
 * Every lint maps to a principle id in lib/methodology.ts. Pure & dependency-free.
 */

import { analyzeDraft } from "./maturity";
import { DraftSection } from "./types";

export type LintSeverity = "blocker" | "warn" | "nudge";

export interface Lint {
  id: string;
  /** Principle this enforces (methodology.ts). */
  principle: string;
  severity: LintSeverity;
  title: string;
  detail: string;
  /** Section title if localized, else document-level. */
  section?: string;
  line?: number;
}

// Heuristics kept deliberately simple and transparent (no NLP): they flag the
// *absence of a visible practice*, which is exactly what reasoning transparency
// is about. False positives are acceptable — they prompt the author to make the
// practice explicit, which is the point.

const CLAIM_WORDS =
  /\b(we show|we prove|we find|we demonstrate|our results?|significantly|outperforms?|achieves?|state[- ]of[- ]the[- ]art|SOTA|best)\b/i;
const EVIDENCE_NEAR =
  /\b(table|figure|fig\.|see §|appendix|\\ref|\\cite|\[\[|http|p\s*[<=]|CI|confidence interval|n\s*=)\b/i;
const CONFIDENCE_WORDS =
  /\b(we believe|we think|likely|we are confident|uncertain|preliminary|suggests?|appears?|may|might|hypothesiz)/i;
const METRIC_WORDS =
  /\b(accuracy|ASR|F1|BLEU|loss|reward|win[- ]rate|success rate|score|precision|recall|AUC|perplexity)\b/i;

/**
 * Lint a draft's source against the transparency + rigor rubric.
 * `hasFigures`/`hasCode` let callers pass external knowledge (e.g. a linked repo).
 */
export function lintDraft(source: string): Lint[] {
  const { sections, openItems } = analyzeDraft(source);
  const lints: Lint[] = [];
  const push = (l: Lint) => lints.push(l);

  const bodyAll = source.toLowerCase();
  const firstReal = sections.find(
    (s) => s.title !== "Preamble" && !s.placeholders.emptyBody,
  );

  // --- Reasoning transparency: summary of takeaways first ------------------
  const hasSummary =
    /\b(summary|key takeaways?|tl;?dr|in short|our (main )?contributions?|we make the following)\b/i.test(
      source.slice(0, 1200),
    ) || /^#{1,3}\s*(abstract|summary|contributions)/im.test(source.slice(0, 400));
  if (sections.length > 2 && !hasSummary) {
    push({
      id: "no-summary",
      principle: "summary-first",
      severity: "warn",
      title: "Open with a linked summary of key takeaways",
      detail:
        "Reasoning transparency (Muehlhauser): a reader should grasp your conclusions up front and drill into any one. Add an abstract or a 'Key takeaways' list near the top.",
    });
  }

  // --- One singular idea (Carlini) ----------------------------------------
  const hasCentralClaim = /\b(central claim|main claim|our thesis|we argue that|key idea|our contribution is)\b/i.test(
    source,
  );
  if (sections.length > 3 && !hasCentralClaim) {
    push({
      id: "no-central-claim",
      principle: "one-idea",
      severity: "nudge",
      title: "State one central claim",
      detail:
        "Carlini: do one thing well. Name the single claim this draft argues, and tie every experiment to it. Consider a one-sentence 'central claim' line.",
    });
  }

  // --- Per-section: claims without nearby evidence -------------------------
  for (const s of sections) {
    if (s.placeholders.emptyBody) continue;
    if (CLAIM_WORDS.test(s.body) && !EVIDENCE_NEAR.test(s.body)) {
      push({
        id: `claim-no-evidence:${s.id}`,
        principle: "source-every-claim",
        severity: "warn",
        title: "Claim without pointable support",
        detail:
          "This section makes a results-claim but has no nearby figure, table, citation, or statistic. Give every substantive claim support the reader can point to.",
        section: s.title,
        line: s.line,
      });
    }

    // --- Measurement validity: metric named, no validity note -------------
    if (
      METRIC_WORDS.test(s.body) &&
      !/\b(measures?|proxy|captures?|validity|confound|actually|caveat|limitation|does not measure|fails? to)\b/i.test(
        s.body,
      )
    ) {
      push({
        id: `metric-unexamined:${s.id}`,
        principle: "measure-what-you-claim",
        severity: "nudge",
        title: "Metric stated without a validity note",
        detail:
          "\"You are not measuring what you think you're measuring.\" This section reports a metric but doesn't say what it actually measures vs. what you claim, or note confounds. Add one sentence on the gap.",
        section: s.title,
        line: s.line,
      });
    }
  }

  // --- Calibrated confidence somewhere ------------------------------------
  if (firstReal && !CONFIDENCE_WORDS.test(source) && !/\{\?/.test(source)) {
    push({
      id: "no-confidence",
      principle: "calibrated-confidence",
      severity: "nudge",
      title: "No confidence signals anywhere",
      detail:
        "Nothing in the draft marks how confident you are in its claims. Use maturity markers ({?hypothesized:} {?verify:}) or explicit confidence language so readers can calibrate.",
    });
  }

  // --- Open questions list -------------------------------------------------
  const hasOpenQuestions =
    /\b(open questions?|limitations?|future work|remaining questions?|what we don'?t know|threats to validity)\b/i.test(
      source,
    );
  if (sections.length > 3 && !hasOpenQuestions && openItems.length === 0) {
    push({
      id: "no-open-questions",
      principle: "open-questions",
      severity: "nudge",
      title: "No open-questions / limitations surfaced",
      detail:
        "Keep an explicit list of what remains uncertain (Muehlhauser, Nanda). A draft with zero open items and no limitations section is usually hiding them, not free of them.",
    });
  }

  // --- Failure story (Christiano) — for method-y drafts --------------------
  const looksMethody = /\b(algorithm|method|approach|we propose|our (method|approach|model))\b/i.test(
    source,
  );
  const hasFailureStory = /\b(failure (case|mode|story)|counterexample|where (it|this) fails|breaks down when|adversarial case)\b/i.test(
    source,
  );
  if (looksMethody && !hasFailureStory) {
    push({
      id: "no-failure-story",
      principle: "failure-story-loop",
      severity: "nudge",
      title: "No failure story for the method",
      detail:
        "Christiano's loop: propose a method, then actively search for a concrete story of how it fails. Add the hardest case you know and whether it's handled.",
    });
  }

  // --- Reviewer objections (Carlini) --------------------------------------
  if (looksMethody && !/\b(objection|one might (worry|argue|object)|a natural concern|reviewers? (might|may)|limitation)\b/i.test(source)) {
    push({
      id: "no-objections",
      principle: "preempt-objections",
      severity: "nudge",
      title: "Reviewer objections not preempted",
      detail:
        "Be your own harshest critic: list the objections a reviewer will raise and answer each. Cheapest review you'll get.",
    });
  }

  return lints;
}

export interface TransparencyScore {
  score: number; // 0..1
  lints: Lint[];
  counts: Record<LintSeverity, number>;
}

/**
 * A 0..1 transparency score: 1 = every checked practice is visibly present.
 * Blockers cost most, nudges least. This drives the draft's transparency meter.
 */
export function transparencyScore(source: string): TransparencyScore {
  const lints = lintDraft(source);
  const counts: Record<LintSeverity, number> = { blocker: 0, warn: 0, nudge: 0 };
  for (const l of lints) counts[l.severity]++;
  // Weighted penalty, capped so a messy early draft still reads as "low" not negative.
  const penalty = counts.blocker * 0.25 + counts.warn * 0.12 + counts.nudge * 0.05;
  return { score: Math.max(0, 1 - penalty), lints, counts };
}
