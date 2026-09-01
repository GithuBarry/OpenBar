/**
 * OpenBarry — research methodology knowledge base.
 *
 * Distilled, operational principles from the primary sources on how good
 * research actually happens. This is NOT decoration: every principle here is
 * wired into a concrete platform surface (a checklist item, a prereg field, a
 * draft lint, a dashboard signal) AND handed to coding agents through the MCP
 * so they work the way a rigorous researcher works.
 *
 * Sources (read and distilled, not paraphrased from memory):
 *  - R. Hamming, "You and Your Research" (1986)
 *  - L. Muehlhauser, "Reasoning Transparency" (Open Philanthropy, 2017)
 *  - P. Christiano, "My Research Methodology" (2021)
 *  - N. Nanda, "My Research Process: Understanding & Cultivating Research Taste"
 *  - N. Carlini, "How to win a best paper award" (2026)
 *  - J. Steinhardt et al., "You Are Not Measuring What You Think You're Measuring"
 *  - pengsida, "learning_research"
 *
 * Each principle has: a stable id, a short imperative, the source, the "why",
 * and — critically — `surfaces`: where in OpenBarry it is operationalized, so
 * we can prove it's more than text floating somewhere.
 */

export type MethodologySurface =
  | "prereg" // the pre-registration flow
  | "draft-lint" // the draft maturity/transparency linter
  | "question-bank" // research-question selection & scoring
  | "reflection" // the calibration / post-mortem loop
  | "experiment" // experiment cards & failure-story log
  | "measurement" // measurement-validity checklist
  | "dashboard" // the research-health dashboard
  | "notes" // daily/weekly notes
  | "mcp"; // handed to coding agents

export interface Principle {
  id: string;
  imperative: string;
  source: string;
  why: string;
  /** Where this is enforced/visualized in the product. */
  surfaces: MethodologySurface[];
  /** Optional concrete checks (used by linters & checklists). */
  checks?: string[];
}

export const PRINCIPLES: Principle[] = [
  // --- Hamming: important problems, attack, compounding ---------------------
  {
    id: "important-problems",
    imperative: "Work on important problems — ones that matter and that you have an attack on.",
    source: "Hamming, You and Your Research",
    why: "Impact requires both importance and a credible line of attack. High-importance problems with no attack aren't yet workable; keep them in the bank until an attack appears.",
    surfaces: ["question-bank", "dashboard", "mcp"],
    checks: [
      "Does this question have a stated importance?",
      "Does it have at least one concrete attack/approach?",
    ],
  },
  {
    id: "problem-bank",
    imperative: "Keep a living bank of important problems and open questions; revisit it deliberately.",
    source: "Hamming; Nanda; pengsida",
    why: "Great researchers keep many seeded problems and switch when an opening appears. An idea deposit kept current turns luck into progress.",
    surfaces: ["question-bank", "notes"],
  },
  {
    id: "interesting-either-way",
    imperative: "Prefer questions that stay interesting whichever way the result comes out.",
    source: "Hamming; Daphne Ippolito",
    why: "A question whose value doesn't depend on a particular outcome de-risks the project and resists motivated reasoning.",
    surfaces: ["prereg", "question-bank"],
    checks: ["If the result is negative, is the finding still interesting/publishable?"],
  },
  {
    id: "compound-effort",
    imperative: "Add small, consistent effort in one direction — it compounds.",
    source: "Hamming",
    why: "Modest sustained investment along a coherent line beats scattered bursts; knowledge and reputation compound.",
    surfaces: ["dashboard", "notes"],
  },

  // --- Christiano: propose -> find failure story -> fix ----------------------
  {
    id: "failure-story-loop",
    imperative: "Alternate proposing an approach with actively searching for a concrete story of how it fails.",
    source: "Christiano, My Research Methodology",
    why: "Building the method and its hardest counterexample in tandem exposes fatal flaws early, while they're cheap to fix.",
    surfaces: ["experiment", "prereg", "mcp"],
    checks: [
      "Have you written at least one concrete failure story for this approach?",
      "Is each failure story either refuted with evidence, or open?",
    ],
  },
  {
    id: "concrete-counterexample",
    imperative: "Make failure stories concrete until they either break or stay coherent.",
    source: "Christiano",
    why: "Vague worries don't discriminate between approaches; a concrete scenario does. Push a story until a contradiction appears or it survives.",
    surfaces: ["experiment"],
  },
  {
    id: "hard-case-library",
    imperative: "Keep a reusable library of representative hard cases and stress them every time.",
    source: "Christiano",
    why: "The same failure modes recur; a standing set of adversarial cases prevents shared blind spots and re-derivation.",
    surfaces: ["experiment", "measurement"],
  },

  // --- Measurement validity -------------------------------------------------
  {
    id: "measure-what-you-claim",
    imperative: "Assume you are NOT measuring what you think — then go check.",
    source: "You Are Not Measuring What You Think You're Measuring",
    why: "The gap between a metric and the claim it supports is the default failure of empirical work. Name the gap explicitly.",
    surfaces: ["measurement", "draft-lint", "prereg", "mcp"],
    checks: [
      "What exactly does this metric measure, mechanically?",
      "What do you want to claim from it? Where's the gap?",
      "Have you looked at raw examples, not just the aggregate?",
    ],
  },
  {
    id: "look-at-your-data",
    imperative: "Look at raw examples early and often — read the actual outputs, not just the number.",
    source: "Measurement essay; Nanda",
    why: "Aggregates hide bugs, leakage, and degenerate behavior that a few minutes of reading raw data reveals.",
    surfaces: ["measurement", "experiment"],
    checks: ["Have you inspected ≥10 raw examples for this result?"],
  },
  {
    id: "predict-then-run",
    imperative: "Predict an experiment's outcome before running it; log the prediction.",
    source: "Measurement essay; Nanda; Christiano",
    why: "A surprise is where the learning is — but only if you recorded what you expected. Predicting also catches experiments that can't discriminate anything.",
    surfaces: ["prereg", "experiment", "reflection"],
    checks: ["Did you record a prediction before seeing results?"],
  },
  {
    id: "many-signals",
    imperative: "Measure several related things, not one bit — triangulate what you're actually measuring.",
    source: "Measurement essay",
    why: "One binary outcome rarely identifies the mechanism; correlated auxiliary signals do.",
    surfaces: ["measurement", "experiment"],
  },
  {
    id: "cheap-sanity-checks",
    imperative: "Run cheap sanity checks and calibration cases with known answers.",
    source: "Measurement essay; Carlini",
    why: "A known-outcome probe validates the measurement device before you trust it on the real question.",
    surfaces: ["measurement", "experiment"],
  },

  // --- Reasoning transparency (Muehlhauser) ---------------------------------
  {
    id: "summary-first",
    imperative: "Open with a summary of key takeaways, each linked to where it's argued.",
    source: "Muehlhauser, Reasoning Transparency",
    why: "A reader should grasp your conclusions and drill into any one without reading the whole thing.",
    surfaces: ["draft-lint", "notes"],
    checks: ["Does the draft open with a takeaways summary?"],
  },
  {
    id: "mark-loadbearing",
    imperative: "Flag which considerations are most load-bearing for each conclusion.",
    source: "Muehlhauser",
    why: "Readers (and you) need to know what would change your mind. The crux deserves a label.",
    surfaces: ["draft-lint", "prereg"],
    checks: ["Is the most load-bearing evidence for each claim marked?"],
  },
  {
    id: "calibrated-confidence",
    imperative: "State your confidence in each major claim and the support you have for it.",
    source: "Muehlhauser; anti-sycophancy",
    why: "Unmarked confidence is the enemy of updating. Distinguish 'verified' from 'hypothesized' at the claim level.",
    surfaces: ["draft-lint", "prereg", "mcp"],
    checks: [
      "Does each major claim carry a confidence / maturity marker?",
      "Is evidence distinguished from interpretation?",
    ],
  },
  {
    id: "source-every-claim",
    imperative: "Give pointable support for every substantive claim (a run, a figure, a source span).",
    source: "Muehlhauser; Carlini",
    why: "A claim you can't point to is a claim you can't defend. Endnote-level sourcing beats hand-waving at a whole paper.",
    surfaces: ["draft-lint", "mcp"],
    checks: ["Does each substantive claim have a citation or evidence link?"],
  },
  {
    id: "open-questions",
    imperative: "Keep an explicit list of remaining open questions and what you're unsure of.",
    source: "Muehlhauser; Nanda",
    why: "The open-questions list is honest, guides the next step, and is exactly what an agent must not silently 'complete'.",
    surfaces: ["draft-lint", "dashboard", "mcp"],
  },

  // --- Carlini: the paper as a local optimum --------------------------------
  {
    id: "one-idea",
    imperative: "Do one thing well: one singular idea, and every experiment tied to it.",
    source: "Carlini, How to win a best paper award",
    why: "Focus beats breadth. A paper that argues one claim thoroughly outperforms one that gestures at five.",
    surfaces: ["prereg", "draft-lint", "dashboard"],
    checks: ["Is there a single stated central claim?", "Does every experiment map to it?"],
  },
  {
    id: "de-risk-early",
    imperative: "Attack the sub-problem most likely to fail first; kill dead ideas fast.",
    source: "Carlini; Christiano",
    why: "Cheap early failure saves months. De-risk the riskiest piece before investing in the rest.",
    surfaces: ["experiment", "dashboard"],
  },
  {
    id: "preempt-objections",
    imperative: "List the reviewer's likely objections and answer each with evidence.",
    source: "Carlini",
    why: "Being your own harshest critic before submission is the cheapest review you'll get.",
    surfaces: ["draft-lint", "reflection"],
    checks: ["Is there a list of likely objections, each addressed?"],
  },
  {
    id: "invest-in-writing",
    imperative: "Invest heavily in presentation: clear claim, self-contained figures, no misreads possible.",
    source: "Carlini; Hamming; pengsida",
    why: "Whether others build on your work depends on whether they understand it. Communication is part of the research, not after it.",
    surfaces: ["draft-lint"],
    checks: ["Does every figure have a one-line takeaway caption?"],
  },
  {
    id: "reproducible-artifacts",
    imperative: "Ship reproducible artifacts: code, data, seeds, run instructions.",
    source: "Carlini; pengsida; measurement essay",
    why: "Reproducibility is both scientific integrity and the mechanism by which work gets used.",
    surfaces: ["experiment", "dashboard"],
  },

  // --- Nanda: process stages, taste, reflection -----------------------------
  {
    id: "research-stages",
    imperative: "Know which stage you're in — ideation, exploration, understanding, distillation — and act accordingly.",
    source: "Nanda, My Research Process",
    why: "Exploration rewards breadth and speed; understanding rewards controlled, decisive experiments; distillation rewards ruthless compression. Using the wrong mode wastes effort.",
    surfaces: ["dashboard", "experiment", "mcp"],
  },
  {
    id: "keep-a-log",
    imperative: "Keep a research log: daily/weekly notes with predictions, surprises, and decisions.",
    source: "Nanda; pengsida",
    why: "A log makes progress legible, feeds calibration, and is what a collaborator (or agent) needs to catch up.",
    surfaces: ["notes", "reflection"],
  },
  {
    id: "predict-advice",
    imperative: "Before asking a mentor, predict their advice; then compare.",
    source: "Nanda",
    why: "Predicting advice turns every mentor interaction into calibration data and sharpens your own model.",
    surfaces: ["reflection", "notes"],
  },
  {
    id: "post-mortem",
    imperative: "Post-mortem long decisions: prior prediction vs outcome vs lesson.",
    source: "Nanda; Christiano",
    why: "Treating failures as data — deliberately — is how research taste is cultivated faster than by osmosis.",
    surfaces: ["reflection", "prereg"],
  },
];

/** Principles that apply to a given product surface. */
export function principlesFor(surface: MethodologySurface): Principle[] {
  return PRINCIPLES.filter((p) => p.surfaces.includes(surface));
}

/** Compact digest handed to coding agents via the MCP. */
export function methodologyDigest(): string {
  const bySource = new Map<string, Principle[]>();
  for (const p of PRINCIPLES) {
    const key = p.source.split(";")[0].trim();
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(p);
  }
  const lines: string[] = [
    "# How good research happens — working principles",
    "",
    "These are distilled from Hamming, Christiano, Nanda, Carlini, Muehlhauser's",
    "reasoning-transparency rubric, the measurement-validity essay, and pengsida's",
    "learning_research. Honor them when doing research work here.",
    "",
  ];
  for (const p of PRINCIPLES) {
    lines.push(`- **${p.imperative}** — ${p.why} _(${p.source.split(";")[0].trim()})_`);
  }
  return lines.join("\n");
}
