import type { MindmapNode } from "@/lib/types";
import type { OperationDiagnostic } from "./operation-result";
import { INBOX_GUIDANCE } from "./agent-inbox-contract";
import { MAX_HTML_CARD_LENGTH } from "@/lib/mindmap/html-card";

export const HTML_CARD_GUIDANCE = `For a visual card, make the graphic the body itself. Use the card title for its subject and give the plotting area most of the available space. Use short, legible labels for the marks, axes and units. Put the takeaway beside the graphic as card text and supporting prose in collapsed Notes. For optional exact values, put an SVG <title> inside the relevant mark for native mouseover. Keep the main finding and material uncertainty readable at normal map zoom and on touch. Default to the OpenBar card palette (violet #785ef0, blue #648fff, pink #dc267f, orange #fe6100, amber #ffb000), using only the colors the comparison needs. Follow the user's preferred colors when specified. For a multi-panel report, extract the comparison the card needs and give independently useful panels their own child cards. Render a table as HTML table elements in HTML or a pipe table in Markdown.

Add or patch an ordinary card with presentation.contentFormat:"html", a plain title and self-contained HTML/inline SVG in text. Use an SVG viewBox cropped to the drawing. Source is limited to ${MAX_HTML_CARD_LENGTH.toLocaleString("en-US")} UTF-16 code units. OpenBar sanitizes the body and fits visuals within 440 × 240 CSS pixels. Humans can comment, copy or paste the graphic, and edit Notes. Paper TODO cards use TeX. Example bar markup: <rect x="0" y="0" width="72" height="12" fill="#785ef0"><title>Completed: 72 of 100</title></rect>.`;

export const EXPERIMENT_WRITING_GUIDANCE = `A single experiment may occupy the whole day. Before a long run, ask which sentence, figure, or table cell its outcome could change. Reuse the existing paper TODO at that point, or leave one small placeholder when the work has a clear place in the argument. Exploration can stay on a draft card. While the run is in progress, leave that placeholder alone. When evidence or the research decision changes, use the run artifact to draft the smallest update at the same location. For example, fill a pending cell with the verified numerator and denominator. If a run fails before evaluation, keep the cell pending and link the diagnostic from the same task. Polish the surrounding prose when the argument is ready.`;

export const PROJECT_DELIVERY_GUIDANCE = `Deliver useful structure early and refine it as work progresses. Choose the presentation that makes the project's direction, planned scope, known results, and remaining work quickest to understand.

${EXPERIMENT_WRITING_GUIDANCE}

Mindmap structure: Use meaningful branching relationships in the project's own terms. Write concise prose cards, use child cards for distinct topics, and put supporting detail in collapsed Notes. Definitions, explanations, and conclusions belong in prose cards or Notes. For example, an Evaluation branch can have Dataset coverage, Method/model results, and Failure analysis children, with scoring details in Notes on the relevant card.

Comparison tables: Use tables selectively for genuine two-dimensional comparisons. Give both axes meaningful roles, such as methods down rows and models across columns, with measured results at their intersections. Choose axes that make comparisons useful. Retain prose cards and branches for their explanatory and organizational roles. Let tables size to their contents. Set a fixed card width only for an intentional layout. For a Markdown table on an ordinary card, set presentation.contentFormat to "markdown" when adding or patching the card and verify the saved format.

Visible incompleteness: Both the mindmap and manuscript should visibly reflect unfinished work. Preserve intended branches, sections, comparisons, table rows and columns, and figures while evidence arrives. Keep empty or explicitly pending result cells, unresolved questions, TODOs, and sentence placeholders beside the relevant argument. Fill entries as evidence becomes available. Preserve verified results and stable TODO identities during reorganization, and expose gaps reopened by scope changes.

Illustrative comparison matrix, with placeholders for results:

| Method / Model | Model 1 | Model 2 | Model 3 |
| --- | --- | --- | --- |
| Method 1 | [measured result] | | |
| Method 2 | | [PENDING] | |
| Method 3 | | | [UNKNOWN] |

An empty cell keeps an evidence gap open. [PENDING] identifies planned work awaiting execution or a result. [UNKNOWN] identifies an outcome unresolved by the available evidence. A measured zero is recorded as 0 with its metric and supporting evidence. Keep these meanings distinct.

Sentence placeholder example: "On [DATASET], [METHOD] achieves [RESULT PENDING], measured by [METRIC]."`;

export const MINDMAP_CARD_SHORT_REMINDER = `Keep visible card titles short (<=10 words) and bodies concise (<=80 words, a compact comparison table, or a readable inline HTML/SVG visual). Put reasoning, derivations, run configs, caveats, and long context in caption (collapsed Notes). Attach provenance links via refs[] instead of pasting raw paths/URLs into prose. For Markdown tables set presentation.contentFormat="markdown". Mark abandoned ideas or failed runs with presentation.progress="ditched" and record why in caption.`;

export const MINDMAP_CARD_GUIDANCE = `${PROJECT_DELIVERY_GUIDANCE} ${HTML_CARD_GUIDANCE}

Card attention budget: Keep visible card titles short (<=10 words) and visible body prose <=80 words (1–3 crisp sentences, a compact comparison table, or a readable inline HTML/SVG visual). Put reasoning, why an answer holds, methods, run configs, caveats, and supporting detail in caption (the collapsed Notes section). Keep each research fact in one useful card: extend an existing relevant card rather than duplicating, and use child cards for distinct subtopics or independently useful results. Attach provenance via refs[] (paper-section, paper-comment, figure, wiki-page, file, web) instead of pasting raw paths or URLs into prose. For manuscript work, read the saved paper TODOs and current map first: use link-todo {id,todoId} to connect an existing card to its canonical paper TODO, place-todo {todoId,parentId} to place an unplaced TODO as a child (repeat placement returns the existing card), move to relocate it, and verify saved IDs. Mark failed ablations or abandoned ideas with presentation.progress="ditched" and note why in caption instead of silently deleting them. Prefer Agent draft cards for new answers, explanations, and supporting material. Keep key findings, consequential risks, and factual uncertainty visible. Apply this quietly without lecturing the user about card length.`;

export const MINDMAP_WRITING_SKILL_ID = "mindmap-writing";
export const MINDMAP_WRITING_REFERENCE = `For card writing, comparison tables, and HTML/SVG examples, use read_project_skill with source "openbar" and id "${MINDMAP_WRITING_SKILL_ID}".`;

export const MINDMAP_EDIT_GUIDANCE = `Choose link-todo to bind an existing card or place-todo to place a task under a parent. Repeat placement returns its current card. Use move to relocate it. Verify the saved card and TODO IDs. ${MINDMAP_WRITING_REFERENCE}`;

export const AGENT_GUIDANCE = `${INBOX_GUIDANCE}

get_project_state includes project context, humanDecisions, shared user instructions, and available skills. Use read_project_files and apply_project_edits with current hashes for authored files. Use get_mindmap (pass detail="outline", nodeIds, or ifRevision to avoid re-reading unchanged cards) and apply_mindmap_edits with the current revision for managed cards. Keep visible prose concise (<=80 words), use Agent draft children for distinct contributions, put supporting detail in caption (collapsed Notes), attach provenance in refs[], and mark failed/abandoned work progress="ditched". Preserve human-removed cards as project decisions and ask before recreating similar content unless the current request calls for it. ${MINDMAP_WRITING_REFERENCE}

In the browser, get_editing_session shows writing access before a handoff. Resume edit transfers access at the human's request. release_edit yields it after local work is saved. Native MCP can contribute through revision checks. Make the smallest requested change, preserve other work, and report changed locations. Browser requests also appear in openbar-agent-requests metadata. Connection setup is at /agents.`;

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
  updatedNodes: Array<Pick<MindmapNode, "id" | "todoId" | "title" | "text" | "agentDraft" | "contentFormat">>,
  allNodes: Array<Pick<MindmapNode, "agentDraft">>,
  options: { checkDraftCount?: boolean } = {},
): OperationDiagnostic[] | undefined {
  const warnings: OperationDiagnostic[] = [];
  for (const node of updatedNodes) {
    if (node.todoId || node.contentFormat === "html") continue;
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
