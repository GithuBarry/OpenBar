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
2. Type into the paper source while switching between paper and mindmap. Reload during a save and confirm the latest draft remains recoverable.
3. Open the mindmap. Edit a card, set P0–P3 priority, choose each table-width mode, add an image, and confirm the map reload preserves every field.
4. Bind the same TODO on Primary and a secondary map. Complete and reopen it from either map, then confirm TeX owns the shared completion state while each map retains its local progress.
5. Preview and apply a mixed batch with labels, priority, movement, and deletion. Change the map between preview and apply and confirm the token is rejected with a stale revision result.
6. Compile twice with a source change between runs. Open an older PDF artifact URL and confirm it resolves to its own manifest. Trigger a failed compile and confirm the last successful artifact remains available.
7. Check Git status, create a local commit, simulate a failed remote sync, then retry synchronization with the same commit hash. Confirm the receipt distinguishes local persistence from remote visibility.
8. Open the wiki. Read an existing page and confirm create, edit, rename, and delete controls report the unavailable capability while paper TODOs remain available.

## Authenticated MCP acceptance

Set `OPENBARRY_ACCESS_TOKEN` for the running server and call `/api/mcp` with
the matching bearer token.

1. Send `initialize` and retain `Mcp-Session-Id`.
2. Call `tools/list` and confirm project reads, bounded paper and mindmap reads, batch preview and apply, activity, compile, and Git tools appear.
3. Call `get_project_state`, `get_mindmap`, and `read_paper_source` with bounded limits.
4. Call one revision-checked map patch with a request id. Retry the same request id and confirm one durable receipt.
5. Call `read_wiki_page` and confirm the registry contains no wiki mutation tool.
6. Remove or change the bearer token and confirm the endpoint returns HTTP 401 or 503 according to configuration state.
