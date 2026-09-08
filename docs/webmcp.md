# Browser WebMCP

OpenBar provides two agent surfaces over the same repository-backed state.
Browser WebMCP operates the live page and editor session. Authenticated
Streamable HTTP MCP operates saved project state when a browser page is
unavailable.

The home page at `/` registers workspace tools. Every open project page
registers four project context tools. Paper, mindmap, wiki, and instructions
pages register the actions owned by their active page. Registration follows
the page lifecycle, so page-local tools leave when the page unmounts.

On an open project page, **Tools** opens the browser WebMCP catalog and
connection diagnostics. It links to `/agents` for browser and authenticated
headless setup. `/llms.txt` provides plain-text starting points. Page headers
link both discovery documents.

## Navigation journey

A memoryless agent follows this path:

```text
open /
→ list_projects or search_projects
→ open_project
→ get_project_state
→ navigate_project
→ use paper, mindmap, wiki, or instructions tools
```

The steps have distinct roles:

1. Start at `/` and use `list_projects` or
   `search_projects` to find a project.
2. Call `open_project` with the returned slug. OpenBar navigates to that
   project's paper page.
3. Call `get_project_state` for compact orientation. Use
   `detail=full` when the agent needs every TODO and the full instruction
   bodies.
4. Use `search_project` for paper, TODO, comment, mindmap, or wiki detail.
   Pass a returned id or href to `navigate_project` so the visible UI opens
   the matching location.
5. Call the tools owned by the active paper, mindmap, wiki, or instructions
   page. Agent Ready shows the catalog available for the current page.

## Workspace tools on `/`

| Tool | Purpose |
| --- | --- |
| `list_projects` | List workspace projects with paper links and identity details. |
| `search_projects` | Find projects by slug, title, tagline, or label. |
| `open_project` | Open the paper page for a slug returned by the list or search tools. |

The workspace tools are read-oriented and use the home page to perform
navigation.

## Four project context tools

These tools are registered on every open project page. The open page supplies
the project identity, so calls use the live project context.

| Tool | Purpose |
| --- | --- |
| `get_project_state` | Return location, paper title, section TODO counts, Primary Unplaced, maps, recent activity, skills, and the `AGENTS.md` path and hash. Summary is the default. Full detail includes instruction bodies and every TODO. |
| `search_project` | Search paper headings and TeX, TODO titles and text, comments, mindmap titles, labels, refs, shared TODO text, and wiki pages. Results include ids and hrefs for navigation. |
| `navigate_project` | Navigate the visible project UI to a location returned by `get_project_state` or `search_project`. |
| `update_project` | Update editable project metadata such as the icon, title, overview, research kind, color, venue, tagline, label, links, collaborators, or archive state with the current project hash. |

Call `get_project_state` after `open_project`, then search or navigate to the
specific work. `read_project_skill` is registered on the instructions page
and reads a project, workspace, or bundled skill by id from project state.

## Authenticated Streamable HTTP MCP

The `/api/mcp` endpoint requires a bearer token from `OPENBARRY_ACCESS_TOKEN`
or a verified Cloudflare Access identity allowed by the deployment. Public
demo access and same-origin browser access do not grant MCP access. The
endpoint supports `initialize`, `tools/list`, `tools/call`, bounded JSON
requests, session ids, and JSON-RPC errors.

Use the authenticated endpoint for saved-state work such as bounded reads,
paper and map edits, batch previews and applies, activity, compilation, and
Git status or synchronization. Every write supplies project identity and a
revision or disk hash where the resource supports compare-and-swap.

## Page-local tools

### Paper

The paper page registers structured manuscript tools:

- `get_paper_state`, `get_paper_outline`, and `read_paper_section`
- `navigate_paper_section` and `set_paper_reader_mode`
- `replace_paper_section`, `patch_paper_table`, and
  `remove_paper_todo`
- `lint_paper`, `compile_paper`, and `get_bibliography`

It also registers raw source and TeX annotation tools:

- `get_source_bundle`, `read_source_range`, and
  `replace_source_range`
- `add_comment`, `add_todo`, `update_todo`,
  `complete_todo`, and `reopen_todo`

The open paper supplies the project and live editor. The agent passes a
section id or source range plus the current revision when a write needs
revision-checked state.

### Mindmap

The mindmap page registers:

- `get_mindmap`, `focus_mindmap_node`, `add_mindmap_node`,
  `move_mindmap_node`, `delete_mindmap_node`, and
  `set_mindmap_collapsed`
- `patch_mindmap_node`, `highlight_mindmap_activity`, and
  `rename_mindmap`
- `place_todo_card`, `convert_card_to_todo`, `complete_todo`,
  `reopen_todo`, and `focus_todo_in_paper`

TeX owns each TODO id, title, text, and completion. A map owns card
placement, labels, refs, progress, optional P0–P3 priority, table layout,
and appearance. Primary covers every
paper TODO through its tree or Primary Unplaced. Secondary maps reuse selected
TODOs, and the same TODO can appear once on each map.

`convert_card_to_todo` accepts an optional stable paper section id. Omit it to
insert the new TODO at a neutral location in the manuscript root. The result
reports the resolved section when one was supplied.

### Wiki

An open wiki page registers bounded reads and preview. Wiki mutation tools
return `capability_unavailable` in this release. Existing wiki files remain
readable supporting memory, and paper TODOs remain the operational work.

### Instructions and setup

The instructions page registers:

- `read_project_skill`
- `write_agents_md`, `write_project_skill`, and
  `delete_project_skill`
- `write_workspace_agents_md`, `write_workspace_skill`, and
  `delete_workspace_skill`

Repository setup adds `get_capabilities`, `inspect_repository`,
`preview_conversion`, and `apply_conversion`. These tools support
repository import, TeX include-graph inspection, and explicit document
conversion.

## Raw TeX repository inspection

Models can inspect the TeX repository directly for raw source details. On the
paper page, `get_source_bundle` returns the live include-graph source, file
segments, and current revision. `read_source_range` returns exact characters
from that live paper source. `inspect_repository` on the instructions page
reports the manuscript include graph for repository setup and import.

Use `get_paper_state` or `read_paper_section` before a source edit. Pass
the returned revision to `replace_source_range` or
`replace_paper_section`. Changes appear in the live editor and save through
the same revision and hash checks as human edits. `compile_paper` flushes
live edits and starts the paper build.

Preserve tables, row and column axes, captions, labels, TODOs, comments,
markers, and intentionally incomplete cells. `\obmarker` is a local paper
hole. `\obtodo` is operational work that appears on Primary, initially in
Primary Unplaced.

## Live state and visible actions

WebMCP handles live editor state, selected cards, navigation, focus, and
visible page actions. Page-local calls use the project and document supplied
by the active page. `navigate_project` moves the visible app before a
page-local call when the required page is elsewhere.

The browser catalog keeps the agent aligned with the page that is open. Agent
Ready is the visible check for the registered tools on an open project page.

## Journeys

Use the manual browser and MCP acceptance checklist in
[docs/release-acceptance.md](release-acceptance.md). The checklist exercises
navigation, live WebMCP registration, authenticated MCP initialization,
revision conflicts, shared TODOs, batch previews, compilation, artifact
retention, and Git receipts.

## Resolve Overleaf conflicts

`get_project_state.sync` includes branch status, local/base/remote commit IDs,
changed paths, and recovery refs. `sync_project` is available in both HTTP MCP
and browser WebMCP. HTTP MCP takes `project`, and browser WebMCP uses the current
project.

1. Save live browser drafts, then call `sync_project` with `action: "inspect"`
   and `refresh: true`.
2. Call `action: "review_pull"`. This checkpoints saved local files and prepares
   Git's merge in a disposable checkout. The result includes a review token,
   changed files, and base/local/remote text for each conflicting file.
3. Review each whole file. `choice: "local"` and `choice: "remote"` choose a
   complete saved version. `choice: "merged"` requires the complete resolved
   file in `text`. Binary, linked, and large files use saved-version choices.
4. Call `action: "apply_pull"` with the token and one resolution per conflicting
   path. The operation verifies the local branch, HEAD, and tracked working
   state before applying the merge. Concurrent changes require a fresh review.
5. Use `action: "cancel_pull"` to remove a review checkout while preserving the
   local checkpoint. Applying a pull preserves the merged result locally.

The human interface also offers force pull and force push with two explicit
confirmations. Both versions receive Git recovery refs. Force push includes an
expected-remote-commit lease, and force pull preserves unrelated untracked files.

## Browser origins and proxies

OpenBar sends `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)`.
Open the project through HTTPS, such as `https://openbar.example.ts.net`, for native
browser WebMCP. A future HTTPS Cloudflare tunnel uses the same origin policy.
`http://100.64.0.1:3000` can serve the human UI and authenticated HTTP MCP
when reachable. Native WebMCP requires a browser secure context, provided by
HTTPS or loopback localhost.

For a separately hosted browser agent, set `OPENBARRY_AGENT_ORIGINS` to its exact
HTTPS origin. Multiple origins use commas. Loopback HTTP origins support local
testing. Restart the server after changing this setting. The setting configures
HTTP MCP preflight and response CORS, the tools permissions policy, and WebMCP
`exposedTo` registration. An embedding page must also delegate `tools` using its
iframe `allow` attribute and its own permissions policy. HTTP MCP continues to
require `OPENBARRY_ACCESS_TOKEN`. Approved browser callers can read the MCP session
header and send authorization and protocol headers.
