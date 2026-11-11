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

### Checking human updates

"Check updates" and "check inbox" mean call `check_inbox`. A project page supplies
its project identity. The workspace and headless tool can check all projects.
Saved `@agent` mentions generate content-addressed notifications with card links.
Ordinary tool results prefix a bounded list of pending requests. MCP uses a leading
text content block and a `notifications` field. REST and WebMCP preserve the normal
operation result and place `notifications` first.

Read the linked context and reply on the card within the current user instructions,
then call `acknowledge_inbox` with the exact IDs. Repeated IDs identify the same
request. Editing mention-bearing text produces a new ID. Receipts store delivery
IDs in machine runtime storage, while the paper and map own the request text.
Acknowledgement preserves paper TODO completion. `includeAcknowledged` shows handled
items and `acknowledged=false` reopens them. Humans can do both in the Tools panel.
Notifications arrive with the next OpenBar call. An idle agent can check explicitly.

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
| `get_project_state` | Return location, paper title, section TODO counts, Primary Unplaced, maps, recent activity, human card-removal decisions, skills, and the `AGENTS.md` path and hash. Summary is the default. Full detail includes instruction bodies and every TODO. |
| `search_project` | Search paper headings and TeX, TODO titles and text, comments, mindmap titles, labels, refs, shared TODO text, and wiki pages. Results include ids and hrefs for navigation. |
| `navigate_project` | Navigate the visible project UI to a location returned by `get_project_state` or `search_project`. |
| `update_project` | Update editable project metadata such as the icon, title, overview, research kind, color, venue, tagline, label, links, collaborators, or archive state with the current project hash. |

Call `get_project_state` after `open_project`, then search or navigate to the
specific work. `read_project_skill` is registered on the instructions page
and reads a project, workspace, or bundled skill by id from project state.

`humanDecisions` records cards removed through the human mindmap interface,
including their map, title, text, and whether the card was an agent draft.
Treat these as context when proposing work. Ask before recreating substantially
similar content unless the current request calls for it. Restored cards leave
the current decision list. The list contains up to 50 decisions drawn from the
last 2,000 activity records, and applies to removals recorded after this feature
was installed. Like other activity details, card text is bounded. Agents use
their judgment to recognize similar content.

## Authenticated Streamable HTTP MCP

The `/api/mcp` endpoint requires a bearer token from `OPENBARRY_ACCESS_TOKEN`
or a verified Cloudflare Access identity allowed by the deployment. Public
demo access and same-origin browser access do not grant MCP access. The
endpoint supports SDK protocol discovery, `tools/list`, `tools/call`, bounded
JSON requests, and JSON-RPC errors. The SDK also supports 2025 initialization.

Use the authenticated endpoint for saved-state work such as bounded reads,
paper and map edits, batch previews and applies, activity, compilation, and
Git status or synchronization. Every write supplies project identity and a
revision or disk hash where the resource supports compare-and-swap. Supply a
unique stable `requestId` to mutation tools that accept it and reuse that ID
for a retry. HTTP requests have independent transport state, so JSON-RPC IDs
identify calls within a transport exchange rather than serving as durable retry
keys.

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

`set_mindmap_collapsed` changes the browser-local view preference for the
current project and map. The preference is returned under `viewLocal` by the
browser `get_mindmap` tool and remains outside the durable map record.

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

## Portable browser and headless access

Standard browser automation can call `window.openbarAgent.listTools()` and
`await window.openbarAgent.executeTool(name, args)` on the open page. This uses
the same live operation handlers, validation, revision checks and page lifecycle
as WebMCP. Native browser integrations continue to use their native API.

Navigation returns `{ok:true,value:{href,status:"scheduled",readyWhen:...}}`.
The destination mounts asynchronously. Browser automation should call
`await window.openbarAgent.waitForNavigation(href)` and discover its tools.
Native integrations should wait for the destination URL and page tool catalog.

HTTP MCP and REST preserve the complete operation envelope, including hashes,
revisions and remote-save receipts. Both MCP text and `structuredContent`
contain `{ok:true,value,...}` or `{ok:false,code,message,retryable,...}`. Array
values live inside `value`, so standard MCP clients can validate every result.

Saved map mutations return map metadata with `updatedNodes` and
`removedNodeIds`, covering changed cards, sibling order, and promoted children.
`get_mindmap` reads the complete map through its existing pagination.

Card presentation uses three levels: visible, collapsed, and hover. `title`
and `text` form the main card. `caution.critical` and `caution.important` are
visible paragraphs with red and amber accents. `caption` opens through the
card’s collapsed notes disclosure. `caution.background` appears in the
collapsed Background notes section. All note fields are map-owned, including on TODO cards.

Both `add_mindmap_node` and `patch_mindmap_node` accept `caption` and `caution`.
Supplying `caution` replaces all its fields, and `{}` clears them. An empty
`caption` clears the notes. Existing scalar caution text and retired
`minor` text migrate into `caption`, preserving the text and its existing
notes contents. Reading performs this conversion in memory. The next
ordinary save persists the canonical fields.

### Request replay recovery

Every idempotent mutation reserves its `requestId`, project, operation and
argument fingerprint in `.OpenBar/request-replay-journal.json` before saving
local state. A process interruption after that reservation leaves the intent
in place. A retry returns `request_replay_recovery_pending` and preserves the
intent, which gives an operator a safe inspection point before another write.

An intent-only recovery is resolved by a server-side operator after inspecting
the saved project. Call `resolveRequestReplayIntent(projectDir, requestId,
operation, fingerprint, { action: "clear" })` after confirming that the
mutation did not land. Call the same helper with
`{ action: "promote", result }` after reconstructing the exact original MCP
result. Result-bearing journal entries are promoted automatically on the next
matching retry. The journal is bounded to 200 entries and refuses new intent
reservations while it is full, preserving unresolved intents for recovery.

- `GET /api/tools` lists the authenticated saved-state tool catalog.
- `POST /api/tools/<name>` executes its JSON arguments using bearer authentication.
- `GET /api/projects` lists projects using the same authentication.
- `GET /openapi.json` describes every tool endpoint in OpenAPI 3.1.
- `get_agent_capabilities` returns connection metadata and tool count. Native
  `tools/list` and REST `/api/tools` supply the complete catalog.
- MCP resources expose the guide and project states, with source and skill URI templates.
- The `start_project` MCP prompt describes project orientation.

The HTTP catalog includes instructions and skills, source-range edits, TODO and
comment edits, and image-reference operations. HTTP uses saved repository state.
Browser tools also operate live editor drafts and visible selection. Each tool's
input schema specifies its own required hashes and revisions.

A stdio-only client can launch:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/OpenBar/scripts/mcp-stdio.mjs"],
  "env": {
    "OPENBARRY_URL": "https://openbar.example.ts.net",
    "OPENBARRY_ACCESS_TOKEN": "<provide securely>"
  }
}
```

Use the direct Node command so package-manager output stays out of the protocol.
The bridge requires a running authenticated OpenBar server.

The official MCP SDK handles HTTP framing, protocol negotiation, cancellation,
discovery, and the stdio relay. The endpoint supports the current `2026-07-28`
per-request protocol alongside `2025-03-26`, `2025-06-18`, and `2025-11-25`
clients using the SDK's stateless HTTP handler. Tool schemas and result
envelopes are shared across transports.

Clients poll `get_paper_compile` for jobs. Unsupported protocol versions receive
an SDK protocol error. Untrusted origins receive 403. Bearer authentication
returns a Bearer challenge on 401.

Stdio clients keep the bridge's standard input open while awaiting responses.
Closing standard input shuts down the SDK transports and cancels pending work.

Private-network access, trusted external browser origins, and an OAuth identity
provider are deployment choices. The owner supplies these settings. OpenBar's
bearer connection and stdio bridge work with clients that support configured
credentials. Native WebMCP requires a browser exposing that API, while the
portable browser bridge works with ordinary page-evaluation tooling.

Use a configured bearer token for authenticated MCP access. The product
instructions at `/llms.txt` and `/agents` describe the connection contract.
