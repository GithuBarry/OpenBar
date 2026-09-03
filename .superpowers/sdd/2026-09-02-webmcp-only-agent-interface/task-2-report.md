# Task 2 report

## Status

Task 2 is complete. OpenBar now has a browser-safe workspace WebMCP contract,
three guarded workspace server actions, a client registration hook, and a home
page mount. Project pages expose the focused four-tool catalog. The
`read_project_skill` tool is registered on the instructions page with the
existing setup tools.

The HTTP MCP route, server, scripts, access helper, dependency, and package
scripts remain present for Task 3. The native WebMCP lifecycle helper remains
unchanged for Task 5.

## Commit

The initial Task 2 commit was `0343257`. This report update is amended into the same commit.

## Changed files

- `lib/research/webmcp-workspace-contract.ts`
- `features/use-workspace-webmcp.ts`
- `lib/research/mcp-tool-schemas.ts`
- `lib/research/webmcp-shared-contract.ts`
- `features/webmcp-actions.ts`
- `app/actions.ts`
- `app/page.tsx`
- `features/instructions/use-instructions-webmcp.ts`
- `features/use-shared-webmcp.ts`
- `components/shell/project-agent-shell.tsx`

Existing user edits across the worktree were preserved. Files outside the
Task 2 path set remain unstaged.

## Tests

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm typecheck` | PASS | `tsc --noEmit` exited 0 |
| `pnpm test` | PASS | 11 tests passed, 0 failed |
| `pnpm exec tsx --test test/.tmp-webmcp-only.test.ts` | PASS for Task 2, deferred failure for Task 3 | 2 tests passed. The HTTP test failed at `app/api/mcp/route.ts` with `true !== false`, as expected while Task 3 remains pending. |
| Focused catalog smoke check | PASS | `workspace, project, instructions, and setup catalogs verified` |
| `git diff --check` | PASS | No whitespace errors |

The first ad-hoc catalog smoke invocation used top-level `await` in the
CommonJS evaluator and failed before running assertions. The corrected async
invocation passed.

## Concerns

- The temporary contract test exits 1 because its third test covers Task 3's
  HTTP removal. That failure is intentionally retained.
- The five HTTP-removal targets remain present by request.
- No native lifecycle reduction was attempted.

## Task 2 fix round

Status: The focused fix round is committed.

Commit: `9719b3b`

The `update_project` executor now tracks metadata fields separately from the
required `expectedHash`. An expected-hash-only request returns
`invalid_arguments` before `updateProject` runs.

The shared project hook keeps the independent registration signal set to
`"shared"`. The project shell integration mounts the project-scoped WebMCP
registration for each project layout and derives the current paper, mindmap,
wiki, or instructions location from the active route and hash.

Focused verification already run:

- `pnpm typecheck`: PASS, `tsc --noEmit` exited 0.
- `pnpm exec tsx --test test/.tmp-webmcp-only.test.ts`: the workspace,
  project-catalog, and empty-metadata guard assertions passed. The HTTP
  removal assertion failed at `app/api/mcp/route.ts` with `true !== false`,
  which remains the deferred Task 3 result.

Concerns:

- HTTP MCP removal remains deferred to Task 3.
- Native lifecycle reduction remains deferred to its later task.
