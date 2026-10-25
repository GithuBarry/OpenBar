# Agent access: MCP and WebMCP

OpenBar exposes native MCP and WebMCP tools for research projects. Start with `get_project_state`. Tool descriptions and schemas define each operation. Project state lists instructions and skills for reading when relevant. `/agents` covers connection setup, `/llms-deployment.txt` covers deployment and transports, and `/llms.txt` is an optional index.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# OpenBar product invariants

OpenBar edits an Overleaf-style research-paper repository.

- Paper sections are derived from current LaTeX headings and include order. Section addresses are revision-local. Keep manuscripts free of OB-SECTION and section OB-EDIT comments and use current hashes or revisions for edits.
- Paper owns the scientific argument, every TODO, comments, and intentionally incomplete structures (tables, figures, plots, `\obmarker` cells).
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
- Research meaning has no built-in maturity, claim/evidence, or priority workflow.

- Write every card as self-contained material for an external reader, including cards prompted by @agent or @agents. State the question or topic, essential context, answer or current uncertainty, and relevant evidence or file references. Keep conversational replies and personal acknowledgments in the task. Preserve the project-specific meaning and available evidence.
- Keep visible card titles and bodies focused on their subject through direct positive statements. Put defensive caveats, exclusions, scope disclaimers, and precautionary commentary in the optional map-owned `caution` scratchpad. Readers reveal it by hovering or focusing a small icon. Use Extended notes for substantive supporting explanation. State results and unresolved scientific questions directly in the card. Human editing and agent tools both support the scratchpad on ordinary and TODO-backed cards.
- Express yourself directly, clearly, and with judgment. Reserve disclaimers, vague qualifiers, and defensive wording for genuine factual uncertainty. This applies especially to prominent Mindmap text.
- Agent-created cards remain marked Agent draft until a human explicitly saves or deletes them. The retired Note shape migrates to Agent draft.
