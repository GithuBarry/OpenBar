# Task 3 report

## Status

Task 3 is complete. OpenBar now uses the browser WebMCP runtime and server
actions without the HTTP MCP endpoint, standalone server, HTTP client scripts,
route-only access helper, SDK dependency, or HTTP package scripts. The model
context discovery link is removed. The listed shared modules describe browser
WebMCP and server-action usage.

The five HTTP-only targets were removed:

- `app/api/mcp/route.ts`
- `mcp/server.ts`
- `scripts/mcp-call.ts`
- `scripts/webmcp-demo.ts`
- `lib/server/mcp-access.ts`

The four active setup tools remain in `SETUP_WEBMCP_TOOL_NAMES`:

- `get_capabilities`
- `inspect_repository`
- `preview_conversion`
- `apply_conversion`

The existing deletion of `lib/research/migration.ts` was preserved. The
WebMCP registration lifecycle and Citation.js files were left unchanged.

## Commit

Implementation commit: `4e4f3ded15e9bf5adca0bbe051f651371d667d9e`

Commit message: `chore: remove HTTP MCP interface`

The commit contains 14 Task 3 files. Existing user edits in the worktree were
kept outside the commit. The mixed files `lib/research/operations.ts`,
`lib/tex-project/paper-compose.ts`, and
`lib/tex-project/tex-repo-setup-guide.ts` retain their current user code in
the worktree. The commit carries only their intended Task 3 comment and actor
type edits.

## Tests and raw key results

| Command | Result | Raw key result |
| --- | --- | --- |
| `pnpm install --lockfile-only --offline` | PASS | `Lockfile passes supply-chain policies`; `Packages: -84`; `- @modelcontextprotocol/sdk 1.29.0`; `Done in 3.6s using pnpm v11.9.0` |
| `pnpm exec tsx --test test/.tmp-webmcp-only.test.ts` after removal and alias | PASS | `ℹ tests 5`; `ℹ pass 5`; `ℹ fail 0`; `ℹ cancelled 0`; `ℹ skipped 0` |
| `pnpm clean && pnpm typecheck` | PASS | `$ rm -rf .next tsconfig.tsbuildinfo`; `$ tsc --noEmit` |
| package removal assertions | PASS | `package removal assertions passed` |
| `git diff --check` | PASS | No output and exit code 0 |

The required temporary test output was:

```text
✔ project WebMCP stays focused on project context
✔ workspace WebMCP lists, searches, and opens projects
✔ update_project requires a metadata field
✔ project layout uses the focused project catalog
✔ HTTP MCP files and dependency are removed
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

The test-first baseline recorded the expected pending-removal failure:

```text
✖ HTTP MCP files and dependency are removed
AssertionError [ERR_ASSERTION]: app/api/mcp/route.ts
true !== false
```

The current user-edited test also referenced `buildProjectWebMcpTools` while
the existing Task 2 contract exposed the same catalog as
`buildSharedWebMcpTools`. A pure alias was added to
`lib/research/webmcp-shared-contract.ts`. The post-removal test then reported
`ℹ pass 5` and `ℹ fail 0`.

The first typecheck after route deletion found stale ignored generated files:

```text
.next/dev/types/validator.ts(143,39): error TS2307: Cannot find module '../../../app/api/mcp/route.js'
.next/types/validator.ts(143,39): error TS2307: Cannot find module '../../app/api/mcp/route.js'
```

Clearing generated `.next` output with the existing clean script resolved that
generated-state error. The following typecheck exited 0.

## Concerns

- The worktree contains many pre-existing user edits and untracked files. They
  remain outside the implementation commit.
- A user-edited `app/about/page.tsx` still contains a visible sentence that
  names `/api/mcp`. A user-edited `lib/research/webmcp-mindmap-contract.ts`
  still has a comment that compares its schemas with HTTP MCP operations. Both
  files were outside the Task 3 file list and were preserved.
- `lib/research/webmcp-register.ts` still contains the `model-context` event
  names required by the native WebMCP lifecycle. That file was intentionally
  left unchanged.
- The offline lockfile command reported two existing deprecated subdependency
  warnings: `hast@1.0.0` and `node-domexception@1.0.0`.
