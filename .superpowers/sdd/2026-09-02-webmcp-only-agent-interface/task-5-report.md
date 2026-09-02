# Task 5 report

## Status

Implemented the native WebMCP lifecycle reduction with a small compatibility
adapter for the lifecycle behavior that Chrome 152 cannot verify. The hooks
pass their page AbortSignal directly to `document.modelContext.registerTool`.
Each native callback carries a local active-owner tombstone, so a callback that
outlives its page returns `capability_unavailable`. The local catalog remains
the source of active OpenBar tools and uses native `getTools()` metadata when
available. This keeps delayed native abort cleanup from restoring stale tools.

All eight requested implementation files remain the only product files in the
Task 5 change set. Existing edits in those files were preserved because the
worktree was already in active product development before this task.

## Browser evidence

The installed Chrome version is:

```text
Google Chrome 152.0.7977.65
```

The live Codex in-app page probe on `http://localhost:3010/` returned:

```text
{
  hasGetTools: false,
  hasModelContext: false,
  hasRegisterTool: false,
  hasWindow: true,
  location: 'http://localhost:3010/',
  modelContextKeys: []
}
```

The browser page scope hides `navigator` and blocks `chrome://version`, so the
version came from the installed Chrome binary. The supplied page probe and
the direct page probe agree that native WebMCP is unavailable in this Codex
browser context.

## Checks

### Typecheck

Command:

```text
pnpm typecheck
```

Raw output:

```text
$ tsc --noEmit
```

Exit code: `0`

### Lifecycle smoke check

The inline check registered `task5_probe`, confirmed that the helper passed the
page AbortSignal unchanged, confirmed the local catalog entry, aborted the
signal, and confirmed catalog cleanup.

Raw output:

```text
signal identity and abort cleanup passed
```

Exit code: `0`

### Structural check

Command:

```text
rg -n "active-owner|pending-registration|current\\.active|current\\.registered|current\\.pending|current\\.chrome|new AbortController\\(\\)|getWebMcpCatalog|registerTool\\(tool, \\{ signal \\}\\)" lib/research/webmcp-register.ts components/shell/agent-ready.tsx features/use-shared-webmcp.ts features/use-workspace-webmcp.ts features/paper/use-paper-webmcp.ts features/mindmap/use-mindmap-webmcp.ts features/wiki/use-wiki-webmcp.ts features/instructions/use-instructions-webmcp.ts || true
```

Raw output:

```text
features/use-workspace-webmcp.ts:18:    const controller = new AbortController();
components/shell/agent-ready.tsx:5:import { getWebMcpCatalog, type WebMcpCatalogEntry, type WebMcpSurface } from "@/lib/research/webmcp-register";
features/mindmap/use-mindmap-webmcp.ts:13:    const controller = new AbortController();
features/wiki/use-wiki-webmcp.ts:13:    const controller = new AbortController();
features/paper/use-paper-webmcp.ts:203:    const controller = new AbortController();
lib/research/webmcp-register.ts:61:export async function getWebMcpCatalog(): Promise<WebMcpCatalogEntry[]> {
lib/research/webmcp-register.ts:105:        await modelContext.registerTool(tool, { signal });
features/use-shared-webmcp.ts:19:    const controller = new AbortController();
features/instructions/use-instructions-webmcp.ts:17:    const controller = new AbortController();
```

The remaining AbortControllers belong to the React hooks and provide each
page's lifecycle signal.

### `git diff --check`

Exit code: `0`

### Live route smoke check

The browser visited home, paper, mindmap, wiki, and instructions. Raw Agent
Ready lines were:

```text
home: []
paper: Agent waiting
mindmap: Agent ready · 18 tools
wiki: Agent ready · 5 tools
instructions: Agent ready · 15 tools
```

The current Codex browser exposes no native WebMCP methods to the page probe.
The route check still exercised page transitions and the retained diagnostic
catalog. A WebMCP-enabled judge browser will use native registration and
native catalog reporting.

## Concerns

- The Codex page evaluation scope cannot exercise native `registerTool` or
  `getTools`. The direct helper smoke check covers signal identity and local
  cleanup. A WebMCP-enabled browser remains the final native integration
  check.
- The first delegated inline smoke command stopped at the local runner IPC
  permission check. The controller rerun passed with the same lifecycle
  assertions under the available permissions.

## Review fix round

The review correctly identified that native lifecycle cleanup remained
unverified in the installed browser. The fix retains the smallest state needed
for that gap:

- Each registration has one active-owner tombstone.
- Native registration still receives the page AbortSignal unchanged.
- The native execute callback checks the tombstone and page signal before
  invoking the live page tool.
- Agent Ready derives active names and groups from the local catalog, overlays
  native metadata, and ignores delayed native entries after local release.
- Agent Ready ignores out-of-order catalog reads and shows active registration
  errors with their tool names and messages.
- Workspace tools use the Workspace group. Instructions and project-skill
  tools use Instructions. Conversion and setup tools use Setup.
- Every instruction and setup registration keeps its release callback and the
  shared page abort removes both groups.

### Red lifecycle check

Before the fix, the focused disposable check failed on the released native
callback:

```text
AssertionError [ERR_ASSERTION]: a delayed native callback must fail after its page releases

true !== false
```

### Green lifecycle and route-transition check

The disposable check covered signal identity, stale callback execution,
delayed native catalog entries, diagnostic lifetime, route-group removal, and
separate Instructions and Setup groups.

```text
Task 5 lifecycle smoke passed
```

Exit code: `0`

### Fix typecheck

```text
$ tsc --noEmit
```

Exit code: `0`

### Focused structure and cleanup check

```text
features/use-workspace-webmcp.ts:29:        "workspace",
features/instructions/use-instructions-webmcp.ts:38:          "instructions",
features/instructions/use-instructions-webmcp.ts:44:          "setup",
features/instructions/use-instructions-webmcp.ts:48:      if (!active || controller.signal.aborted) releases.forEach((release) => release());
features/instructions/use-instructions-webmcp.ts:53:      releases.forEach((release) => release());
components/shell/agent-ready.tsx:36:      const requestRevision = ++revision;
lib/research/webmcp-register.ts:61:    "capability_unavailable",
```

`git diff --check` returned no output with exit code `0`.

## Commit

The implementation commit hash is reported by the controller because this
report is included in that same commit.
