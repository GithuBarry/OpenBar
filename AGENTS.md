# Agent access: MCP and WebMCP

OpenBar exposes native MCP and WebMCP tools for research projects. Start with `get_project_state`. Tool descriptions and schemas define each operation. Project state lists instructions and skills for reading when relevant. `/agents` covers connection setup, `/llms-deployment.txt` covers deployment and transports, and `/llms.txt` is an optional index.

After changing application code or styles, rebuild and restart the running local OpenBar service, then verify the live app before reporting completion.

## Agent inbox and response prefixes

At the start of each OpenBar agent session, including one without earlier chat context, call `check_inbox` after `get_project_state`. Treat "tick", "check updates", "check inbox", and "sync" as requests to call `check_inbox`. When sync also names a Git or Overleaf action, check the inbox first, then perform the requested synchronization. Saved mindmap `@agent` mentions are requests whose original wording stays in the paper, map, or collapsed Notes. Replies use ordinary cards with subject titles and direct answer text, keeping useful existing card wording. When moving map-owned request wording into `caption`, save it in the same patch as the visible card changes. OpenBar tool results may start with pending notifications. Read the linked card and its current context, reply there within the user's instructions, then call `acknowledge_inbox` with the exact notification IDs. Repeated IDs represent the same request. Editing the request text produces a new ID. Acknowledgement records handling, while paper TODO completion follows the research decision. The Tools panel lets humans inspect, handle, and reopen notifications. Prefixes arrive with the next OpenBar tool call.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# OpenBar product invariants

OpenBar edits an Overleaf-style research-paper repository.

- Paper sections are derived from current LaTeX headings and include order. Section addresses are revision-local. Keep manuscripts free of OB-SECTION and section OB-EDIT comments and use current hashes or revisions for edits.
- Paper owns the scientific argument, every TODO, comments, and intentionally incomplete structures (tables, figures, plots, `\obmarker` cells).
- Work-in-progress papers visibly carry their unfinished reasoning throughout the manuscript: TODOs, questions, notes, planned comparisons, partial tables, and local result holes. Preserve this working-paper state until evidence or an explicit research decision resolves each open point.
- Begin with the intended full paper skeleton and retain its eventual scope while evidence fills it in. Planned sections, argument steps, comparison axes, tables, and figures can remain partly empty. Completion can decrease when the research changes or expands, and the manuscript should expose the newly opened work.
- Deliver useful structure early and refine it as work progresses. Choose the presentation that makes the project's direction, planned scope, known results, and remaining work quickest to understand.

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

  Sentence placeholder example: "On [DATASET], [METHOD] achieves [RESULT PENDING], measured by [METRIC]."
- Place each TODO beside the passage, claim, theorem, comparison, or result where its outcome will most strengthen the argument. Keep local notes and missing-result markers at the corresponding point of use as the manuscript develops.
- The Primary mindmap covers every stable paper TODO: placed in its tree, or visible in Primary Unplaced. Unplaced counts as coverage.
- Secondary mindmaps may reuse any subset of paper TODOs. The same `todoId` may appear once per map, including on Primary and several secondary maps. Two cards for one `todoId` inside a single map are invalid.
- TeX owns TODO id, text, created/updated/completed. Each map independently owns placement, labels, refs, optional progress, and appearance. Do not persist duplicate TODO text or completion on the map.
- Completing a TODO does not require new manuscript prose.
- Mindmap hierarchy and labels have project-specific meaning. OpenBar assigns none.
- Mindmap nodes may reference stable paper comments. Comment `kind` (claim, question, hypothesis, reviewer, …) is free project vocabulary, not a claim database.
- `\obmarker` is a local paper hole. `\obtodo` is work promoted into the operational maps. Markers do not create mindmap cards.
- Empty or partial tables, planned plots, planned figures, and unresolved marker cells are useful state. Agents preserve row/column axes, fill only available results, leave unresolved cells marked, add axes when scope expands, and make the smallest edit that keeps the unfinished plan.
- Wiki is optional supporting memory, never a second task tracker.
- `AGENTS.md` is core project context. `get_project_state` includes its path and hash by default, and the full body when `detail=full`.
- Project skills are listed, then read by the agent when useful.
- Each mindmap card holds one image. Pasting more images creates child cards. Image width is map-local presentation, stored as `refs[].imageWidth` (25–100 percent). Removing an image detaches it from the card and preserves the shared asset.
- Every durable field is editable in the human UI and through WebMCP.
- Storage `role=draft` is the Primary map; `role=planning` is a secondary map. The visible product name is OpenBar.
- Card priority uses optional map-local values P0 through P3 and carries no scientific meaning.
- Labels, colors, progress, table layout, refs, and metadata are map-owned presentation fields. TeX remains the source of truth for TODO text and completion.
- Delete stale architecture instead of preserving compatibility branches.
- Keep verification checks temporary and outside the repository. Remove them after use. Keep the repository free of permanent tests.
- Research meaning has no built-in maturity, claim/evidence, or priority workflow.

- Card `title` and `text` are visible. `caption` holds the collapsed Notes. Existing `caution.background`, `caution.critical`, and `caution.important` text appears in the same Notes field, with exact repeated paragraphs combined. Prefer `caption` for new notes. These note fields belong to each map, including on TODO-backed cards. Saved fields remain intact until an explicit Notes edit folds them into `caption`.
- Prefer concise visible cards. Aim for 80 words or fewer of visible card prose. Use `caption` (collapsed Notes) for reasoning, why an answer holds, methods, context, and supporting detail. Keep each research fact in one useful card. Extend an existing relevant card with new detail about the same fact. Use child cards for distinct subtopics or independently useful results. Prefer Agent draft cards for new answers, explanations, and supporting material. Use paper TODOs for research work that belongs in the manuscript. Keep card prose focused on the subject. Let hierarchy, labels, and disclosures communicate organization. Add navigation directions only when they help locate a specific item the reader needs. Keep key findings, consequential risks, and factual uncertainty visible. Card length is a flexible preference, and longer cards are welcome when useful. Apply this quietly and offer card-length advice only when the user asks.
- Agent-created cards and agent-authored content replacements remain marked Agent draft until a human explicitly saves or deletes them. The retired Note shape migrates to Agent draft.
