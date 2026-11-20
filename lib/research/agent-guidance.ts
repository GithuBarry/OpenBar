import type { MindmapNode } from "@/lib/types";
import type { OperationDiagnostic } from "./operation-result";
import { INBOX_GUIDANCE } from "./agent-inbox-contract";

export const PROJECT_DELIVERY_GUIDANCE = `Deliver useful structure early and refine it as work progresses. Choose the presentation that makes the project's direction, planned scope, known results, and remaining work quickest to understand.

Mindmap structure: Use meaningful branching relationships in the project's own terms. Write concise prose cards, use child cards for distinct topics, and put supporting detail in collapsed Notes. Definitions, explanations, and conclusions belong in prose cards or Notes. For example, an Evaluation branch can have Dataset coverage, Method/model results, and Failure analysis children, with scoring details in Notes on the relevant card.

Comparison tables: Use tables selectively for genuine two-dimensional comparisons. Give both axes meaningful roles, such as methods down rows and models across columns, with measured results at their intersections. Choose axes that make comparisons useful. Retain prose cards and branches for their explanatory and organizational roles.

Visible incompleteness: Both the mindmap and manuscript should visibly reflect unfinished work. Preserve intended branches, sections, comparisons, table rows and columns, and figures while evidence arrives. Keep empty or explicitly pending result cells, unresolved questions, TODOs, and sentence placeholders beside the relevant argument. Fill entries as evidence becomes available. Preserve verified results and stable TODO identities during reorganization, and expose gaps reopened by scope changes.

Illustrative comparison matrix, with placeholders for results:

| Method / Model | Model 1 | Model 2 | Model 3 |
| --- | --- | --- | --- |
| Method 1 | [measured result] | | |
| Method 2 | | [PENDING] | |
| Method 3 | | | [UNKNOWN] |

An empty cell keeps an evidence gap open. [PENDING] identifies planned work awaiting execution or a result. [UNKNOWN] identifies an outcome unresolved by the available evidence. A measured zero is recorded as 0 with its metric and supporting evidence. Keep these meanings distinct.

Sentence placeholder example: "On [DATASET], [METHOD] achieves [RESULT PENDING], measured by [METRIC]."`;

export const MINDMAP_CARD_SHORT_REMINDER = `Keep visible card titles short (<=10 words) and bodies concise (<=80 words or a compact comparison table). Put reasoning, derivations, run configs, caveats, and long context in caption (collapsed Notes). Attach provenance links via refs[] instead of pasting raw paths/URLs into prose. For Markdown tables, set presentation.contentFormat="markdown". Mark abandoned ideas or failed runs with presentation.progress="ditched" and record why in caption.`;

export const MINDMAP_CARD_GUIDANCE = `${PROJECT_DELIVERY_GUIDANCE}

Card attention budget: Keep visible card titles short (<=10 words) and visible body prose <=80 words (1–3 crisp sentences or a compact comparison table). Put reasoning, why an answer holds, methods, run configs, caveats, and supporting detail in caption (the collapsed Notes section). Keep each research fact in one useful card: extend an existing relevant card rather than duplicating, and use child cards for distinct subtopics or independently useful results. Attach provenance via refs[] (paper-section, paper-comment, figure, wiki-page, web) instead of pasting raw paths or URLs into prose. For Markdown tables, set presentation.contentFormat="markdown". Mark failed ablations or abandoned ideas with presentation.progress="ditched" and note why in caption instead of silently deleting them. Prefer Agent draft cards for new answers, explanations, and supporting material; use paper TODOs for work that belongs in the manuscript. Keep key findings, consequential risks, and factual uncertainty visible. Apply this quietly without lecturing the user about card length.`;

export const AGENT_GUIDANCE = `Start with get_project_state for project context, humanDecisions, and @agent or fast tracked @stat requests. ${INBOX_GUIDANCE} Use read_project_files and apply_project_edits for authored project files, including TeX, BibTeX, figures, scripts and instructions. File writes use exact prior hashes and preserve OpenBar-managed state. Use get_mindmap (pass detail="outline", nodeIds, or ifRevision to avoid re-reading unchanged or irrelevant cards) and apply_mindmap_edits for map state. Coordinate through the current writing tab or revision-checked native MCP. Add Agent draft children while a human edits a card. Inspect get_editing_session before a handoff. Resume edit transfers browser writing access when the human requests it. Release editing access through release_edit after local work is saved. ${MINDMAP_CARD_GUIDANCE} Load relevant skills via read_project_skill before specialized work: rigorous-researcher (experiments, claims, results), paper-writing (TeX drafting), status-report (progress/roadmap), anti-sycophancy (reviews/reversals). Treat human-removed cards as decisions for the current project; ask before recreating substantially similar content unless explicitly requested. Website requests also appear in openbar-agent-requests metadata. Make the smallest requested change and summarize changed locations. Connection setup: /agents.`;

const MAX_VISIBLE_CARD_WORDS = 80;
const UNREVIEWED_DRAFT_WARNING_THRESHOLD = 10;

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function looksLikeMarkdownTable(text: string): boolean {
  return /^\s*\|.+\|\s*$/m.test(text) && /^\s*\|[\s:|-]+\|\s*$/m.test(text);
}

/** Non-blocking attention warnings returned to agents after mindmap writes. */
export function mindmapAttentionWarnings(
  updatedNodes: Array<Pick<MindmapNode, "id" | "todoId" | "title" | "text" | "agentDraft">>,
  allNodes: Array<Pick<MindmapNode, "agentDraft">>,
  options: { checkDraftCount?: boolean } = {},
): OperationDiagnostic[] | undefined {
  const warnings: OperationDiagnostic[] = [];
  for (const node of updatedNodes) {
    if (node.todoId) continue;
    const body = node.text || "";
    if (!body.trim() || looksLikeMarkdownTable(body)) continue;
    const words = countWords(body);
    if (words > MAX_VISIBLE_CARD_WORDS) {
      warnings.push({
        severity: "warning",
        code: "verbose_card_body",
        message: `Card "${node.title || node.id}" has ${words} visible words (budget: <=${MAX_VISIBLE_CARD_WORDS}). Move supporting reasoning, methods, or configs into caption (collapsed Notes) or split into child cards.`,
      });
    }
  }
  if (options.checkDraftCount) {
    const unreviewedDrafts = allNodes.filter((node) => node.agentDraft).length;
    if (unreviewedDrafts >= UNREVIEWED_DRAFT_WARNING_THRESHOLD) {
      warnings.push({
        severity: "warning",
        code: "unreviewed_agent_drafts",
        message: `${unreviewedDrafts} Agent draft cards await human review on this map. Prefer extending or consolidating existing cards before adding more.`,
      });
    }
  }
  return warnings.length ? warnings : undefined;
}
