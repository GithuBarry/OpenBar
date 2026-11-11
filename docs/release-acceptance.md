# OpenBar release acceptance

Run these preparation steps from the repository root after installing dependencies.

## Release preparation

Run the build and operational checks from the repository root:

```bash
pnpm typecheck
pnpm build
pnpm openbar doctor --all
git diff --check
```

The retained operational checks cover these areas:

| Check | Command | Scope |
| --- | --- | --- |
| TypeScript | `pnpm typecheck` | Application type checking |
| Production build | `pnpm build` | Next standalone output |
| Operational doctor | `pnpm openbar doctor --all` | Experimental workspace-registry and checkout inspection |
| Git diff hygiene | `git diff --check` | Whitespace errors in the worktree |

Build each release in a fresh output directory, for example
`OB_DIST=.next-release-20261104 pnpm build`. Keep the running release available
while checking the candidate. A reused webpack cache produced a LaTeX parser
chunk for an older preview worker in the November 4 recovery run. The build and
type check passed, while browser table rendering raised
`Cannot read properties of null (reading 'parse')`. A fresh output directory
produced matching parser and worker chunks and passed browser rendering.

Serve the packaged production output with a disposable copy of the content
store. Check a paper containing tables and PDF figures in the actual browser
worker before switching the live service. Retain the previous release for
rollback, and compare source hashes before and after candidate verification.

The supported product inventory is the web content-store project inventory.
The operational doctor and `projects list` CLI commands inspect the separate
experimental workspace registry. Their human output and JSON metadata carry
that inventory label, with registry results remaining separate from web results
until registration and web integration share one inventory.

The clean-checkout CI workflow covers type checking and a production build
with Node 26.8.1 and pnpm 11.9.0. Docker image creation is a separate
deployment operation. Run
`pnpm docker:build` using the instructions in [deploy/README.md](../deploy/README.md).

Browser WebMCP behavior uses the manual journey below with a capable browser
session.

The built-server route check returned these raw statuses in the recorded
acceptance run:

```text
200 /p/[project-a-redacted]/wiki
200 /p/[project-a-redacted]/wiki/overview
404 /p/[project-a-redacted]/wiki/missing-page
200 /p/[project-b-redacted]/wiki
```

## Manual browser acceptance

1. Start the local app and open a disposable project in two browser tabs.
   On the project board, reorder with mouse and touch, archive and restore a
   project, cancel with Escape, and drop outside the board. Compare the visible
   order with the saved order after each gesture. Trigger a stale revision from
   the second tab and confirm the current layout and readable recovery message.
2. Type into the paper source while switching between paper and mindmap. Reload during a save and confirm the latest draft remains recoverable.
3. Open the mindmap. Edit a card, set P0–P3 priority, choose each table-width mode, add an image, and confirm the map reload preserves every field.
4. Bind the same TODO on Primary and a secondary map. Complete and reopen it from either map, then confirm TeX owns the shared completion state while each map retains its local progress.
5. Preview and apply a mixed batch with labels, priority, movement, and deletion. Change the map between preview and apply and confirm the token is rejected with a stale revision result.
6. Compile twice with a source change between runs. Open an older PDF artifact URL and confirm it resolves to its own manifest. Trigger a failed compile and confirm the last successful artifact remains available.
   Exercise the official PDF.js viewer at narrow and wide pane sizes, manual zoom,
   Fit, text selection, internal and external links, and both directions of SyncTeX.
   Open a figure from a later PDF page and confirm its original page number is
   used for source navigation. Replace the compiled artifact while viewing a later
   page and confirm the viewing position survives.
7. Check Git status, create a local commit, simulate a failed remote sync, then retry synchronization with the same commit hash. Confirm the receipt distinguishes local persistence from remote visibility.
8. Open the wiki. Read an existing page and confirm create, edit, rename, and delete controls report the unavailable capability while paper TODOs remain available.
9. Check Paper Appearance and the mindmap inspector with pointer and keyboard
   input at desktop and phone widths. Confirm selected segments have a visible
   fill, wrapping preserves separate labels, and each control stays in view.
   Check the Color menu choices and reload persistence.
10. Open every bundled example paper. Confirm current heading addresses match
    the raw source, outline tooltips show substantive text, bibliography links
    resolve, and every PDF figure renders. Include equations with labels, tables
    with spanning cells, and framed content containing nested text and markers.

## Authenticated MCP acceptance

Set `OPENBARRY_ACCESS_TOKEN` for the running server and call `/api/mcp` with
the matching bearer token.

1. Connect with the current official SDK client. Repeat with a 2025 client and the stdio bridge, using the SDK's stateless HTTP support.
2. Call `tools/list` and confirm project reads, bounded paper and mindmap reads, batch preview and apply, activity, compile, and Git tools appear.
3. Call `get_project_state`, `get_mindmap`, and `get_source_bundle` with bounded limits.
4. Call one revision-checked map patch with a request id. Retry the same request id and confirm one durable receipt.
5. Call `read_wiki_page` and confirm the registry contains no wiki mutation tool.
6. Remove or change the bearer token and confirm the endpoint returns HTTP 401 or 503 according to configuration state.
