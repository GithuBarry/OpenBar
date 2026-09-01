export interface SourceGrounding {
  id: string;
  source: string;
  whyThisSource: string;
  platformPrinciple: string;
  agentBehavior: string;
  productBehavior: string;
  url?: string;
}

export const SOURCE_GROUNDINGS: SourceGrounding[] = [
  {
    id: "karpathy-llm-wiki",
    source: "Andrej Karpathy, LLM Wiki gist",
    whyThisSource: "It names the core pattern: raw sources stay authoritative, agents compile them into an interlinked Markdown wiki, and knowledge compounds through index, log, links, and lint passes.",
    platformPrinciple: "OpenBar wiki is the agent-maintained research memory that sits between source files and project decisions.",
    agentBehavior: "Read sources, update durable pages, update index/log, link entities and claims, and mark contradictions or stale beliefs in place.",
    productBehavior: "Expose wiki pages, source refs, pinned agent context, and lint checks while keeping the human interface light.",
    url: "https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f",
  },
  {
    id: "hamming-important-problems",
    source: "Richard Hamming, You and Your Research",
    whyThisSource: "It grounds the highest-level taste question: work on important problems where you have an attack.",
    platformPrinciple: "Project choice matters more than task completion.",
    agentBehavior: "Ask why this project matters and what concrete attack makes it tractable.",
    productBehavior: "Review pages should rank research bets and show continue, pivot, pause, or kill decisions.",
  },
  {
    id: "peyton-jones-writing",
    source: "Simon Peyton Jones, How to Write a Great Research Paper",
    whyThisSource: "It frames writing as the way to clarify ideas and tie claims to evidence.",
    platformPrinciple: "The paper is the final synthesis of supported claims.",
    agentBehavior: "Keep prose scoped to claims and evidence. Use notes/wiki before paper synthesis when evidence is weak.",
    productBehavior: "Draft-status tooling and the editable mindmap surface claim, evidence, objection, and section links without treating planning nodes as proof.",
  },
  {
    id: "neurips-checklist",
    source: "NeurIPS Paper Checklist",
    whyThisSource: "It states reviewer expectations for claim scope, limitations, reproducibility, and experimental details.",
    platformPrinciple: "Every claim needs support, scope, limitations, and reproducible artifacts.",
    agentBehavior: "Block broad claims until raw evidence, baselines, limitations, and reproduction details exist.",
    productBehavior: "MCP gates and review pages highlight raw-inspection gaps and weak support.",
  },
  {
    id: "nih-lab-notebook",
    source: "NIH electronic lab notebook guidance",
    whyThisSource: "It grounds the recordkeeping norm: full process, raw data, failed runs, corrections, and enough detail to reproduce.",
    platformPrinciple: "Research memory must preserve raw artifacts and failed evidence.",
    agentBehavior: "Record raw inputs, intermediate states, raw outputs, failures, exclusions, and corrections.",
    productBehavior: "Evidence refs point to authoritative artifacts and selected excerpts, not copied summaries.",
  },
  {
    id: "anthropic-context-engineering",
    source: "Anthropic context engineering guidance",
    whyThisSource: "It explains why agent quality depends on retrieving the right context at the right time.",
    platformPrinciple: "OpenBarry is a context compiler for agents.",
    agentBehavior: "Load wiki/context first, then fetch raw sources on demand with narrow queries.",
    productBehavior: "MCP exposes project context, wiki pages, source refs, and challenge gates.",
  },
  {
    id: "openai-evals",
    source: "OpenAI eval-driven development guidance",
    whyThisSource: "It grounds the habit of explicit success criteria, adversarial cases, and continuous checks.",
    platformPrinciple: "Good experiments decide between beliefs.",
    agentBehavior: "Define success criteria, inspect failures, and turn failures into eval cases.",
    productBehavior: "Prereg, raw inspection, and challenge queues keep eval quality visible.",
  },
  {
    id: "wandb-artifacts",
    source: "Weights & Biases Artifacts",
    whyThisSource: "It gives a maintained source of truth for runs, tables, inputs, outputs, and lineage.",
    platformPrinciple: "External artifact systems remain authoritative.",
    agentBehavior: "Link runs, tables, and artifacts by id, hash, and small excerpts. Avoid copying full source tables into OpenBar.",
    productBehavior: "Source manifests and evidence refs preview W&B artifacts lightly.",
  },
];

export function sourceGroundingMarkdown() {
  return [
    "# OpenBar Source Grounding",
    "",
    "Every principle should trace to a named source and a concrete behavior. Future agents should load this before changing the research workflow.",
    "",
    ...SOURCE_GROUNDINGS.flatMap((entry) => [
      `## ${entry.source}`,
      "",
      `- id: ${entry.id}`,
      `- why this source: ${entry.whyThisSource}`,
      `- platform principle: ${entry.platformPrinciple}`,
      `- agent behavior: ${entry.agentBehavior}`,
      `- product behavior: ${entry.productBehavior}`,
      ...(entry.url ? [`- url: ${entry.url}`] : []),
      "",
    ]),
  ].join("\n");
}
