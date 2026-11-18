import { INBOX_GUIDANCE } from "./agent-inbox-contract";
import { MAX_HTML_CARD_LENGTH } from "@/lib/mindmap/html-card";

export const HTML_CARD_GUIDANCE = `Agents can add or patch ordinary cards with presentation.contentFormat:"html" and compact static, self-contained HTML/SVG in text. Keep titles plain and TODO cards in TeX. Source is limited to ${MAX_HTML_CARD_LENGTH.toLocaleString("en-US")} UTF-16 code units including markup. OpenBar sanitizes displayed content and fits visuals within 440 × 240 CSS pixels. Humans use the diagram, @agent comments, copy/paste controls, and Notes. Tiny patch example: {"id":"CARD_ID","presentation":{"contentFormat":"html"},"text":"<p>Result pending</p>"}.`;

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

export const MINDMAP_CARD_GUIDANCE = `${PROJECT_DELIVERY_GUIDANCE} ${HTML_CARD_GUIDANCE} Prefer concise visible card titles and bodies. Write replies as ordinary cards with a short subject title and direct answer text when useful. Keep useful existing card wording. Aim for 80 words or fewer of visible card prose. Use caption, the existing collapsed Notes section, for reasoning, why an answer holds, methods, context, and supporting detail. Keep each research fact in one useful card. Extend an existing relevant card with new detail about the same fact. Use child cards for distinct subtopics or independently useful results. Prefer Agent draft cards for new answers, explanations, and supporting material. Use paper TODOs for research work that belongs in the manuscript. Keep card prose focused on the subject. Let hierarchy, labels, and disclosures communicate organization. Add navigation directions only when they help locate a specific item the reader needs. Keep key findings, consequential risks, and factual uncertainty visible. Card length is a flexible preference, and longer cards are welcome when useful. Apply this quietly. Offer card-length advice only when the user asks.`;

export const AGENT_GUIDANCE = `Start with get_project_state for project context, humanDecisions, and @agent or fast tracked @stat requests. ${INBOX_GUIDANCE} Use read_project_files and apply_project_edits for authored project files, including TeX, BibTeX, figures, scripts and instructions. File writes use exact prior hashes and preserve OpenBar-managed state. Use get_mindmap and apply_mindmap_edits for map state. Coordinate through the current writing tab or revision-checked native MCP. Add Agent draft children while a human edits a card. Inspect get_editing_session before a handoff. Resume edit transfers browser writing access when the human requests it. Release editing access through release_edit after local work is saved. ${MINDMAP_CARD_GUIDANCE} Treat human-removed cards as decisions for the current project. Ask before recreating substantially similar content unless the current request explicitly calls for it. Website requests also appear in openbar-agent-requests metadata. Use tool schemas and relevant project skills. Make the smallest requested change and summarize changed locations. Connection setup: /agents.`;
