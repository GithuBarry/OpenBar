import { EXPERIMENT_WRITING_GUIDANCE, MINDMAP_CARD_GUIDANCE, MINDMAP_WRITING_REFERENCE, MINDMAP_WRITING_SKILL_ID, PAPER_PROSE_GUIDANCE } from "./research/agent-guidance";

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
    id: MINDMAP_WRITING_SKILL_ID,
    title: "Write mindmap cards and visuals",
    when: "Creating or revising prose cards, paper TODO links, comparison matrices, or compact HTML/SVG visuals.",
    source: "OpenBar writing practice",
    body: MINDMAP_CARD_GUIDANCE,
  },
  {
    id: "anti-defensive-writing",
    title: "Direct, precise writing",
    when: "Writing or revising card text, manuscript prose, and explanations for clarity and a direct authorial voice.",
    source: "https://github.com/Kiterlin/anti-defensive-writing/blob/main/SKILL.md",
    body: `Express yourself directly, clearly, and with judgment. Reserve disclaimers, vague qualifiers, and defensive wording for genuine factual uncertainty. This applies especially to prominent Mindmap text.

Lead with the subject, answer, and evidence. State scope positively and name the source of factual uncertainty precisely.

Mindmap fields: title/text are visible. caption holds the collapsed Notes. Existing caution.background, caution.critical, and caution.important text appears in the same Notes field. Prefer caption for new notes.

${MINDMAP_WRITING_REFERENCE}

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
    title: "Lean research coder",
    when: "Implementing, reviewing, or refactoring ML/CS research code with faithful protocols, lean implementations, explicit experimental choices, and auditable outputs.",
    source: "OpenBar research coding practice",
    body: `Apply scientific judgment to implementation. Pairs with \`rigorous-researcher\` during research coding and remains self-contained for executable behavior.

## Preserve the scientific object
- Identify the protocol and behavior affected by the change. Preserve task semantics, information access, dataset membership, training/evaluation boundaries, and measurement definitions.
- Use the original benchmark harness or reference implementation when available and appropriate. Make scientifically meaningful deviations explicit.
- Never silently override decoding or harness defaults—such as forcing \`temperature=0\`, setting an arbitrary \`max_tokens\`/\`max_len\` cap, altering \`top_p\`, or capping tool rounds/turns—without the researcher's explicit knowledge and approval. Follow official model/benchmark defaults and surface any cap or deviation before running.
- Keep comparisons fair across data access, prompts, budgets, settings, retries, and stopping rules. Inspect relevant prior code and papers when their details determine implementation correctness.

## Keep implementation lean
- Prefer maintained libraries, official APIs, and native harnesses. Keep custom logic small, explicit, and close to the method's concepts.
- Scope cleanup to the requested work and its dependencies. Every abstraction must earn its place through reproducibility, auditability, or clarity; avoid speculative scaffolding.
- Expose evidence-affecting choices through the project's existing configuration or experiment specification. Record effective defaults, randomness, sampling rules, budgets, and model/data revisions, reusing existing conventions.

## Preserve failure meaning
- Surface missing artifacts, malformed examples, invalid configuration, evaluator mismatches, and unexpected truncation. Fail the affected operation when its scientific assumptions break, or retain an explicit failure record when the protocol calls for continuing.
- Any recovery path must preserve scientific meaning and remain visible in the evidence. Keep failed and excluded cases with their reasons and denominators.
- Use assertions for concrete scientific invariants. Never simplify away input validation, auditability, or security.

## Verify the affected evidence
- Run checks proportional to the change within the authorized budget. Inspect raw examples and outputs when transformations, parsing, or evaluation change.
- Trace reported measurements to code state, commands, configuration, data, seeds or sampling rules, and raw artifacts.
- Keep disposable checks in temporary locations or the project's established development area. Preserve evidence-producing workflows and outputs according to project conventions. Scale experiments along axes needed to assess the requested claim.

## Complete the requested work
- Continue through implementation, relevant execution, inspection, and repairs within scope. Report implemented behavior, executed checks, produced evidence, and material remaining limitations.
- Distinguish implementation readiness, diagnostic results, and completed experiments in status reports.
- Use a design interview (\`grill-me\`) when requested for consequential unresolved choices; otherwise ask focused questions only where missing information materially blocks progress.`,
  },
  {
    id: "rigorous-researcher",
    title: "Rigorous research agent",
    when: "Applying rigorous scientific judgment during ML/LLM research planning, coding, experiments, analysis, and writing, aligning claims with informative evidence.",
    source: "OpenBar research practice",
    body: `Make the research truer, sharper, and easier to audit across planning, coding, experiments, analysis, and writing. Pairs with \`lean-research-coder\` during implementation.

${EXPERIMENT_WRITING_GUIDANCE}

## Choose informative work
- Identify the scientific uncertainty and choose the action most likely to change the decision. Give every experiment a clear role: main comparison, baseline, ablation, stress test, or sensitivity check.
- Respect the requested scope, available budget, and stopping condition. Complete a full end-to-end unit quickly before scaling up.
- State claims through their conditions, comparisons, measurements, and implications. Give baselines serious consideration and keep comparisons fair.
- Pre-register the hypothesis and concrete expected outcome before running; compare results to the frozen prediction (no HARKing). Separate exploratory observations from results produced under a fixed evaluation protocol.

## Ground claims in evidence
- Match the strength of a claim to the evidence actually produced. Every empirical claim needs pointable evidence (run id, figure, metric, source span); no evidence → say so and never invent decorative specificity.
- Inspect the thing before the metric: check raw inputs, transformations, outputs, evaluator traces, failures, exclusions, and table sources where they could change the conclusion. Trace consequential numbers through measurement to the underlying cases.
- Account for denominators, filters, prompts, sampling/length settings, costs, retries, seeds, and missing cases when they affect interpretation. Never silently force \`temperature=0\`, set arbitrary \`max_tokens\`/\`max_len\` or turn caps, or trim inputs/outputs without the researcher's explicit knowledge—disclose effective defaults and truncation rates alongside results. Investigate leakage, drift, truncation, parser shortcuts, and alternative explanations.
- Preserve executed evidence and single source of truth in source systems, adding lightweight source-near anchors, manifests, hashes, and small excerpts so OpenBar can link and challenge the work.

## Keep uncertainty visible
- Call out compromised comparisons and unsupported conclusions, explain their consequence, and identify the evidence needed to resolve them. Label missing evidence and incomplete work explicitly (empty cells, [PENDING], [UNKNOWN], measured 0).
- Choose failure handling that preserves scientific meaning. Keep invalid, failed, and disconfirmed cases visible instead of burying them.
- Clearly label planning artifacts, development diagnostics, and completed experiments, and distinguish "written but not verified" from "tested and passing".

## Write and finish with precision
- Connect motivation, claim, evidence, and implication. Keep operational details in the audit trail (collapsed mindmap Notes or wiki, never manuscript .tex prose) and limitations near the claims they qualify. State what the reader should believe and how far the evidence reaches.
- Continue requested work through authorized analysis, verification, and repairs until the deliverable is supported by inspected evidence with explicit limitations. Report exact dependency or budget blockers when stopped, and treat further ideas as follow-up work unless required for the requested claim.

## Optional references
- Paper argument and structure: https://www.alignmentforum.org/posts/eJGptPbbFPZGLpjsp/highly-opinionated-advice-on-how-to-write-ml-papers (Neel Nanda)
- Training and debugging neural networks: https://karpathy.github.io/2019/04/25/recipe/ (Andrej Karpathy)
- Research code release: https://github.com/paperswithcode/releasing-research-code (Papers with Code)`,
  },
  {
    id: "paper-writing",
    title: "Write into the paper",
    when: "Editing a research draft, paper section, abstract, or related work.",
    source: "OpenBar writing practice",
    body: `Write the paper. Unfinished actions are \\obtodo anchors in that paper.

${PAPER_PROSE_GUIDANCE}

Before a long run, mark the sentence, figure or cell it could change. Return to that spot when evidence arrives. Keep planned sections and comparison axes visible as the paper grows.

${MINDMAP_WRITING_REFERENCE}

- Prefer ordinary TeX for claims that belong in the manuscript.
- Put remaining work in \\obtodo[id=…]{…}. Completing a TODO can be a decision with no new prose.
- Do not invent a parallel task tracker in the wiki or mindmap.
- Keep unmeasured results visibly marked with sentence placeholders or pending cells beside the relevant argument. Fill values from verified evidence, retaining measured zero and unresolved outcomes as distinct states.
- Edit in place so the document reads as a coherent artifact. Process narration, version history, and harness paths belong in collapsed mindmap Notes or the wiki if useful later.
- Match the project's existing voice and notation.

Prose quality: prefer concrete specificity over polished generality, plain words over synonym-chasing, and don't perform (no keynote cadence, no ceremonial wrap-ups).
Optional reference on ML paper argument and structure: https://www.alignmentforum.org/posts/eJGptPbbFPZGLpjsp/highly-opinionated-advice-on-how-to-write-ml-papers (Neel Nanda).`,
  },
  {
    id: "status-report",
    title: "Status report (wide-to-narrow, evidence-first)",
    when: "Asked for status, progress, roadmap, ETA, blockers, or what's done/remaining.",
    source: "OpenBar research practice",
    body: `Give an evidence-backed picture of the WHOLE project, not just the last action. Verify live state before reporting; label any unchecked number as last-known.

Report a long run when evidence, scope or the next decision changes. Keep planned, unknown and measured outcomes distinguishable. ${MINDMAP_WRITING_REFERENCE}

Move wide-to-narrow:
1. Overall — the full roadmap in the user's own terms. Use a dependency chain to show direction and gaps, marking the current position. Use a comparison matrix when both axes carry meaningful comparison roles. Name what works, what's paused, what's missing, what blocks scale-up. Include target-vs-current counts.
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

const SKILL_ALIASES: Record<string, string> = {
  "research-mindset": "rigorous-researcher",
  "rigorous-research-agent": "rigorous-researcher",
};

export function getSkill(id: string): Skill | undefined {
  const canonical = SKILL_ALIASES[id] || id;
  return SKILLS.find((s) => s.id === canonical);
}
