# Task 5 report

## Status

Implemented the native WebMCP lifecycle reduction for the current browser
evidence. The hooks pass their own page AbortSignal directly to
`document.modelContext.registerTool`. The helper keeps one small local catalog
for page grouping and diagnostics, while Agent Ready reads
`document.modelContext.getTools()` when that native catalog is available.
Native signal cleanup owns the registered tool lifecycle. The active-owner,
pending-registration, Chrome-controller, and execute-routing maps are gone.

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

## Commit

The implementation commit hash is reported by the controller because this
report is included in that same commit.
