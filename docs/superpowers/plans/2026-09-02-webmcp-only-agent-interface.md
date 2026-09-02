# WebMCP-only Agent Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove HTTP MCP from OpenBar and make browser WebMCP the single agent interface with a small workspace catalog and focused page catalogs.

**Architecture:** The home page owns workspace actions for listing, searching, and opening projects. Project pages expose only project context actions, while paper, mindmap, wiki, and instructions pages expose actions that depend on their live state. Browser tools continue to use existing server actions and pure contracts. Raw TeX inspection remains a repository task.

**Tech Stack:** Next.js 16.3.3, React 19, TypeScript, browser WebMCP `navigator.modelContext`, Next server actions, Zod-backed WebMCP contracts, Node test runner, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-02-research-trust-repairs-design.md`

## Global Constraints

- OpenBar uses browser WebMCP as its single agent interface.
- The HTTP MCP endpoint, standalone MCP server, HTTP client scripts, HTTP-only authentication and session code, and HTTP transport documentation are removed.
- The home page exposes a small workspace group for listing, searching, and opening projects.
- Project pages expose only the small project context group plus tools for the page's live state.
- Raw TeX inspection remains a repository task.
- Each new regression check is temporary and is removed before final verification.
- Existing TODO title, icon editing, reader appearance, metrics, TeX focus, map ownership, and paper persistence behavior remain intact.

---

### Task 1: Add a temporary failing contract check

**Files:**
- Create: `test/.tmp-webmcp-only.test.ts`
- Read: `lib/research/mcp-tool-schemas.ts`
- Read: `lib/research/webmcp-shared-contract.ts`

**Interfaces:**
- Consumes: current project tool names and the planned `buildWorkspaceWebMcpTools` export.
- Produces: a temporary red test for the final browser catalog and HTTP removal targets.

- [ ] **Step 1: Write the failing test**

Create the scratch test with these assertions:

```ts
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PROJECT_WEBMCP_TOOL_NAMES } from "../lib/research/mcp-tool-schemas";
import { buildWorkspaceWebMcpTools } from "../lib/research/webmcp-workspace-contract";

test("project WebMCP stays focused on project context", () => {
  assert.deepEqual(PROJECT_WEBMCP_TOOL_NAMES, [
    "get_project_state",
    "search_project",
    "navigate_project",
    "update_project",
  ]);
});

test("workspace WebMCP lists, searches, and opens projects", async () => {
  let navigated = "";
  const tools = buildWorkspaceWebMcpTools({
    actions: {
      listProjects: async () => [{ slug: "dense-retrieval", title: "Dense retrieval under load", href: "/p/dense-retrieval/paper" }],
      searchProjects: async (query) => [{ slug: query, title: query, href: `/p/${query}/paper` }],
      openProject: async (slug) => ({ slug, title: slug, href: `/p/${slug}/paper` }),
    },
    navigate: (href) => { navigated = href; },
  });
  assert.deepEqual(tools.map((tool) => tool.name), ["list_projects", "search_projects", "open_project"]);
  const open = tools.find((tool) => tool.name === "open_project");
  assert.ok(open);
  const result = await open.execute({ slug: "dense-retrieval" }) as { ok?: boolean };
  assert.equal(navigated, "/p/dense-retrieval/paper");
  assert.equal(result.ok, true);
});

test("HTTP MCP files and dependency are removed", () => {
  for (const relative of ["app/api/mcp/route.ts", "mcp/server.ts", "scripts/mcp-call.ts", "scripts/webmcp-demo.ts"]) {
    assert.equal(fs.existsSync(path.join(process.cwd(), relative)), false, relative);
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  assert.equal(packageJson.dependencies?.["@modelcontextprotocol/sdk"], undefined);
  for (const name of ["mcp", "mcp:http", "mcp:stdio", "mcp:call", "demo:webmcp"]) {
    assert.equal(packageJson.scripts?.[name], undefined, name);
  }
});
```

- [ ] **Step 2: Run the temporary test to verify it fails**

Run: `pnpm exec tsx --test test/.tmp-webmcp-only.test.ts`

Expected: FAIL because the workspace contract is absent, the current project catalog has the older shared set, and the HTTP files and dependency still exist.

---

### Task 2: Add the workspace catalog and reduce project context tools

**Files:**
- Create: `lib/research/webmcp-workspace-contract.ts`
- Create: `features/use-workspace-webmcp.ts`
- Modify: `lib/research/mcp-tool-schemas.ts`
- Modify: `lib/research/webmcp-shared-contract.ts`
- Modify: `features/webmcp-actions.ts`
- Modify: `app/actions.ts`
- Modify: `app/page.tsx`
- Modify: `features/use-shared-webmcp.ts`
- Modify: `components/shell/project-agent-shell.tsx`
- Modify: `features/instructions/use-instructions-webmcp.ts`

**Interfaces:**
- Consumes: `registerWebMcpToolsIndependent`, `waitForModelContext`, project access guards, and the existing server-action write layer.
- Produces: `buildWorkspaceWebMcpTools`, `useWorkspaceWebMcp`, `PROJECT_WEBMCP_TOOL_NAMES`, and a four-tool project catalog.

- [ ] **Step 1: Define workspace types and schemas**

Add `WorkspaceProjectResult`, `WorkspaceWebMcpActions`, and `WorkspaceWebMcpHost` with these signatures:

```ts
export type WorkspaceProjectResult = {
  slug: string;
  title: string;
  href: string;
  tagline?: string;
  icon?: string;
};

export type WorkspaceWebMcpActions = {
  listProjects: () => Promise<WorkspaceProjectResult[]>;
  searchProjects: (query: string) => Promise<WorkspaceProjectResult[]>;
  openProject: (slug: string) => Promise<WorkspaceProjectResult | null>;
};

export type WorkspaceWebMcpHost = {
  actions: WorkspaceWebMcpActions;
  navigate: (href: string) => void;
};
```

Register `list_projects`, `search_projects`, and `open_project`. Validate non-empty input, return an `invalid_arguments` result for an unknown project, navigate to `/p/${encodeURIComponent(slug)}/paper`, and return the opened project summary.

- [ ] **Step 2: Add workspace server actions**

Add these actions to `app/actions.ts`:

```ts
export async function listWorkspaceProjectsAction(): Promise<WorkspaceProjectResult[]>;
export async function searchWorkspaceProjectsAction(query: string): Promise<WorkspaceProjectResult[]>;
export async function openWorkspaceProjectAction(slug: string): Promise<WorkspaceProjectResult | null>;
```

Each action calls `requireWorkbenchAccess()`. Summaries come from `listProjects()` and include slug, title, optional tagline and icon, plus the encoded paper href. Search matches slug, title, tagline, and label case-insensitively. Opening validates with `getProject(slug)`.

- [ ] **Step 3: Bind and mount workspace tools**

Add `workspaceWebMcpActions` to `features/webmcp-actions.ts`. Implement `useWorkspaceWebMcp` with the existing abort and release lifecycle. Mount a client component from `app/page.tsx` so `/` registers the workspace catalog.

- [ ] **Step 4: Reduce project and instructions catalogs**

Rename the project list to `PROJECT_WEBMCP_TOOL_NAMES` and set it to:

```ts
["get_project_state", "search_project", "navigate_project", "update_project"] as const
```

Move `read_project_skill` into an instructions-only builder. Keep setup tools on the instructions page. Update all builders and imports, then run the temporary contract test. The catalog and workspace tests should pass at this point.

---

### Task 3: Remove HTTP MCP and its dependency

**Files:**
- Delete: `app/api/mcp/route.ts`
- Delete: `mcp/server.ts`
- Delete: `scripts/mcp-call.ts`
- Delete: `scripts/webmcp-demo.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `app/layout.tsx`
- Modify: `lib/research/mcp-tool-schemas.ts`
- Modify: `lib/research/operation-result.ts`
- Modify: `lib/research/operation-service.ts`
- Modify: `lib/research/operations.ts`
- Modify: comments in `lib/tex-project/pandoc.ts`, `lib/tex-project/paper-compose.ts`, and `lib/tex-project/tex-repo-setup-guide.ts`

**Interfaces:**
- Consumes: browser WebMCP contracts and server actions from Task 2.
- Produces: a browser-only runtime with no HTTP MCP endpoint, SDK dependency, or HTTP client entrypoint.

- [ ] **Step 1: Remove scripts, dependency, and discovery link**

Remove `demo:webmcp`, `mcp`, `mcp:http`, `mcp:stdio`, and `mcp:call` from `package.json`. Remove `@modelcontextprotocol/sdk` from dependencies. Remove the `/api/mcp` model-context link from `app/layout.tsx`.

- [ ] **Step 2: Delete the HTTP files**

Delete the four files listed above. Keep browser contracts, browser registration, and pure research operations.

- [ ] **Step 3: Regenerate the lockfile**

Run: `pnpm install --lockfile-only --offline`

Expected: the SDK and unused transitive packages disappear from `pnpm-lock.yaml` while the remaining dependency graph stays intact.

- [ ] **Step 4: Remove stale HTTP wording**

Update comments and descriptions so shared operation modules describe browser WebMCP and server actions. Remove claims that HTTP MCP exposes the browser contract.

- [ ] **Step 5: Run the temporary removal test**

Run: `pnpm exec tsx --test test/.tmp-webmcp-only.test.ts`

Expected: all temporary tests pass.

---

### Task 4: Align documentation and About copy

**Files:**
- Modify: `README.md`
- Modify: `docs/webmcp.md`
- Modify: `app/about/page.tsx`

**Interfaces:**
- Consumes: final workspace and project tool names from Tasks 2 and 3.
- Produces: documentation that describes the browser-only runtime accurately.

- [ ] **Step 1: Update README**

Describe browser WebMCP as the agent interface. Document workspace tools on `/`, project context tools, and page-local tools. Remove the HTTP route, endpoint setup, HTTP server commands, endpoint tokens, and HTTP demo commands.

- [ ] **Step 2: Rewrite the WebMCP guide**

Document this journey:

```text
open /
→ list_projects or search_projects
→ open_project
→ get_project_state
→ navigate_project
→ use paper, mindmap, wiki, or instructions tools
```

Explain that models can inspect the TeX repository directly for raw source details. Explain that WebMCP handles live editor state, selected cards, navigation, focus, and visible page actions.

- [ ] **Step 3: Update About copy and search references**

Describe Agent Ready as browser WebMCP registration on the active page. Run:

```text
rg -n "HTTP MCP|/api/mcp|mcp-call|mcp:http|mcp:stdio|demo:webmcp|OPENBAR_MCP|OPENBARRY_MCP" README.md docs app features lib mcp scripts package.json pnpm-lock.yaml || true
```

Expected: zero implementation or command references. Historical text in the approved spec may remain.

---

### Task 5: Finish temporary verification and browser smoke

**Files:**
- Delete: `test/.tmp-webmcp-only.test.ts`
- Inspect: `test/*.test.ts`, `scripts/check-research-invariants.ts`, `scripts/webmcp-evals.ts`

**Interfaces:**
- Consumes: final workspace and page-local browser registrations.
- Produces: a clean repository with durable checks and browser smoke evidence.

- [ ] **Step 1: Run the temporary test once more**

Run: `pnpm exec tsx --test test/.tmp-webmcp-only.test.ts`

Expected: all temporary tests pass before removal.

- [ ] **Step 2: Remove the temporary test**

Delete `test/.tmp-webmcp-only.test.ts` with `apply_patch`.

- [ ] **Step 3: Run final checks**

Run in parallel:

```text
pnpm typecheck
pnpm test
pnpm check:domain
pnpm evals
git diff --check
```

Expected: every command exits with code 0.

- [ ] **Step 4: Run live browser smoke**

Verify `/` registers `list_projects`, `search_projects`, and `open_project`, and home icon editing still focuses the icon field. Verify paper and mindmap pages register their focused catalogs, the appearance and metrics UI remain available, Tab adds a child, and TODO cards open their paper anchor. Verify the instructions page registers project context, skill, and setup tools.

- [ ] **Step 5: Confirm final removal**

Run:

```text
rg -n "@modelcontextprotocol/sdk|/api/mcp|mcp-call|mcp:http|mcp:stdio|demo:webmcp|OPENBAR_MCP|OPENBARRY_MCP" . --glob '!node_modules/**' --glob '!.next/**' || true
git status --short
```

Expected: no HTTP MCP implementation references, the temporary test is absent, and pre-existing user changes remain preserved.
