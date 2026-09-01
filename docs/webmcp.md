# WebMCP tools

OpenBar registers browser WebMCP tools on the open project page. A memoryless
agent should start here.

## Universal tools

Available on paper, mindmap, and wiki pages:

- `get_project_state` — factual orientation (outline, TODOs, maps, recent activity, skills, location)
- `search_project` — lexical search; returns `id` and `href`
- `navigate_project` — moves the UI; do not ask the human to navigate
- `read_project_skill` — project-local `skills/*/SKILL.md` or bundled fallback

If a page-specific tool returns `capability_unavailable`, call `get_project_state`, then `navigate_project`, then retry.

## Paper page

Canonical operations:

- `get_paper_state` / `get_paper_outline` / `read_paper_section`
- `navigate_paper_section` / `replace_paper_section`
- `add_todo` / `update_todo` / `complete_todo` / `add_comment`
- `read_source_range` / `replace_source_range`
- `compile_paper` / `lint_paper` / `get_bibliography`

`compile_document` and `lint_document` are aliases. Prefer `compile_paper` and `lint_paper`.

Agent section replacements go through the live CodeMirror document, the same save path as human edits, and undo history.

## Mindmap page

- `get_mindmap` / `focus_mindmap_node`
- `add_mindmap_node` / `rename_mindmap_node` / `move_mindmap_node` / `delete_mindmap_node`
- `link_mindmap_artifact` (paper section or TODO)
- `collapse` / optional presentation

Derived paper TODOs appear in the UI overlay and are not saved into the mindmap file.
