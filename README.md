# OpenBar

OpenBar is a **paper-first research workbench**. The manuscript defines the
work. The Primary mindmap covers every paper TODO. Secondary maps reuse
selected TODOs as different views of the same work. Browser agents operate
the same repository state as the researcher.

> OpenBar turns the research paper into an agent-operable research plan.

See [docs/architecture.md](docs/architecture.md) for the product model and
[docs/webmcp.md](docs/webmcp.md) for the browser WebMCP tool contract.

## What it provides

- A live TeX editor for the real include graph, with companion preview and PDF compile
- Inline manuscript TODOs, comments, and local holes (\obtodo, \obcomment, \obmarker) that survive Git and other editors
- A Primary mindmap covering every paper TODO, placed in its tree or visible in Primary Unplaced
- Optional secondary maps that reuse selected TODOs with their own placement, labels, refs, progress, and appearance
- Incomplete tables, planned figures, and marker cells as useful paper state that agents fill incrementally
- Browser WebMCP as the sole agent interface, with tools registered from the active page
- Optional wiki Markdown notes, project `AGENTS.md`, and skills (`skills/*/SKILL.md`, workspace `content/skills`)

## Agent interface

OpenBar exposes browser WebMCP tools from the page the agent is using. The
workspace home registers workspace tools. Opening a project adds four project
context tools. Paper, mindmap, wiki, and instructions pages register the
actions owned by the active page. The Agent Ready control shows the current
catalog on an open project page.

A fresh agent follows this journey:

```text
open /
→ list_projects or search_projects
→ open_project
→ get_project_state
→ navigate_project
→ use paper, mindmap, wiki, or instructions tools
```

### Home workspace tools on `/`

| Tool | Purpose |
| --- | --- |
| `list_projects` | List workspace projects with paper links and identity details. |
| `search_projects` | Find projects by slug, title, tagline, or label. |
| `open_project` | Open the paper page for a slug returned by the list or search tools. |

### Four project context tools

These tools are registered on every open project page. The open page supplies
the project identity.

| Tool | Purpose |
| --- | --- |
| `get_project_state` | Read compact orientation: current location, paper title, section TODO counts, Primary Unplaced, maps, recent activity, skills, and the `AGENTS.md` path and hash. Use `detail=full` for instruction bodies and every TODO. |
| `search_project` | Search paper headings and TeX, TODOs, comments, mindmap text, labels, refs, and wiki pages. Results include ids and hrefs for navigation. |
| `navigate_project` | Move the visible project UI to a location returned by `get_project_state` or `search_project`. |
| `update_project` | Update the project title, venue, tagline, or optional label with the current project hash. |

### Page-local tools

- **Paper** — manuscript reading and editing with `get_paper_state`,
  `get_paper_outline`, `read_paper_section`,
  `navigate_paper_section`, `set_paper_reader_mode`,
  `replace_paper_section`, `patch_paper_table`,
  `remove_paper_todo`, `lint_paper`, `compile_paper`, and
  `get_bibliography`. Raw TeX tools include `get_source_bundle`,
  `read_source_range`, `replace_source_range`, `add_comment`,
  `add_todo`, `update_todo`, `complete_todo`, and
  `reopen_todo`.
- **Mindmap** — `get_mindmap`, `focus_mindmap_node`,
  `add_mindmap_node`, `move_mindmap_node`, `delete_mindmap_node`,
  `set_mindmap_collapsed`, `patch_mindmap_node`,
  `highlight_mindmap_activity`, `place_todo_card`,
  `convert_card_to_todo`, `complete_todo`, `reopen_todo`,
  `focus_todo_in_paper`, and `rename_mindmap`.
- **Wiki** — `read_document`, `patch_document`, and
  `render_preview` for the open page, plus `create_wiki_page`,
  `update_wiki_page`, `rename_wiki_page`, and `delete_wiki_page`
  where the page owns those actions.
- **Instructions** — `read_project_skill`,
  `write_agents_md`, `write_project_skill`, `delete_project_skill`,
  `write_workspace_agents_md`, `write_workspace_skill`, and
  `delete_workspace_skill`. Repository setup adds
  `get_capabilities`, `inspect_repository`, `preview_conversion`, and
  `apply_conversion`.

Page-local tools use live editor state, selected cards, navigation, focus, and
the visible actions of their page. Their project and document identity comes
from the active page. TeX owns TODO identity, text, and completion. Each map
owns its card placement, labels, refs, progress, and appearance.

## Main routes

- `/` — workspace project list and workspace WebMCP tools
- `/p/<slug>/paper` — manuscript editor, preview, PDF, and TODOs
- `/p/<slug>/mindmap` — Primary map with Unplaced TODOs and Recent activity
- `/p/<slug>/mindmap/<mapId>` — secondary map with selected shared TODOs
- `/p/<slug>/wiki` — optional supporting Markdown memory
- `/p/<slug>/instructions` — `AGENTS.md`, skills, and setup tools
- `/about` — product model and Agent Ready guide

`/p/<slug>` redirects to the paper.

## Local setup

```bash
pnpm install
pnpm dev
```

Set `OPENBARRY_CONTENT` to the mounted content directory when the repository
content lives elsewhere. The local workspace runs against that directory.

## Release checks

```bash
pnpm typecheck
pnpm evals
pnpm build
OB_SMOKE_SLUG=<project-slug> pnpm smoke
git diff --check
```

## Repository state

Research content belongs in the project files:

- manuscript TeX, bibliography, figures, tables
- `\obtodo[id=…]` / `\obcomment` / `\obmarker` annotations
- mindmap files (`role=draft` = Primary, `role=planning` = secondary, maps own placement, labels, refs)
- `AGENTS.md` and `skills/*/SKILL.md` (project and workspace)

Browser storage is for personal interface preferences such as theme, sidebar
visibility, and the local planning-map viewpoint.

OpenBar is released under the [MIT License](LICENSE).
