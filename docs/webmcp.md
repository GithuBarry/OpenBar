# Browser WebMCP

OpenBar provides two agent surfaces over the same repository-backed state.
Browser WebMCP operates the live page and editor session. Authenticated
Streamable HTTP MCP operates saved project state when a browser page is
unavailable.

The home page at `/` registers workspace tools. Every open project page
registers shared context and project file tools. Paper and mindmap pages add
controls for their live editor and canvas. Registration follows
the page lifecycle, so page-local tools leave when the page unmounts.

On an open project page, **Tools** opens the browser WebMCP catalog and
connection diagnostics. It links to `/agents` for browser and authenticated
headless setup. `/llms.txt` provides plain-text starting points. Page headers
link both discovery documents.

## Navigation journey

### Checking human updates

At the start of every OpenBar agent session, including one without earlier chat
context, call `check_inbox` after `get_project_state`. "Tick", "check updates",
"check inbox", and "sync" mean call `check_inbox`. When sync also names a Git or
Overleaf action, check the inbox first, then perform the requested synchronization.
A project page supplies
its project identity. The workspace and headless tool can check all projects.
Saved `@agent` and `@stat` mentions generate content-addressed notifications with card links.
`@stat` displays as "agent STAT" and fast tracks the request ahead of ordinary
mentions, using the same reply and acknowledgement flow.
Ordinary tool results prefix a bounded list of pending requests. MCP uses a leading
text content block and a `notifications` field. REST and WebMCP preserve the normal
operation result and place `notifications` first.

Read the linked context and reply on the card within the current user instructions,
then call `acknowledge_inbox` with the exact IDs. Repeated IDs identify the same
request. Editing mention-bearing text produces a new ID. Receipts store delivery
IDs in machine runtime storage, while the paper and map own the request text.
Acknowledgement preserves paper TODO completion. `includeAcknowledged` shows handled
items and `acknowledged=false` reopens them. Humans can do both in the Tools panel.
Clients receive pending notifications on their next OpenBar call. An MCP Events
client can also watch for newly saved mentions in one project over authenticated
HTTP. In OpenCode 2.3 or later, enable `experimental.mcp_events`, restart
OpenCode, and ask the chat to watch continuously. With an MCP connection named
`openbar`, the arguments to OpenCode’s `watch_mcp_event` are:

```json
{
  "server": "openbar",
  "event": "openbar.inbox.mention",
  "arguments": { "project": "<slug>" },
  "once": false
}
```

The project slug comes from the project URL. Register the watch, then call
`check_inbox` for outstanding requests. On each wake, use the same inbox and
acknowledgement flow. OpenCode’s default watch ends after the first event.
The stream reports new and edited human mentions saved through OpenBar. Use
`check_inbox` to reconcile outstanding requests after an external file edit
or a gap in replay history.

A memoryless agent follows this path:

```text
open /
→ list_projects
→ open_project
→ get_project_state
→ check_inbox
→ navigate_project
→ use paper, mindmap, wiki, or instructions tools
```

The steps have distinct roles:

1. Start at `/` and use `list_projects` to find a project.
2. Call `open_project` with the returned slug. OpenBar navigates to that
   project's paper page.
3. Call `get_project_state` for compact orientation, then `check_inbox` for pending
   human requests, including when earlier chat context is unavailable. Use
   `detail=full` when the agent needs every TODO and the full instruction
   bodies.
4. Read the relevant files with `read_project_files`. Use `navigate_project`
   with a project-state id or href to open the corresponding UI.
5. Call the tools owned by the active paper, mindmap, wiki, or instructions
   page. Agent Ready shows the catalog available for the current page.

## Workspace tools on `/`

| Tool | Purpose |
| --- | --- |
| `list_projects` | List workspace projects with paper links and identity details. |
| `get_workspace_layout` | Read the current workspace ordering and archive layout. |
| `move_project` | Move a project in the workspace using its current layout hash. |
| `open_project` | Open the paper page for a slug returned by the list or search tools. |

The workspace tools are read-oriented and use the home page to perform
navigation.

## Shared project tools

Every project page supplies its project identity and registers context, file,
synchronization, navigation, and skill access tools. Start with
`get_project_state`, then `check_inbox`.

| Tool | Purpose |
| --- | --- |
| `get_project_state` | Paper, TODO coverage, maps, Git state, human decisions, and instruction/skill metadata. Full detail includes instruction bodies and every TODO. |
| `read_project_files` | List directories or read bounded UTF-8/base64 file content with exact SHA256 hashes. |
| `apply_project_edits` | Create, replace, or delete authored files in one hash-checked transaction. |
| `navigate_project` | Open a paper, TODO, map, or other location returned by project state. |
| `read_project_skill` | Read a project, workspace, or bundled skill from the state catalog. |
| `update_project` | Edit managed project metadata using its current project hash. |
| `sync_project` | Inspect Git and review or resolve incoming changes. |

File paths resolve inside the project root. TeX, BibTeX, figures, scripts,
`AGENTS.md`, and authored skills/wiki documents are accessible. OpenBar project,
map, runtime records, Git metadata, and the generated reference renderer stay
behind their managed operations. Authored skills and wiki documents inside
legacy metadata folders remain accessible.

File writes supply the exact previous `hash`, or `expectedHash: null` for a new
file. `content: null` deletes a file. A destination create and source delete in
one batch moves it. Binary files use `encoding: "base64"`. `dryRun: true`
validates the entire batch. Each batch checks all hashes before saving and uses
the existing recovery journal for rollback. Bibliography changes refresh their
derived renderer. Browser file operations save the mounted draft first and
reconcile saved files into the live editor, preserving concurrent draft edits.

`humanDecisions` records cards removed through the human mindmap interface,
including their map, title, text, and whether the card was an agent draft.
Treat these as context when proposing work. Ask before recreating substantially
similar content unless the current request calls for it. Restored cards leave
the current decision list. The list contains up to 50 decisions drawn from the
last 2,000 activity records, and applies to removals recorded after this feature
was installed. Like other activity details, card text is bounded. Agents use
their judgment to recognize similar content.

## Authenticated Streamable HTTP MCP

The `/api/mcp` endpoint requires a bearer token from `OPENBAR_ACCESS_TOKEN`
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

Native MCP exposes 16 focused tools: workspace layout, project context,
inbox, project files, managed map edits, metadata, Git synchronization,
compilation, activity, and skill reading. TeX file edits own TODO text and
completion. Managed map operations own placement and presentation.

## Page-local tools

The paper page adds `get_paper_state`, `navigate_paper_section`,
`set_paper_reader_mode`, `compile_paper`, and `get_paper_compile`. Its snapshot
includes live draft state. File tools handle source, references, annotations,
sections, and tables through their ordinary authored files.

The mindmap page adds `get_mindmap`, `apply_mindmap_edits`, and canvas navigation,
collapse, and activity controls. `apply_mindmap_edits` wraps the existing guarded
operations in a compact `edit: {operation, args}` envelope. Each operation
validates its arguments, revision, disk hash, and retry identity. New cards
remain Agent draft until the human saves or deletes them.

For deletion, preview a batch and apply its returned token. `deleteMode: "cards"`
promotes surviving children. `deleteMode: "branches"` removes selected subtrees.

`set_mindmap_collapsed` changes the browser-local view preference for the
current project and map. Browser `get_mindmap` returns it under `viewLocal`.

The current tab saves each map’s position and zoom in `sessionStorage` and
restores them across reloads, including Resume edit. The Unplaced tray overlays
the canvas so opening and closing it preserves the map’s position and zoom.

TeX owns each TODO id, title, text, and completion. Each map owns placement,
labels, refs, optional progress/priority, table layout, and appearance. Primary
covers paper TODOs through its tree or Primary Unplaced. Secondary maps can
reuse a TODO once per map.

Use `link-todo` with `{id, todoId}` when the existing map card already describes
the paper task. The card keeps its position, children and links. Its original
prose that differs from the manuscript goes into Notes. Use `place-todo` with
`{todoId, parentId}` for an unplaced task. Repeating placement returns the
existing card and parent. Use `move` to relocate that card.

Use `convert-to-todo` to promote an ordinary card into a new manuscript task.
Native MCP takes `{id, sectionId?, expectedBundleHash}` in `edit.args`. Read
`paper.sourceHash` and the current section from `get_project_state`, and pass
the map revision from `get_mindmap`. The browser supplies the paper hash for
WebMCP. A successful conversion preserves the card ID, Notes and children.
Agent conversions are marked Agent draft. A visual HTML card can have a prose
child card for the manuscript task.

Wiki and instructions pages use the shared file tools for authored documents.
Their human editor actions remain available in the UI.

Deliver useful structure early and refine it as work progresses. Choose the presentation that makes the project's direction, planned scope, known results, and remaining work quickest to understand.

Mindmap structure: Use meaningful branching relationships in the project's own terms. Write concise prose cards, use child cards for distinct topics, and put supporting detail in collapsed Notes. Definitions, explanations, and conclusions belong in prose cards or Notes. For example, an Evaluation branch can have Dataset coverage, Method/model results, and Failure analysis children, with scoring details in Notes on the relevant card.

State the takeaway in one sentence a new reader can understand. Quantify changes against a named baseline on a stated sample. Use prose for a simple fact, a table for exact comparisons, or a labeled chart for a pattern. Keep headings short. Give shared units or denominators once per column, and split long labels across lines when the format supports it. Show uncertainty and evidence gaps beside the values. Keep essential color keys with the graphic and navigation hints beside their controls. For a comparison matrix, choose meaningful rows and columns, such as methods and models, and put measured results at their intersections.

Visible incompleteness: Both the mindmap and manuscript should visibly reflect unfinished work. Preserve intended branches, sections, comparisons, table rows and columns, and figures while evidence arrives. Keep empty or explicitly pending result cells, unresolved questions, TODOs, and sentence placeholders beside the relevant argument. Fill entries as evidence becomes available. Preserve verified results and stable TODO identities during reorganization, and expose gaps reopened by scope changes.

Illustrative comparison matrix, with placeholders for results:

| Method / Model | Model 1 | Model 2 | Model 3 |
| --- | --- | --- | --- |
| Method 1 | [measured result] | | |
| Method 2 | | [PENDING] | |
| Method 3 | | | [UNKNOWN] |

An empty cell keeps an evidence gap open. [PENDING] identifies planned work awaiting execution or a result. [UNKNOWN] identifies an outcome unresolved by the available evidence. A measured zero is recorded as 0 with its metric and supporting evidence. Keep these meanings distinct.

Sentence placeholder example: "On [DATASET], [METHOD] achieves [RESULT PENDING], measured by [METRIC]."

Preserve tables, row and column axes, captions, labels, TODOs, comments,
markers, and intentionally incomplete cells. `\obmarker` is a local paper
hole. `\obtodo` is operational work that appears on Primary, initially in
Primary Unplaced. `compile_paper` saves live edits and starts the paper build.

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
`http://100.x.y.z:3000` can serve the human UI and authenticated HTTP MCP
when reachable. Native WebMCP requires a browser secure context, provided by
HTTPS or loopback localhost.

For a separately hosted browser agent, set `OPENBAR_AGENT_ORIGINS` to its exact
HTTPS origin. Multiple origins use commas. Loopback HTTP origins support local
testing. Restart the server after changing this setting. The setting configures
HTTP MCP preflight and response CORS, the tools permissions policy, and WebMCP
`exposedTo` registration. An embedding page must also delegate `tools` using its
iframe `allow` attribute and its own permissions policy. HTTP MCP continues to
require `OPENBAR_ACCESS_TOKEN`. Approved browser callers can read the MCP session
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

`title` and `text` form the visible card. The collapsed Notes disclosure combines
`caption`, `caution.background`, `caution.critical`, and `caution.important`,
in that order, with exact repeated paragraphs combined. Prefer `caption` for
new notes. These fields are map-owned, including on TODO cards. Reading this
shared Notes projection preserves the saved fields and request identity. An
explicit Notes edit folds the displayed text into `caption` and clears `caution`
in the same map update.

Prefer concise visible cards, aiming for 80 words or fewer of visible card prose.
Put explanations, reasoning (including “why”), methods, and supporting detail in
`caption`. People click the existing Notes
disclosure to expand this detail. Use child cards for distinct subtopics or
independently useful results. Prefer Agent draft cards for new answers,
explanations, and supporting material. Use paper TODOs for research work that
belongs in the manuscript. Keep card prose focused on the subject. Let
hierarchy, labels, and disclosures communicate organization. Add navigation
directions only when they help locate a specific item the reader needs. Keep
key findings, consequential risks, and factual uncertainty visible. Card length is a flexible authoring preference, and longer
cards are welcome when useful. Agents may use optional length hints returned after a write. Offer card-length advice to people when they ask.

`apply_mindmap_edits` operations `add` and `patch` accept `caption` and `caution`.
Both operations also accept `presentation: { contentFormat: "html" }` for an
ordinary card, including switching a saved card to HTML. Keep its plain subject
in `title` and source markup in `text`. The authoritative writer limits HTML
bodies to 16,384 UTF-16 code units, including markup. Browser recovery preserves
the complete unsaved source while a draft is shortened to fit this limit.

Use compact static semantic HTML and self-contained inline SVG geometry, with a
`viewBox`, accessible labels, and fill/stroke colors. OpenBar sanitizes the source
and fits visuals within 440 × 240 CSS pixels. Paper TODO cards keep TeX formatting.
Draw the visual directly in the card body. Fit the SVG viewBox to the plot, use
short labels, and put the takeaway beside the graphic in card text. Put methods
and longer explanations in collapsed Notes. A nested SVG `<title>` can expose a
precise value on mouseover. Keep the main finding and material uncertainty
readable on touch. Use the OpenBar card accents (violet `#785ef0`, blue
`#648fff`, pink `#dc267f`, orange `#fe6100`, amber `#ffb000`) unless the user
chooses another palette. Select only the colors needed for the comparison.
Give independently useful panels their own cards. Use HTML table elements
for a table in an HTML card, or a Markdown-format card for a pipe table.

For example, this card shows progress at a glance and reveals the count on hover.

```json
{"edit":{"operation":"add","args":{"parentId":"root","title":"72% of cases reviewed","presentation":{"contentFormat":"html"},"text":"<svg viewBox=\"0 0 100 10\" role=\"img\" aria-label=\"72 of 100 cases reviewed\"><rect width=\"100\" height=\"10\" rx=\"2\" fill=\"currentColor\" opacity=\".12\"/><rect width=\"72\" height=\"10\" rx=\"2\" fill=\"#785ef0\"><title>72 of 100 cases reviewed</title></rect></svg>"}}}
```

Supply the current `expectedRevision` and, for native MCP, the project/map
identity and current disk hash. Use `operation: "patch"` with the existing card's
`id` and the same presentation/source fields to revise it.

Supplying `caution` replaces all its fields, and `{}` clears them. An empty
`caption` clears that field. To replace the complete shared Notes through a
tool, supply the new `caption` and `caution: {}` in one patch. Existing scalar
caution text and retired `minor` text migrate into `caption`, preserving the
text and its existing notes contents. Reading performs this retired-format
conversion in memory. The next ordinary save persists those canonical fields.

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
    "OPENBAR_URL": "https://openbar.example.ts.net",
    "OPENBAR_ACCESS_TOKEN": "<provide securely>"
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

Write the answer so a new reader can understand it alongside its neighboring cards.
Remove the mention from visible copy. Keep a question only if a concise Q&A helps
explain the answer. When replacing a map-owned ask, preserve its original wording
in collapsed Notes in the same patch. Acknowledging the request publishes its
linked replies together, each with an unread dot that clears when read.

Card width is map-owned presentation. Drag the lower-right resize grip to set
it, or use `presentation.cardWidth` (180–1200 canvas pixels) through map edits.
Pass `null`, double-click the grip, or press Delete to restore automatic width.
Appearance → Card width sets a map-wide preference. Individual fits each card
to its content. Siblings uses the widest card under each parent. Same depth
uses the widest card at each level. Cards keep their own height and saved
width preference. In `apply_mindmap_edits`, use
`edit: {"operation":"card-width-mode","args":{"cardWidthMode":"siblings"}}` to change the mode.
The other values are `individual` and `depth`.
