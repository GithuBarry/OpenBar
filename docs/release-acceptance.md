# OpenBar release acceptance

Run these checks from the repository root after installing dependencies.

## Automated release checks

| Check | Result | Evidence |
| --- | --- | --- |
| TypeScript | passed | `pnpm typecheck` exited 0 |
| Production build | passed | `pnpm build` exited 0 |
| Domain invariants | passed | Raw output ended with `Domain checks passed.` |
| Connection smoke | passed | `OB_SMOKE_SLUGS=[project-a-redacted],[project-b-redacted] pnpm smoke` passed against the built server |
| Operational doctor | passed | `pnpm openbar doctor --all` exited 0 |
| Browser WebMCP journey | passed in pure contract eval before suite retirement | Raw output ended with `WebMCP evals passed.` |
| Node test suite | retired per PLAN (2) | The pre-retirement run reported 37 passed and 2 failures from stale fixture assumptions |
| Git diff hygiene | passed | `git diff --check` exited 0 |

The built-server route check returned these raw statuses:

```text
200 /p/[project-a-redacted]/wiki
200 /p/[project-a-redacted]/wiki/overview
404 /p/[project-a-redacted]/wiki/missing-page
200 /p/[project-b-redacted]/wiki
```

The retired suite failures were:

```text
AssertionError: assert.ok(section)
actual: undefined

Expected values to be strictly equal:
+ actual - expected
+ './sections/evaluation.tex'
- 'evaluation.tex'
```

The second result reflects the current full normalized source path contract.

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
