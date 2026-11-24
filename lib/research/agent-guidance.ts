import type { MindmapNode } from "@/lib/types";
import type { OperationDiagnostic } from "./operation-result";
import { ANSWER_CARD_GUIDANCE, INBOX_GUIDANCE } from "./agent-inbox-contract";
import { MAX_HTML_CARD_LENGTH } from "@/lib/mindmap/html-card";

export const HTML_CARD_GUIDANCE = `For a visual card, make the graphic the body itself. Use the card title for its subject and give the plotting area most of the available space. Use short, legible labels for the marks, axes and units. Put the takeaway beside the graphic as card text and supporting prose in collapsed Notes. For optional exact values, put an SVG <title> inside the relevant mark for native mouseover. Keep the main finding and material uncertainty readable at normal map zoom and on touch. Default to the OpenBar card palette (violet #785ef0, blue #648fff, pink #dc267f, orange #fe6100, amber #ffb000), using only the colors the comparison needs. Follow the user's preferred colors when specified. For a multi-panel report, extract the comparison the card needs and give independently useful panels their own child cards. Render a table as HTML table elements in HTML or a pipe table in Markdown.

Add or patch an ordinary card with presentation.contentFormat:"html", a plain title and self-contained HTML/inline SVG in text. Use an SVG viewBox cropped to the drawing. Source is limited to ${MAX_HTML_CARD_LENGTH.toLocaleString("en-US")} UTF-16 code units. OpenBar sanitizes the body and sizes it to the card width and content height. Humans can comment, copy or paste the graphic, and edit Notes. Paper TODO cards use TeX. Example bar markup: <rect x="0" y="0" width="72" height="12" fill="#785ef0"><title>Completed: 72 of 100</title></rect>.`;

export const PAPER_PROSE_GUIDANCE = `Manuscript .tex prose must read like a finished scientific paper for an external peer reviewer—never an internal engineering diary or lab log.
- Connect motivation, claim, evidence, and implication: state what the reader should believe and how far the evidence reaches, keeping limitations near the claims they qualify and separating exploratory observations from fixed-protocol results.
- NEVER put internal iteration or version labels for your own method, prompts, or experiments (such as "v1", "v2", "v3", "OPF v2", "trace-repaired v2", "phase 2", "wave 3", "round 2", "smoke", "confirmatory", "T7") in manuscript prose, headings, tables, or captions. (Pinned third-party benchmark, model, or API names such as "AgentDojo v1.2.2" or "Llama 3.1" are fine when citing external software.)
- Present your method as one coherent final design named by what it does, not as a chronological patch log of bugs fixed between v1 and v2. When comparing an earlier variant or fix matters scientifically, frame it cleanly as a named component ablation (e.g., "without subject-length gating" or "without catalog-tool exemption"), never "v1" vs. "repaired v2".
- Keep operational and harness details in the audit trail (collapsed mindmap Notes or wiki), never in .tex prose: no local script paths (scripts/run_*.py), output filenames (post_env.json, verdict.json), SQLite/spend ledgers, shard/cell bookkeeping ("720 cells", "0 technical failures"), or run IDs.`;

export const EXPERIMENT_WRITING_GUIDANCE = `Give every experiment an explicit role (main comparison, baseline, ablation, stress test, or sensitivity check), keep comparisons fair across data access, prompts, budgets, retries, and stopping rules, and separate exploratory observations from fixed-protocol results. Never silently override decoding or harness defaults—such as forcing temperature=0, imposing an arbitrary max_tokens/max_len cap, or capping agent turns—without the researcher's explicit knowledge; follow model/benchmark defaults and disclose any cap or truncation rate. A single experiment may occupy the whole day. Before a long run, ask which sentence, figure, or table cell its outcome could change. Reuse the existing paper TODO at that point, or leave one small placeholder when the work has a clear place in the argument. Exploration can stay on a draft card. While the run is in progress, leave that placeholder alone. When evidence or the research decision changes, inspect raw outputs/traces and use the run artifact to draft the smallest update at the same location—filling pending cells with verified numerators and denominators, keeping failed or excluded cases visible with their reasons, and never letting compromised comparisons pass as valid. Keep internal version tags (v1/v2), harness scripts, and run-log bookkeeping in collapsed mindmap Notes or wiki—never in manuscript .tex prose. Polish the surrounding prose when the argument is ready.`;

const CARD_PRESENTATION_GUIDANCE = `State the takeaway in one sentence a new reader can understand. Quantify changes against a named baseline on a stated sample. Use prose for a simple fact, a table for exact comparisons, or a labeled chart for a pattern. Keep headings short. Give shared units or denominators once per column, and split long labels across lines with <br> in Markdown tables. When stacking multiple metrics in one Markdown table row, use explicit <br> breaks in both the label cell and every value cell so corresponding numbers stay line-aligned across columns (avoid "/" lists that wrap unpredictably into 2 vs. 3 lines), or split metrics into separate rows/columns. Wrap optional hover details (CIs, sample sizes, caveats) in ((detail)) anywhere in Markdown to render an (i) mouseover tooltip. Show uncertainty and evidence gaps beside the values. Keep essential color keys with the graphic and navigation hints beside their controls.`;

export const PROJECT_DELIVERY_GUIDANCE = `Deliver useful structure early and refine it as work progresses. Choose the presentation that makes the project's direction, planned scope, known results, and remaining work quickest to understand.

${EXPERIMENT_WRITING_GUIDANCE}

Mindmap structure: Use meaningful branching relationships in the project's own terms. Write concise prose cards, use child cards for distinct topics, and put supporting detail in collapsed Notes. Definitions, explanations, and conclusions belong in prose cards or Notes. For example, an Evaluation branch can have Dataset coverage, Method/model results, and Failure analysis children, with scoring details in Notes on the relevant card.

${CARD_PRESENTATION_GUIDANCE}

Comparison tables: Use tables selectively for genuine two-dimensional comparisons. Give both axes meaningful roles, such as methods down rows and models across columns, with measured results at their intersections. For example, give tasks passed and tasks reached separate columns when the denominators differ. Markdown tables support <br> for explicit line breaks inside headers and cells: whenever a row stacks multiple metrics, put <br> between every metric in both the metric label cell and every value cell (e.g., \`Score<br>Lit Leak<br>MCQ\` beside \`36.5%<br>100%<br>100%\` and \`**36.4%**<br>**53%**<br>**84.5%**\`) rather than "/" separators that wrap some columns to 2 lines and others to 3, or give each metric its own row/column. Use \`((detail))\` inside cells or headers to attach an (i) mouseover tooltip for confidence intervals, denominators, or caveats without widening columns. Let tables size to their contents. Set a fixed card width only for an intentional layout. For a Markdown table on an ordinary card, set presentation.contentFormat to "markdown" when adding or patching the card and verify the saved format.

Visible incompleteness: Both the mindmap and manuscript should visibly reflect unfinished work. Preserve intended branches, sections, comparisons, table rows and columns, and figures while evidence arrives. Keep empty or explicitly pending result cells, unresolved questions, TODOs, and sentence placeholders beside the relevant argument. Fill entries as evidence becomes available. Preserve verified results and stable TODO identities during reorganization, and expose gaps reopened by scope changes.

Illustrative comparison matrix, with placeholders for results:

| Method / Model | Model 1 | Model 2 | Model 3 |
| --- | --- | --- | --- |
| Method 1 | [measured result] | | |
| Method 2 | | [PENDING] | |
| Method 3 | | | [UNKNOWN] |

An empty cell keeps an evidence gap open. [PENDING] identifies planned work awaiting execution or a result. [UNKNOWN] identifies an outcome unresolved by the available evidence. A measured zero is recorded as 0 with its metric and supporting evidence. Keep these meanings distinct.

Sentence placeholder example: "On [DATASET], [METHOD] achieves [RESULT PENDING], measured by [METRIC]."`;

export const MINDMAP_CARD_SHORT_REMINDER = `Aim for short titles and about 80 words or fewer of visible prose. A compact table, a readable graphic, or longer prose can serve the finding. Put reasoning, derivations, run configs, local script/result file paths, caveats, and long context in caption (collapsed Notes). Use refs[] only for clickable links (web URLs, paper-section, paper-todo, paper-comment, mindmap-node, wiki-page, or manuscript figure images/PDFs) — do not attach local code/data files as refs. For Markdown tables set presentation.contentFormat="markdown". Mark abandoned ideas or failed runs with presentation.progress="ditched" and record why in caption.`;

export const MINDMAP_CARD_GUIDANCE = `${PROJECT_DELIVERY_GUIDANCE} ${HTML_CARD_GUIDANCE}

${ANSWER_CARD_GUIDANCE}

Fan-out & progressive depth: Keep direct children under a card scannable instead of appending an unbounded flat wall of siblings. When a branch grows crowded, introduce intermediate grouping cards (for example: headline takeaway -> evidence table -> ablations / diagnostics). Keep top-level headline cards brief and readable when zoomed out, and nest wide comparison tables or deep detail beneath them.

Supersede & archive workflow: Avoid leaving smoke tests, earlier prototypes, or retired trials sitting next to final results at equal prominence. When an experiment scales up or replaces an earlier run, patch the existing card in place or move superseded runs into a dedicated Archive branch styled with presentation: { shape: "archive", defaultCollapsed: true }. Set presentation: { defaultCollapsed: true } (alias collapsed: true) on Archive branches and deep evidence subtrees so the map opens calm on first visit.

Fold answered @agent / @stat threads: Never leave answered @agent or @stat prompt-reply threads as top-level siblings — fold the answer into the owning or parent card (removing the mention from visible copy), keep the original ask once in caption (collapsed Notes), and archive or resolve any leftover scratch card.

Card mentions: Mention another card on the same map inline with [[card-id]], [[card-id|Label]], or [Label](#card-id) (or refs[] with kind "mindmap-node"). Hovering a card mention previews the target card and either draws a reference curve when visible or reports how many hidden cards will expand on jump.

Inline hover notes: Anywhere in Markdown (cards, tables, Notes, or wiki pages), wrap concise supplemental detail in ((Some detail here)) to render a compact (i) icon that reveals the text on mouseover — useful for confidence intervals, denominators, or brief caveats beside compact values. Formatting (**bold**, \`code\`, <br>) works inside ((...)) as well.

Card attention budget: Aim for short titles and about 80 words or fewer of visible prose. Use a table, graphic or longer explanation when it helps the reader. Put reasoning, why an answer holds, methods, run configs, local script/result file paths, caveats, and supporting detail in caption (the collapsed Notes section). Keep each research fact in one useful card: extend an existing relevant card rather than duplicating, and use child cards for distinct subtopics or independently useful results. Attach clickable links via refs[] only for supported targets (web URLs, paper-section, paper-todo, paper-comment, mindmap-node, wiki-page, and manuscript figure images/PDFs); do not put local code, JSON, CSV, or experiment files in refs[] (the asset endpoint only serves manuscript images and PDFs, so local file links 404 — record those paths in caption instead). For manuscript work, read the saved paper TODOs and current map first: use link-todo {id,todoId} to connect an existing card to its canonical paper TODO, place-todo {todoId,parentId} to place an unplaced TODO as a child (repeat placement returns the existing card), move to relocate it, and verify saved IDs. Mark failed ablations or abandoned ideas with presentation.progress="ditched" and note why in caption instead of silently deleting them. Prefer Agent draft cards for new answers, explanations, and supporting material. Keep key findings, consequential risks, and factual uncertainty visible. Length hints in write results are optional for agents. Offer card-length advice to people when they request it.`;

export const MINDMAP_WRITING_SKILL_ID = "mindmap-writing";
export const MINDMAP_WRITING_REFERENCE = `For card writing, comparison tables, and HTML/SVG examples, use read_project_skill with source "openbar" and id "${MINDMAP_WRITING_SKILL_ID}" (see also bundled skills "rigorous-researcher", "lean-research-coder", and "paper-writing").`;

export const MINDMAP_EDIT_GUIDANCE = `Use link-todo to bind an existing card or place-todo to place an unplaced TODO (repeat placement returns the existing card); move relocates it. ${MINDMAP_WRITING_REFERENCE}`;

/** Sent on native MCP initialize (excludes browser-only WebMCP session tools). */
export const MCP_INSTRUCTIONS = `${INBOX_GUIDANCE}
When asked to watch OpenBar, MCP Events clients can subscribe to openbar.inbox.mention (for @agent/@stat mentions) and openbar.git.conflict (for Git sync and saved-file mindmap/paper conflicts) — pass {project} for one project, {projects:[...]} for specific projects, or {} for all accessible projects, with once:false for continuous wakes — then call check_inbox immediately for pending work and on each mention wake. When an openbar.git.conflict event or conflict alert arrives, inspect the conflict (sync_project action="inspect" / "review_pull" for Git conflicts, or get_project_state / get_mindmap for saved-file conflicts) and resolve it if you are confident nothing (including unsaved human edits) will be lost; otherwise summarize what conflicted and wait for the human to tell you what to do.

${CARD_PRESENTATION_GUIDANCE}

Workflow: start with get_project_state (context, humanDecisions, instructions, skills). Use read_project_files / apply_project_edits with exact hashes for authored files (including TeX TODO wording/completion). Manuscript .tex prose must read for an external peer reviewer—NEVER include internal iteration/version labels for your own method or runs ("v1", "v2", "v3", "repaired", "wave", "smoke", "confirmatory"), local harness script paths or JSON/SQLite filenames, or execution-log bookkeeping ("0 technical failures", "cells") in .tex prose, headings, captions, or tables; present one coherent final design and frame comparisons as named component ablations (read_project_skill source="openbar" id="paper-writing"; external third-party benchmark/model/API versions are fine). Use get_mindmap (pass detail="outline", nodeIds, or ifRevision to save tokens) and apply_mindmap_edits with current revision for map cards. Aim for short titles and concise visible prose, keep branches scannable with progressive depth (group crowded sibling lists under intermediate headline/evidence/diagnostics cards and nest wide tables beneath concise headline cards), patch in place or move superseded smoke/prototype runs into an Archive branch with presentation:{shape:"archive",defaultCollapsed:true}, fold answered @agent/@stat replies into their owning card instead of leaving top-level Q&A siblings, mention related cards inline with [[card-id]] or [[card-id|Label]], put reasoning/details and local script/data file paths in caption (collapsed Notes), use refs[] only for clickable links (web URLs, paper/map/wiki refs, manuscript figures — never local code/data files), leave cardWidth unset for prose cards, and mark failed/abandoned work progress="ditched". Respect human-removed cards as decisions (ask before recreating). Make the smallest requested change and report changed locations. ${MINDMAP_WRITING_REFERENCE}`;

/** Full guidance for browser pages and meta discovery (adds browser WebMCP session handoff). */
export const AGENT_GUIDANCE = `${MCP_INSTRUCTIONS}

Browser WebMCP: check get_editing_session before a handoff; Resume edit transfers access on human request, release_edit yields it after saving. Pending requests also appear in openbar-agent-requests metadata. Setup: /agents.`;

const UNREVIEWED_DRAFT_WARNING_THRESHOLD = 10;

/** Mention the review backlog once when an addition crosses its threshold. */
export function mindmapDraftWarnings(
  beforeNodes: readonly Pick<MindmapNode, "agentDraft">[],
  allNodes: readonly Pick<MindmapNode, "agentDraft">[],
): OperationDiagnostic[] | undefined {
  const unreviewedDrafts = allNodes.filter(node => node.agentDraft).length;
  if (unreviewedDrafts >= UNREVIEWED_DRAFT_WARNING_THRESHOLD
    && beforeNodes.filter(node => node.agentDraft).length < UNREVIEWED_DRAFT_WARNING_THRESHOLD) {
    return [{
      severity: "warning",
      code: "unreviewed_agent_drafts",
      message: `${unreviewedDrafts} Agent draft cards await human review on this map. Prefer extending or consolidating existing cards before adding more.`,
    }];
  }
}
