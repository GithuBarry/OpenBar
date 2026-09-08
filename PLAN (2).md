# OpenBar: complete repair and redesign plan

## 1. Product decisions and design

**Goal:** make OpenBar a dependable paper-and-mindmap workspace for researchers and agents, with recoverable editing, clear synchronization, and a restrained interface.

The paper and mindmap remain **separate pages**. The paper holds the long-term argument and intentionally unfinished work. The mindmap provides a freely organized view of work and recent changes. OpenBar does not interpret research success, failure, or maturity.

### Visual system

- Use white and very light gray surfaces, dark text and branches, subtle borders, and restrained glass effects on floating controls.
- Card color strips default to **no color**. Optional custom colors and free-form labels have no built-in scientific meaning.
- Offer the requested palette: `#ffb000`, `#fe6100`, `#dc267f`, `#785ef0`, `#648fff`. Use dark text on light accents; never communicate state through color alone.
- Bundle Inter for interface and map text, Source Serif 4 for rendered manuscript prose, and JetBrains Mono for source. Use one consistent sans-serif family across root and child cards.
- Default map typography: 16px semibold titles, 14px descriptions, readable compact badges. Remove tiny diagnostic text from normal cards.
- Keep the top-level interface sparse: navigation, save/sync status, search, and relevant primary actions. Put secondary commands in contextual menus.
- Keep existing dark mode functional using the same semantic tokens; light mode is the design baseline.

### Paper experience

- Preserve the mobile interaction where source scrolls into rendered content. Retain the source position and selection when changing presentation.
- Replace the fixed narrow-screen width subtraction with responsive gutters: 16px on phones, larger gutters on desktop.
- Keep manuscript text readable without horizontal page scrolling. Wide tables, code, and figures receive their own horizontal scrolling.
- Keep editing, live preview, compiled PDF, TODO navigation, and source diagnostics available without simultaneously opening multiple permanent panels.
- Preserve unfinished tables, row/column axes, figures, comments, markers, and partial results. No action automatically “finishes” a scientific structure.
- Preserve drafts in auxiliary views, including advisor-facing text, when switching views or navigating.

### Mindmap cards

Only two behaviors exist:

1. **Ordinary card:** map-owned title and description.
2. **Paper TODO card:** shared title, description, and completion owned by TeX.

Both support map-owned labels, appearance, optional priority, and optional progress.

- Edit title and description **in place**. Double-click or F2 enters editing; double-clicking a card must not zoom.
- Default to plain text; offer a per-card Markdown toggle. Existing TeX-formatted cards retain support.
- Show formatting controls only while editing: emphasis, lists, links, math, and images where supported. Preserve source when switching modes.
- Use a compact row near the title for indicators. Provide uploaded images with editable accessible labels and ordering.
- Offer priority `None`, `P0`, `P1`, `P2`, `P3`; P0 is highest. Priority is independent per map.
- Offer hidden progress, empty progress, and six filled stages. Full progress has a white checkmark.
- Ordinary-card progress has no effect on other cards.
- Setting a TODO card to full completes the shared TeX TODO. Lowering it reopens that TODO.
- Store partial TODO progress independently per map; derive full completion from TeX. Completing preserves each map’s previous partial stage. Reopening restores those partial stages.
- Removing the progress indicator changes appearance only; it does not reopen a TODO.
- Remove the permanent inspector. Keep optional links, comment references, attachments, and existing metadata in contextual details. Ordinary cards require no paper-section connection.

### Selection, batch operations, and deletion

- Click selects one card. Shift-click toggles membership in the selection. Shift-drag on empty canvas selects intersecting visible cards.
- Background drag pans normally. Escape clears selection when no editor/menu owns the key.
- Ctrl/Cmd+A selects visible cards only when the canvas itself has focus. Inputs retain normal text-selection behavior.
- On phones, provide an explicit Select mode with tap-to-toggle selection.
- Show a compact selection toolbar with the count and batch actions: priority, progress, color, add/remove labels, move, and delete.
- Show mixed values explicitly. Batch operations change only fields the user chooses; they never replace everyone’s title or description.
- Batch movement operates on selected branch roots, preserves their relative order, and rejects cycles.

**Deletion rules:**

- Default action: **Delete selected cards**. Remove exactly the selected cards and promote surviving children to the nearest surviving ancestor, preserving order.
- Separate action: **Delete selected branches**. Include descendants, including collapsed descendants.
- Before either action, show exact affected counts, descendant treatment, and TODO-card counts. Compute this preview against a revision and invalidate it if the map changes.
- Never delete the root.
- Deleting a TODO card never deletes its TeX TODO. Primary TODOs become Unplaced; other maps retain their cards.
- Deleting paper TODOs remains a distinct paper action with its own explicit preview.
- Each confirmed batch is one transaction and one undo item. Undo restores IDs, placement, content, and appearance without reverting unrelated later edits.
- Retain recoverable deleted-card snapshots across reloads for 30 days. Cleanup applies to recovery data, not authored paper history.

### Layout without accidental overlap

- Measure actual card dimensions after edits, font loading, Markdown expansion, and image loading. Recompute layout from measured dimensions.
- Use a left-to-right tree with a minimum 32px vertical gap between sibling subtrees and 72px horizontal column gap.
- Anchor the selected/edited card during relayout so typing does not repeatedly move the viewport.
- Route branches outside card interiors. During dragging, use one drop indicator and a reserved destination gap.
- Floating controls flip or shift within viewport bounds, avoid the active editing field, and become a bottom sheet when space is insufficient.
- Opening a desktop side panel reduces canvas width; it does not cover the map.
- Respect mobile safe areas and the visual viewport above the keyboard. Sticky headers must not hide focused content.
- Long titles and labels wrap. Full content remains accessible when a display preview is collapsed.
- Navigation to a card unfolds ancestors and pans it into view.

## 2. Editing architecture, persistence, and agent access

### Shared editing service

Extract business operations from the large React components and server-action file into focused services for paper, maps, instructions, synchronization, and compilation.

Use one command path for the human UI, MCP, and WebMCP:

**validate → check revision/hash → apply operation → persist transaction → record activity → return receipt → schedule Git sync**

- React components own rendering, focus, selection, and temporary input.
- Editing sessions own drafts, save queues, revisions, recovery, and undo.
- Domain services own TODO semantics, map invariants, and operations.
- Repository services own locking, journals, file writes, and Git.
- Transport adapters supply identity and arguments; they contain no alternative editing logic.

Commands carry explicit project/resource identity, an expected version, and a request ID. Results distinguish validation failure, revision conflict, local persistence, and remote synchronization. Read results identify whether they describe a live draft or saved repository state.

### Protect live drafts

- Mount a project editing-session coordinator above page navigation so switching between paper and maps does not destroy active drafts.
- Maintain immediate browser recovery snapshots in IndexedDB, keyed by project, resource, session, and base version. Mirror recoverable acknowledged drafts under OpenBar’s local data directory.
- Use one ordered save queue per resource. A save acknowledgement updates the saved version; it never replaces newer editor content.
- Serialize agent operations through an active resource’s editing session. Before applying an agent command, flush earlier input and validate the agent’s expected revision again.
- Use an authenticated browser session channel for MCP-to-live-session dispatch. If the browser disconnects or fails to acknowledge, return a structured error; do not silently switch to writing disk.
- When no live editing session owns a resource, MCP uses the repository service directly.
- Track session ownership across tabs/processes. A second browser session can read; taking over editing requires transferring or recovering the previous draft.
- Browser recovery handles tab closure without relying on an asynchronous unload save. Navigation failures keep the draft and expose Retry and Recover actions.
- Undo uses inverse operations against current state. If an inverse would overwrite intervening edits, preserve both versions and show a conflict.
- External file changes use an explicit refresh flow. Clean sessions reload; dirty sessions preserve their draft and show the changed repository version.

### Repair persistence defects

- Replace separate paper/journal locking with one canonical project write lock for transactions and recovery. Readers must never recover an actively executing transaction.
- Split lock-owning entrypoints from internal functions that assume the lock is held, avoiding nested acquisition.
- Extend the transaction journal to cover paper-plus-map operations, activity records, and retry receipts. Recovery validates before/after hashes and preserves evidence when files diverge.
- Keep transaction recovery and retry idempotent; an uncertain response must not create a duplicate TODO or apply a batch twice.
- Preserve compiler configuration during project metadata saves. Add typed `engine`, `mainFile`, and `texliveVersion` fields through schema, storage, settings UI, and tools.
- Keep wiki disabled at the server-action boundary. Reject dormant wiki mutations as unavailable.
- Restrict any retained wiki storage primitive to its designated directory; never accept a caller-controlled path that can overwrite manuscript files or instructions.
- Address project/workspace skill-name collisions with explicit scope plus ID. Instruction editors retain dirty text on refresh and report external changes.
- Keep user-authored comments, IDs, metadata, and incomplete structures intact during normalization.

### MCP and WebMCP

- Add an authenticated Streamable HTTP MCP endpoint at `/api/mcp`, using the existing access-token mechanism. Do not inherit unrestricted public-demo or local-browser access for this endpoint.
- MCP offers project-wide operations with explicit project and map identifiers. A browser does not need to be open for saved-state work.
- Keep WebMCP as the live browser adapter. Shared editing operations become available across project pages; focus and reader controls remain browser-specific capabilities.
- Generate schemas, argument validation, descriptions, and tool catalogs from one registry.
- Include paper/source editing, TODO operations, map editing, batch operations, attachments, project settings, instructions, activity, compilation, and Git status/sync.
- Add `preview_mindmap_batch` and `apply_mindmap_batch`. Preview returns an affected-item summary and revision-bound token. Apply requires that token for deletion and shared-TODO completion changes.
- Validate every batch before writing anything. A failed member rejects the batch; overlapping selected branches are counted once.
- Expose every durable editable field through both UI and tools. Unsupported browser-only actions return `capability_unavailable`, rather than simulated success.
- Repair the dropped TODO-existence callback, optional callbacks that can silently do nothing, and unstructured completion/reopening exceptions.
- Carry cancellation through execution. If cancellation arrives after persistence, return the committed receipt instead of claiming nothing happened.
- Replace the 30-second attachment dead end with lifecycle-aware discovery, explicit reconnect, and registration cleanup on host replacement.
- Tool descriptions specify ownership, destructive effects, prerequisites, revision source, retry behavior, and output limits. Remove stale wiki and independent-completion instructions.
- Provide bounded reads, pagination, and exact-match/range patches. Large source replacements require an explicit operation.
- Connection UI distinguishes server availability, browser support, registered tools, and successful calls. Record last successful call and a useful failure reason.
- Provide copyable MCP setup configuration and a read-only connection check. Actual attachment acceptance requires calling an OpenBar tool, not merely opening a URL.

## 3. Git, compilation, activity, and reliability fixes

### Git synchronization

Separate **local save**, **local commit**, and **remote synchronization** throughout the UI and tool results.

- Save locally without waiting for network access.
- Coalesce pending changes into a sync job after 10 seconds of inactivity, with a maximum 60-second delay during continuous editing. Provide Sync now.
- Serialize Git operations per repository. Resolve Git administrative paths through Git itself so ordinary checkouts and worktrees both work.
- Track exact changed paths from accepted operations. Do not stage unrelated project files, secrets, build products, or recovery data.
- Preserve the user’s existing index. If affected paths contain pre-existing staged work, pause automatic committing with an actionable explanation.
- Recheck file hashes while preparing the commit; a later save must not be accidentally included in an earlier receipt.
- Make the local commit independently of remote fetch success. Offline work remains safely committed.
- Fix retries when a previous commit exists but there are no newly staged files: push outstanding commits instead of returning early.
- Push explicitly to the validated Overleaf remote and branch. Never rely on an unrelated `pushRemote` or implicit push destination.
- Fetch before determining ahead/behind status. Report synchronized only when the intended remote contains the intended commit.
- Distinguish unconfigured remote, authentication failure, offline state, remote-ahead, divergence, commit failure, and push failure.
- Automatically fast-forward only when the repository and editing sessions are clean. Never automatically force-push, reset, stash authored work, or rewrite existing commits.
- For divergence, expose the relevant commits and a deliberate reconciliation action. Resolve ordinary text conflicts with both versions visible; paper/map records still pass their invariants before saving.
- Retry transient network failures with bounded backoff at 5, 15, and 60 seconds. Preserve the receipt and offer manual retry after that; do not repeatedly retry authentication or merge conflicts.
- Keep credentials in the existing credential mechanism and redact them from logs.
- Show remote branch, ahead/behind counts, latest local commit, and last successful sync in an on-demand panel.

### Compilation and PDF

- Compute the build identity from the complete immutable compilation snapshot: included TeX, bibliography, graphics, local styles/classes, compiler settings, and available toolchain identity.
- Use that identity for caching and stale detection. A failed build of current source must not make an older PDF appear current.
- Track latest attempted build separately from latest successful artifact.
- Give every PDF artifact its own manifest. Old artifact URLs resolve their own manifests instead of depending on the latest one.
- Retain the latest ten successful artifacts and any artifact currently displayed; cleanup removes only unreferenced older build outputs.
- Preserve full normalized relative source paths in SyncTeX. Match exact paths, not basenames or the first suffix match.
- Source jumps against a stale PDF must disclose that mismatch and avoid pretending old line numbers identify current text.
- Implement internal PDF destinations and safe external links.
- Render visible PDF pages plus one neighboring page on each side. Cancel obsolete rendering tasks and release documents/canvases.
- Preserve the last successful PDF when compilation fails, alongside the new failure log.
- Bound compiler execution to five minutes by default, terminate the process tree on timeout, and retain useful logs and status.
- Move expensive capability probes off ordinary health requests; cache them and provide an explicit refresh.
- Treat unavailable page counts and build metrics as unavailable, not zero or success.

### Recent activity

- Replace timestamp-only “recent” summaries with a durable append-only operation history under the project’s existing OpenBar metadata directory.
- Record authored field changes, moves, additions, deletions, TODO completion/reopening, and batch membership. Pan, zoom, selection, and collapse do not count.
- Include stable IDs, timestamps, actor category, affected resources, and bounded before/after details. Record events only after successful local persistence.
- Deduplicate shared TODO events by TODO ID when presenting them across maps.
- Highlight changes over a rolling **X-day window**, default seven. Store the chosen window per map and expose it through tools.
- Filter before pagination; remove the current fixed seven-day and early twelve-item truncation.
- Show details on demand. Deleted cards remain represented in the change list even though they have no live canvas position.
- Describe changes factually; do not invent experiment outcomes or scientific conclusions.
- On external refresh, record detected differences with an observation timestamp. Do not fabricate when the external edit actually occurred.
- Seed a baseline during migration and label earlier history unavailable rather than inventing it.

### Remaining interaction and maintenance fixes

- Replace the map’s render-ref/signature shortcut with explicit card data that updates when content, editing state, dimensions, or TODO state changes.
- Scope keyboard shortcuts to the focused canvas and current editing mode. Tab inside controls must not silently reparent cards.
- Fix math delimiter extraction before passing expressions to KaTeX.
- Remove the unused Markdown parser that can fail to advance on inputs such as `#tag`; consolidate rendering through a bounded parser and shared sanitization policy.
- Add page and local error boundaries with retry and draft recovery. Include loading, empty, unavailable, and disconnected states.
- Split the oversized paper editor, map editor, and server-action module by the responsibilities defined above.
- Remove dormant wiki tools, inaccurate documentation, redundant compatibility branches, and unused dependencies after checking imports.
- Keep optional future wiki work outside this release. Any later wiki editor should start with bounded reads and revision-checked section or exact-text patches, not routine whole-page replacement.

## 4. Interfaces and migration

### Public data changes

- Add card priority. Preserve existing labels, attachments, comments, and custom colors.
- Keep `todoId` as the only required paper binding; do not introduce experiment, conclusion, claim, or maturity entities.
- Add map activity-window preference and explicit selection state in the client. Selection and viewport are transient, not authored activity.
- Add compiler configuration to the project model.
- Introduce a shared version envelope and operation receipt containing affected resources, request ID, resulting versions, local persistence state, and separate remote state.
- Extend compile status to distinguish current input, attempted job, and successful artifact.
- Add versioned activity and recovery records without making them a second TODO database.

### Existing-data handling

- Inventory the dirty working tree and active manuscript repositories before implementation. Preserve existing uncommitted changes and make recoverable snapshots before migrating authored data.
- Use a versioned, explicit migration with a dry-run report. Do not rewrite repositories during ordinary reads.
- Preserve IDs, hierarchy, sibling order, TODO placement, authored text, labels, refs, and timestamps.
- Validate one instance of each TODO per map and complete Primary coverage through placed cards or Unplaced.
- Treat legacy automatic strip coloring as a display default to remove; preserve explicitly stored colors.
- Preserve existing valid 0–6 progress values for ordinary cards. Perform legacy percentage conversion once during migration, then reject invalid new values.
- For pending TODOs with legacy progress 6, migrate the displayed partial stage to 5 and record the adjustment. Do not complete paper TODOs merely because old independent progress was full.
- For completed TODOs, derive the full indicator from TeX and retain valid partial stages for later reopening.
- Preserve existing TeX-mode content and old references even when the new interface no longer promotes them.
- Back up unknown metadata before removing obsolete schema fields. Do not silently discard authored extensions.
- Update AGENTS.md and tool instructions to reflect optional P0–P3 card priority, linked TODO completion, generic cards, and both transports.
- Preserve existing repository paths and stored role values: `draft` means Primary; `planning` means secondary. Display the product name OpenBar.

## 5. Implementation order and acceptance

Implement in this order, with a reviewable checkpoint after each stage:

| Stage | Deliverable |
|---|---|
| 1 | Shared locking and recovery repairs, protected write boundaries, compiler-setting preservation, instruction-scope fix |
| 2 | Editing sessions, save queues, recovery, conflict handling, operation receipts, transaction-based undo |
| 3 | Git commit/push separation, safe retries, worktree support, accurate status |
| 4 | Shared command registry, MCP endpoint, WebMCP parity and reconnect diagnostics |
| 5 | Neutral visual system, responsive paper layout, in-place map cards, progress and priority |
| 6 | Multi-selection, atomic batch actions, deletion previews, measured layout |
| 7 | Complete build identity, artifact lifecycle, PDF navigation and rendering |
| 8 | Durable activity, migration, dead-code removal, documentation and final acceptance |

Read the installed Next.js guides before implementing framework changes. Keep the working development service available and validate the actual browser-facing address separately from internal server addresses.

**No maintained automated test or eval suite:** remove the existing suites, their package commands, and suite-only dependencies. Retain type checking, production builds, the operational doctor, connection diagnostics, and concise manual acceptance instructions. Temporary reproduction checks may be used during implementation without becoming maintained tests.

Acceptance must cover:

- **Durability:** type during saves; navigate during a save; reload with a draft; disconnect/restart; open competing tabs; edit externally; undo after an agent edit; recover an interrupted multi-file operation. No authored text disappears.
- **Deletion:** selected parent/child combinations, collapsed descendants, mixed ordinary/TODO cards, Primary Unplaced coverage, stale previews, duplicate retries, undo after reload, and intervening edits.
- **Batch edits:** mixed values, label addition/removal, linked completion/reopening, invalid moves, and one invalid operation in a batch. No partial batch applies.
- **Layout:** 390px phone, tablet, and desktop widths; browser zoom; long text; Markdown; images; many badges; expanded menus; side panels; mobile keyboard. Cards and controls remain readable and reachable without unintended overlap.
- **Paper/PDF:** mobile source-to-preview scrolling, selection retention, incomplete tables, repeated source basenames, bibliography-only and image-only changes, failed builds, old artifact URLs, links, and long documents.
- **Git:** ordinary checkout and worktree; pre-staged work; offline commit; failed push followed by retry with no new changes; conflicting push configuration; remote-ahead/diverged states; concurrent saves; expired credentials. No false “synced” state.
- **Agents:** real MCP initialize/list/read/edit flow on a disposable project; real WebMCP registration and call in a capable browser; late attachment; navigation; cancellation; missing callbacks; shared TODO edits; draft conflicts; UI/tool field parity.
- **Activity:** configurable windows beyond seven days, pagination, deleted/reopened items, one batch represented coherently, and no invented historical events.

Record each acceptance result as **passed, failed, or not run**, with concise evidence. A successful build does not establish editing safety, Git synchronization, or WebMCP attachment.
