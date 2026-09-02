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

The initial Task 2 commit was `abeef0b`. This report update is amended into the same commit.

## Changed files

- `lib/research/webmcp-workspace-contract.ts`
- `features/use-workspace-webmcp.ts`
- `lib/research/mcp-tool-schemas.ts`
- `lib/research/webmcp-shared-contract.ts`
- `features/webmcp-actions.ts`
- `app/actions.ts`
- `app/page.tsx`
- `features/instructions/use-instructions-webmcp.ts`

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
