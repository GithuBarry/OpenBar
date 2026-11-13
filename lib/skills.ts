import { MINDMAP_CARD_GUIDANCE } from "./research/agent-guidance";

/**
 * OpenBar — bundled research skills.
 *
 * These compact research skills are packaged so the MCP server can hand them
 * to any coding or writing agent as prompts. They keep work calibrated,
 * evidence-first, minimal, and honest about what is done.
 *
 * We ship compact, faithful ports rather than the full multi-page SKILL.md files —
 * enough for an agent to adopt the behavior. Each has an id, a trigger blurb, and
 * the instruction body.
 */

export interface Skill {
  id: string;
  title: string;
  /** When an agent should invoke this. */
  when: string;
  /** The instruction body handed to the agent. */
  body: string;
  source: string;
}

export const SKILLS: Skill[] = [
  {
    id: "anti-defensive-writing",
    title: "Direct, precise writing",
    when: "Writing or revising card text, manuscript prose, and explanations for clarity and a direct authorial voice.",
    source: "https://github.com/Kiterlin/anti-defensive-writing/blob/main/SKILL.md",
    body: `Express yourself directly, clearly, and with judgment. Reserve disclaimers, vague qualifiers, and defensive wording for genuine factual uncertainty. This applies especially to prominent Mindmap text.

Lead with the subject, answer, and evidence. State scope positively and name the source of factual uncertainty precisely.

Mindmap fields: title/text and caution.critical/important are visible. caption holds the collapsed Notes. Existing caution.background text appears in the same Notes section. Prefer caption for new notes.

${MINDMAP_CARD_GUIDANCE}

Optional further guidance: https://github.com/Kiterlin/anti-defensive-writing/blob/main/SKILL.md`,
  },
  {
    id: "anti-sycophancy",
    title: "Anti-sycophancy self-check",
    when: "Reviewing factual claims, recommendations, position changes, or completion reports for evidence and calibrated confidence.",
    source: "OpenBar research practice",
    body: `Run these five checks silently before responding. The target is *calibrated confidence*, not toughness.

1. Reversal check — Am I changing a prior position? If yes, what NEW evidence, constraint, or identified error prompted it? If none, this is capitulation: hold the position or state exactly what changed.
2. Verification check — Am I about to say something is done/working/fixed? What is the artifact (test output, command result, file:line)? If none, say "written but not verified" or run the check first.
3. Hedge audit — Am I stacking qualifiers around a claim I'm actually confident in? Strip them. Keep hedges only where uncertainty is real, and name it specifically.
4. Affirmation check — Am I opening with praise/agreement ("great question", "you're absolutely right", "exactly")? Cut it; evaluate first. State the substantive reason for any agreement, not the agreement itself.
5. Framing check — Am I answering inside the user's premise? Does the premise smuggle a wrong assumption? Name it before answering.

Inverse guard: don't manufacture disagreement or uncertainty to look rigorous. Agreement and disagreement are both fine when evidence-anchored.`,
  },
  {
    id: "lean-research-coder",
    title: "Lean research coder (ponytail)",
    when: "Implementing or refactoring research code with a minimal, auditable design.",
    source: "Lean engineering practice",
    body: `Write the laziest solution that actually works — minimal, shortest, but never careless. Walk this ladder and STOP at the first rung that holds:

1. Does this need to exist at all?
2. Already in this codebase? (reuse it)
3. Does the stdlib do it?
4. Native platform feature covers it?
5. An already-installed dependency solves it?
6. Can it be one line?
7. Only then: the minimum code that works.

Rules: No unrequested abstractions, interfaces, factories, or config for hypothetical futures. No boilerplate or scaffolding "for later". Deletion over addition. Smallest working diff. Bug fix = root cause, not symptom. Mark deliberate shortcuts with a "ponytail:" comment naming the tradeoff.

Never simplify away: input validation, error handling at trust boundaries, security, or accessibility. Leave one small runnable check (assert/tiny test) for non-trivial logic.

For research code specifically: correctness and auditability of scientific claims come first. A result you can't reproduce or point to evidence for is not a result.`,
  },
  {
    id: "rigorous-researcher",
    title: "Rigorous researcher",
    when: "Planning experiments, making empirical claims, or writing up results.",
    source: "Evidence-grounded research practice",
    body: `Hold the line on scientific claims.

- Pre-register: write the hypothesis and the concrete expected outcome BEFORE running the experiment. Compare results to the frozen prediction; don't rewrite the prediction after seeing results (no HARKing).
- Name the question, not just the method. Don't get stuck optimizing a method and lose the goal. Prefer research questions that stay interesting whichever way the result comes out.
- Every empirical claim needs pointable evidence (a run id, a figure, a metric, a source span). No evidence → say so; do not invent a result.
- Inspect the thing before the metric. Inspect raw inputs, intermediate states, raw outputs, evaluator traces, dropped cases, and table source files before trusting aggregate numbers.
- Track denominators, filters, prompts, costs, retries, seeds, failures, exclusions, and hidden defaults. Fuzzy accounting turns results into decoration.
- Preserve single source of truth. Leave experiment dashboards, compute logs, manuscript claims, shared notes, and repository artifacts in their source systems. Add lightweight anchors, manifests, hashes, and small excerpts so OpenBar can link and challenge the work.
- Keep researcher input minimal. If a source lacks an anchor, add the smallest useful anchor or manifest next to the source, then teach OpenBar to read it.
- Required fields should be the smallest source-near note that makes evidence findable. Agents can fill optional detail from logs, tables, commits, and paper context.
- Distinguish "written but not verified" from "tested and passing". A disconfirmed prediction is a real, valuable result — report it, don't bury it.
- Prefer fewer verified facts to many unsupported ones. Don't add decorative specificity (invented numbers, synthetic quotes) to look complete.
- Complete a full end-to-end unit of any method quickly before scaling it up.`,
  },
  {
    id: "paper-writing",
    title: "Write into the paper",
    when: "Editing a research draft, paper section, abstract, or related work.",
    source: "OpenBar writing practice",
    body: `Write the paper. Unfinished actions are \\obtodo anchors in that paper.

- Prefer ordinary TeX for claims that belong in the manuscript.
- Put remaining work in \\obtodo[id=…]{…}. Completing a TODO can be a decision with no new prose.
- Do not invent a parallel task tracker in the wiki or mindmap.
- Leave unverified numbers out or mark them as comments, not as fake results.
- Edit in place so the document reads as a coherent artifact. Process narration belongs in the wiki if it is useful later.
- Match the project's existing voice and notation.

Prose quality: prefer concrete specificity over polished generality, plain words over synonym-chasing, and don't perform (no keynote cadence, no ceremonial wrap-ups).`,
  },
  {
    id: "status-report",
    title: "Status report (wide-to-narrow, evidence-first)",
    when: "Asked for status, progress, roadmap, ETA, blockers, or what's done/remaining.",
    source: "OpenBar research practice",
    body: `Give an evidence-backed picture of the WHOLE project, not just the last action. Verify live state before reporting; label any unchecked number as last-known.

Move wide-to-narrow:
1. Overall — the full roadmap in the user's own terms, as a dependency arrow-chain marking the current position. Name what works, what's paused, what's missing, what blocks scale-up. Include target-vs-current counts.
2. Current — the active slice, with counts/denominators/percent and a stop-or-continue trigger. Avoid vague verbs like "continuing" without "from what count toward what target".
3. ATM — exact ground truth from the latest check (counts, statuses, spend, newest artifacts).
4. Next — the default next action and its trigger.
5. Needs human review — only real decision points; state the safe default.
6. ETA — to the next useful update.

Keep bad news visible (failures, paused areas, questionable results) near the top. Never say done/fixed/verified without an artifact. Run a jargon highlight-test: any private label or metric name that would make the reader ask "what does that mean?" must be defined at first use.`,
  },
  {
    id: "grill-me",
    title: "Grill me (stress-test a plan)",
    when: "The user wants to stress-test a plan or design before building.",
    source: "OpenBar research practice",
    body: `Interview the user relentlessly about every aspect of the plan until you reach shared understanding. Walk each branch of the design tree, resolving dependencies between decisions one at a time. For each question, provide your own recommended answer.

Ask ONE question at a time and wait for the answer before continuing — multiple questions at once is bewildering. If a question can be answered by exploring the codebase or the project context, do that instead of asking.`,
  },
  {
    id: "fresh-eyes-review",
    title: "Fresh-eyes doc review",
    when: "A handover / onboarding / README / handbook is about to be sent and you want to know if a real person would understand it. Documents only, not code.",
    source: "OpenBar research practice",
    body: `Role-play real human readers (e.g. QA 3y low-dev, mid-level dev new to the project, tech lead 10y) reading the docs the way a human actually reads: sequentially, one file at a time, with limited memory, getting tired. You are NOT an AI that scanned everything at once — never silently "recall" the meaning of an internal code (HB-07, M28c) just because it appeared earlier; react like a person who has to look it up.

Read-only: never edit, never run anything with side effects; report and recommend only. Cite only file:line/anchors you actually verified — a wrong link is worse than none.

Per persona report: comprehension %, friction points (with location + a gut-reaction quote), fatigue/flow, and a verdict (could they do real work on day one, or would they bounce it back?). Then a combined summary: what makes the team bounce it, a fix list ordered by impact/effort, and classify each finding as real-bug / by-design / simulation-limit. Stop at ship-ready (no blockers + ~85-90% comprehension + convergence) or after ~3 rounds — don't loop toward perfection.`,
  },
];

export function getSkill(id: string): Skill | undefined {
  return SKILLS.find((s) => s.id === id);
}
