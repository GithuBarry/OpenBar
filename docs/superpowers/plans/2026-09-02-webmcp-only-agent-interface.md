# WebMCP-only Agent Interface and Reduction Pass Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove HTTP MCP from OpenBar, make browser WebMCP the single agent interface, and complete the evidence-led deletion and reuse pass from the repository review.

**Architecture:** The home page owns workspace actions for listing, searching, and opening projects. Project pages expose only project context actions, while paper, mindmap, wiki, and instructions pages expose actions that depend on their live state. Browser tools continue to use existing server actions and pure contracts. Raw TeX inspection remains a repository task. The plan first verifies the browser's native WebMCP lifecycle, then removes the extra registration machinery when the browser supports the needed signal and catalog behavior. Citation.js becomes the single BibTeX parser after fixture checks. Compatibility code is removed after caller scans.

**Tech Stack:** Next.js 16.3.3, React 19, TypeScript, browser WebMCP `document.modelContext`, Next server actions, Zod-backed WebMCP contracts, Node test runner, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-02-research-trust-repairs-design.md`

## Global Constraints

- OpenBar uses browser WebMCP as its single agent interface.
- The HTTP MCP endpoint, standalone MCP server, HTTP client scripts, HTTP-only authentication and session code, and HTTP transport documentation are removed.
- The home page exposes a small workspace group for listing, searching, and opening projects.
- Project pages expose only the small project context group plus tools for the page's live state.
- Raw TeX inspection remains a repository task.
- Each new regression check is temporary and is removed before final verification.
- The native WebMCP lifecycle is used when a live browser check confirms
  signal-based removal and `getTools()` catalog reporting. A small adapter stays
  only when the browser requires it.
- Citation.js owns BibTeX parsing. OpenBar keeps only client-safe types and
  formatting helpers that serve paper display and citation links.
- Candidate compatibility helpers are deleted only after `rg` confirms that
  no live caller or durable-format reader needs them.
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
      listProjects: async () => [{ slug: "command-v", title: "Command-V", href: "/p/command-v/paper" }],
      searchProjects: async (query) => [{ slug: query, title: query, href: `/p/${query}/paper` }],
      openProject: async (slug) => ({ slug, title: slug, href: `/p/${slug}/paper` }),
    },
    navigate: (href) => { navigated = href; },
  });
  assert.deepEqual(tools.map((tool) => tool.name), ["list_projects", "search_projects", "open_project"]);
  const open = tools.find((tool) => tool.name === "open_project");
  assert.ok(open);
  const result = await open.execute({ slug: "command-v" }) as { ok?: boolean };
  assert.equal(navigated, "/p/command-v/paper");
  assert.equal(result.ok, true);
});

test("HTTP MCP files and dependency are removed", () => {
  for (const relative of ["app/api/mcp/route.ts", "mcp/server.ts", "scripts/mcp-call.ts", "scripts/webmcp-demo.ts", "lib/server/mcp-access.ts"]) {
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
- Delete: `lib/server/mcp-access.ts` after confirming the route is its only caller
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

- [ ] **Step 2: Confirm and delete HTTP-only files**

Run `rg -n "mcpRequestAuthorized|mcp-access|@modelcontextprotocol/sdk" app lib mcp scripts package.json` first. Delete the five files listed above when the caller scan confirms that `lib/server/mcp-access.ts` serves only the removed route. Keep browser contracts, browser registration, and pure research operations.

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
rg -n "HTTP MCP|/api/mcp|mcp-call|mcp:http|mcp:stdio|demo:webmcp|OPENBAR_MCP|OPENBARRY_MCP" README.md docs --glob '!docs/superpowers/**' app features lib mcp scripts package.json pnpm-lock.yaml || true
```

Expected: zero implementation or command references. Historical text in the approved spec may remain.

---

### Task 5: Verify and simplify the native WebMCP lifecycle

**Files:**
- Read: the current Chrome version from the live browser
- Modify: `lib/research/webmcp-register.ts`
- Modify: `components/shell/agent-ready.tsx`
- Modify: `features/use-shared-webmcp.ts`
- Modify: `features/use-workspace-webmcp.ts`
- Modify: `features/paper/use-paper-webmcp.ts`
- Modify: `features/mindmap/use-mindmap-webmcp.ts`
- Modify: `features/wiki/use-wiki-webmcp.ts`
- Modify: `features/instructions/use-instructions-webmcp.ts`

**Interfaces:**
- Consumes: the focused tool groups from Tasks 2 and 3 and the browser's
  actual `document.modelContext` implementation.
- Produces: native signal-scoped registration when supported, native catalog
  reporting for Agent Ready, and the smallest registration adapter required by
  the verified browser.

- [ ] **Step 1: Probe the live browser before changing the helper**

Read the exact Chrome version in the browser running OpenBar. On the local app,
inspect `document.modelContext.registerTool` and `document.modelContext.getTools`.
Register one uniquely named temporary probe tool with an `AbortController`
signal, confirm that `getTools()` reports it, abort the signal, and confirm that
the native catalog removes it after the browser processes the abort. Also check
that the page-specific tool count changes when moving between paper, mindmap,
wiki, and instructions pages. Keep this probe transient and remove it after the
check.

- [ ] **Step 2: Use the native lifecycle when the probe passes**

Update the registration helper and all listed hooks to pass each page's
`AbortSignal` directly to `document.modelContext.registerTool`. Use
`document.modelContext.getTools()` for the Agent Ready count and names. Remove
the active-owner, pending-registration, Chrome-controller, and duplicate-name
routing state when native signal cleanup proves sufficient. Keep the existing
ready event only when the UI still consumes it. Preserve diagnostics and the
page-specific tool groups.

If the current browser lacks one of these native behaviors, retain a small
adapter for that observed gap, remove every state layer the browser already
handles, and record the browser evidence in the implementation notes. This
branch keeps the plan tied to the installed browser rather than to an assumed
API shape.

- [ ] **Step 3: Verify registration behavior**

Run `pnpm typecheck` and a live browser check that the active catalog contains
the expected workspace, project, and page-local names while navigating through
the four page types. Confirm that leaving a page removes its tools and that the
temporary probe is gone.

---

### Task 6: Make Citation.js the single BibTeX parser

**Files:**
- Create: `test/.tmp-citation-bibtex.test.ts`
- Modify: `lib/citation.ts`
- Modify: `lib/bibtex.ts`
- Modify: `lib/tex-project/project.ts`
- Read: `features/paper/tex-document.tsx`
- Read: `features/paper/paper-editor.tsx`
- Read: `features/paper/tex-hast-document.tsx`

**Interfaces:**
- Consumes: the existing Citation.js adapter, client-safe `BibEntry` types,
  bibliography writing, paper rendering, and citation link formatting.
- Produces: Citation.js parsing for every BibTeX read, complete field mapping
  for current paper behavior, and no broad custom parser fallback.

- [ ] **Step 1: Add a temporary fixture corpus before parser deletion**

Create a scratch test with entries covering a regular article, an
in-proceedings entry, nested braces in a title and venue, accented names,
comma-form and family-first authors, year and date values, DOI, URL, and a
comment or preamble entry that should not become a reference. Assert the parsed
keys and every field used by `referenceFields` and `bibliographyTex`. Run:

```text
pnpm exec tsx --test test/.tmp-citation-bibtex.test.ts
```

Use the result as the compatibility baseline. If the current adapter misses a
field, make the fixture fail for that field before completing the adapter work.

- [ ] **Step 2: Remove the redundant parser path**

Make `lib/citation.ts` the server-only parser and have it return the shared
`BibEntry` type from `lib/bibtex.ts` through a type-only import. Extend its CSL
field mapping for the fields currently used by the paper UI and TeX
bibliography writer, including journal, booktitle, publisher, school,
institution, howpublished, note, author or editor, year or date, DOI, and URL.

Remove `readDelimited`, `cleanValue`, `parseBibtexLegacy`, and the public
`parseBibtex` parser from the client-safe `lib/bibtex.ts`. Keep that module's
types, citation compilation, safe reference formatting, and HTML helpers so
client components do not import Citation.js.

Update `readBibliography` and `bibliographyTex` in
`lib/tex-project/project.ts` to use `parseBibtexCitationJs(raw) ?? []`. Remove
the `parseBibtexCitationJs(raw) || parseBibtex(raw)` fallback while preserving
the current empty-bibliography behavior and rendered HTML sanitization.

- [ ] **Step 3: Run the fixture check and inspect the client boundary**

Run the temporary fixture test again, then run `pnpm typecheck`. Confirm with
`rg` that Citation.js is imported only from the server-side adapter and that no
legacy parser symbol remains in live code. Keep the scratch test until Task 8.

---

### Task 7: Remove zero-caller compatibility and dead code

**Files:**
- Modify or delete candidates in `app/actions.ts`
- Modify or delete candidates in `lib/mindmap/mindmap.ts`
- Modify or delete candidates in `lib/marker-codec.ts`
- Modify or delete candidates in `lib/mindmap-derive.ts`
- Modify or delete candidates in `lib/mindmap/layout.ts`
- Inspect candidates in `lib/html-policy.ts`
- Inspect candidates in `lib/store.ts`
- Inspect candidates in `lib/tex-project/document-body.ts`
- Inspect candidates in `lib/tex-project/obmd.ts`
- Inspect candidates in `lib/tex-project/tex-hast.ts`
- Inspect candidates in `lib/tex-project/tex-ast.ts`

**Interfaces:**
- Consumes: the current working tree, the paper-first persistence paths, and
  all durable readers and writers.
- Produces: a smaller codebase with canonical helpers only and unchanged live
  behavior.

- [ ] **Step 1: Scan every candidate and its callers**

Run `rg` for declarations, imports, property access, dynamic references, and
tests before deleting anything. Check these named candidates first:

```text
patchPaperSectionAction
patchPaperSectionsAction
renameMindmapAction
readAgentsMdAction
readWorkspaceAgentsMdAction
toMindmapRecord
fromMindmapRecord
preprocessMarkers
reconcileProjectTodos
connectedParentPath
```

Then inspect exported helpers in the HTML policy, store, document-body, obmd,
TeX HAST, and TeX AST modules. Treat an import from a durable file reader or
writer as a live caller. Treat an unreferenced compatibility conversion as a
deletion candidate.

- [ ] **Step 2: Delete confirmed zero-caller code in small groups**

Remove each candidate only after its caller scan is empty. When a live caller
uses a compatibility wrapper, move that caller to the canonical helper first,
then remove the wrapper. Keep the mindmap record format, TeX ownership, marker
handling, and browser tool contracts unchanged. Do not remove a helper that
still reads an existing project file or supports a current UI action.

- [ ] **Step 3: Verify after each cleanup group**

Run `pnpm typecheck`, `pnpm check:domain`, and the relevant real browser smoke
for paper, mindmap, wiki, and instructions behavior. Review `git diff --check`
after the complete cleanup. No permanent regression test is required for a
candidate whose only proof is an empty caller scan.

---

### Task 8: Finish temporary verification and browser smoke

**Files:**
- Delete: `test/.tmp-webmcp-only.test.ts`
- Delete: `test/.tmp-citation-bibtex.test.ts`
- Inspect: `test/*.test.ts`, `scripts/check-research-invariants.ts`, `scripts/webmcp-evals.ts`

**Interfaces:**
- Consumes: final workspace and page-local browser registrations.
- Produces: a clean repository with durable checks and browser smoke evidence.

- [ ] **Step 1: Run the temporary checks once more**

Run: `pnpm exec tsx --test test/.tmp-webmcp-only.test.ts`

Run: `pnpm exec tsx --test test/.tmp-citation-bibtex.test.ts`

Expected: both temporary checks pass before removal.

- [ ] **Step 2: Remove the temporary tests**

Delete `test/.tmp-webmcp-only.test.ts` and `test/.tmp-citation-bibtex.test.ts` with `apply_patch`.

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
rg -n "@modelcontextprotocol/sdk|/api/mcp|mcp-call|mcp:http|mcp:stdio|demo:webmcp|OPENBAR_MCP|OPENBARRY_MCP|parseBibtexLegacy|parseBibtex\(" . --glob '!node_modules/**' --glob '!.next/**' --glob '!docs/superpowers/**' || true
git status --short
```

Expected: no HTTP MCP implementation references, no custom BibTeX parser references, both temporary tests are absent, and pre-existing user changes remain preserved.
