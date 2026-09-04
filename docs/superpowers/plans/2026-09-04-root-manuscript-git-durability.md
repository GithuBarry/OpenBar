# Root Manuscript and Git Durability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository root the manuscript, place OpenBar-owned data in `./.OpenBar/`, and report Git commit and push state through localhost UI and browser WebMCP.

**Architecture:** The existing TeX store remains the single content store. A layout resolver selects the root repository for canonical projects and reads the current nested layout during migration. The existing Git operation becomes the write-through sync layer, while browser credential input supplies a per-operation Overleaf token when the host has no credential.

**Tech Stack:** Next.js 16.3.3, React 19, TypeScript, Node.js filesystem and Git processes, TeX source graph, Next server actions, browser WebMCP, pnpm 11.9.0.

**Spec:** `docs/superpowers/specs/2026-09-04-root-manuscript-openbar-layout-design.md`

## Global Constraints

- TeX, style, bibliography, citation, figure, and other paper assets remain at the repository root.
- OpenBar-owned maps and supporting documents live in `./.OpenBar/` with that exact capitalization.
- TeX-owned TODO identity, TODO text, comments, markers, and lifecycle timestamps remain in TeX comments.
- Bibliography and citation source files remain manuscript files at the root.
- Root-only TeX projects can open before OpenBar metadata exists and keep the root manuscript bytes unchanged during metadata creation.
- Existing nested projects remain readable during migration.
- Successful writes expose `pushed`, `pending`, `failed`, or `unconfigured` Git state.
- Browser-entered credentials stay in memory for one operation and stay out of URLs, Git remotes, logs, tool output, and browser storage.
- Local beta access uses the local host. Cloudflare Zero Trust remains a later deployment decision.
- Every production change starts with a failing temporary check under `/private/tmp`.
- No permanent test files are created. Temporary checks are deleted after they pass.
- Preserve the existing WebMCP contracts and server actions. Do not add an HTTP MCP, second project store, fake tool executor, browser TeX compiler, or container deployment.

---

### Task 1: Canonical root and `.OpenBar/` path model

**Files:**
- Modify: `lib/tex-project/project.ts`
- Modify: `lib/store.ts`
- Modify: `lib/tex-project/paper-compose.ts`
- Modify: `lib/tex-project/source-bundle-format.ts`
- Modify: `lib/research/project-skills.ts`
- Modify: `.gitignore`
- Test: `/private/tmp/openbar-root-layout-red.mjs` (temporary)

**Interfaces:**
- Produces `texPaths(projectDir)` with `manuscriptDir=projectDir`, `openBarDir=path.join(projectDir, ".OpenBar")`, root `openbarry.sty`, root `references.bib`, `.OpenBar/references.tex`, root `sections`, root `figures`, `.OpenBar/wiki`, `.OpenBar/mindmaps`, and `.OpenBar/build` for canonical projects.
- Keeps legacy path resolution for a project whose only TeX root is under `manuscript/` until migration finishes.
- Keeps `hasTexProject(projectDir)` true for a root-only repository containing a supported TeX document even when `.OpenBar/project.tex`, `openbarry.sty`, and section envelopes are absent.

- [ ] **Step 1: Write the failing check**

Create `/private/tmp/openbar-root-layout-red.mjs` that makes a temporary directory containing only `main.tex` with `\\documentclass{article}`, imports `hasTexProject`, `texPaths`, and `writeProjectRecord` through `tsx`, then asserts:

```text
hasTexProject(root) === true
texPaths(root).manuscriptDir === root
texPaths(root).openBarDir === path.join(root, ".OpenBar")
texPaths(root).paperFile === path.join(root, "main.tex")
writeProjectRecord(root, { id: "private-project-b", slug: "private-project-b", title: "Private Project B", links: [], createdAt: now, updatedAt: now })
main.tex bytes are unchanged
```

- [ ] **Step 2: Run the check and verify the missing behavior**

Run `pnpm exec tsx /private/tmp/openbar-root-layout-red.mjs`.

Expected result: failure because the current resolver selects `root/manuscript` and the current `TexPaths` has no `openBarDir`.

- [ ] **Step 3: Implement the minimal path change**

Add one layout decision in `lib/tex-project/project.ts`. Root projects use the exact paths in the Interfaces block. Legacy projects keep their current read paths. Move generated bibliography source to root `references.bib`, keep its derived TeX rendering under `.OpenBar/references.tex`, update the generated include to `\\input{.OpenBar/references}`, and update all `.openbarry`, `openbarry/references`, and lower-case `.openbar/skills` references to the canonical `.OpenBar` location. Ignore only `.OpenBar/build/` and generated TeX build files so maps and documents remain tracked.

- [ ] **Step 4: Run the check and existing domain smoke**

Run `pnpm exec tsx /private/tmp/openbar-root-layout-red.mjs`, `pnpm typecheck`, and `pnpm check:domain`.

Expected result: the temporary check passes, typecheck exits 0, and domain checks report `Domain checks passed.`

- [ ] **Step 5: Commit**

```bash
git add lib/tex-project/project.ts lib/store.ts lib/tex-project/paper-compose.ts lib/tex-project/source-bundle-format.ts lib/research/project-skills.ts .gitignore
git commit -m "feat: use root manuscript and OpenBar data paths"
```

### Task 2: Root-only project discovery and migration

**Files:**
- Modify: `lib/store.ts`
- Modify: `lib/tex-project/project.ts`
- Modify: `lib/research/demo-fixture.ts`
- Modify: `lib/tex-project/tex-repo-setup-guide.ts`
- Create: `/private/tmp/openbar-migrate-projects.mjs` (temporary)
- Test: `/private/tmp/openbar-migration-red.mjs` (temporary)

**Interfaces:**
- Root-only `main.tex` projects list through `listProjects()` and use their TeX title as the fallback project title.
- Metadata writes create `.OpenBar/` and preserve the root source file.
- The temporary migration moves paper files from `manuscript/` to the project root, moves OpenBar documents to `.OpenBar/`, moves `references.bib` to the root, rewrites the generated `.OpenBar/references` input, and leaves `.git` at the repository root.

- [ ] **Step 1: Write the failing migration check**

Create `/private/tmp/openbar-migration-red.mjs` with a temporary legacy repository containing `manuscript/main.tex`, `manuscript/openbarry/project.tex`, `manuscript/openbarry/mindmap.tex`, `manuscript/openbarry/references.bib`, `manuscript/openbarry/references.tex`, `manuscript/openbarry.sty`, `manuscript/sections/01-intro.tex`, `manuscript/figures/example.pdf`, and `manuscript/wiki/notes.tex`. Assert that the migration result has root `main.tex`, root `openbarry.sty`, root `references.bib`, root `sections/01-intro.tex`, root `figures/example.pdf`, `.OpenBar/project.tex`, `.OpenBar/mindmap.tex`, `.OpenBar/references.tex`, and `.OpenBar/wiki/notes.tex`, with the old `manuscript/` directory absent.

- [ ] **Step 2: Run the check and verify the missing behavior**

Run `pnpm exec tsx /private/tmp/openbar-migration-red.mjs`.

Expected result: failure because no migration operation exists.

- [ ] **Step 3: Implement the migration and fallback title**

Add one idempotent migration operation in the existing TeX project module or a focused `lib/tex-project/layout-migration.ts`. Refuse destination collisions, preserve `.git`, move only the named manuscript and OpenBar paths, and rewrite the generated bibliography include. Update `listedProjectFallback` to use `readTexDocumentTitle` from the discovered root file when metadata has no title. Update demo fixture reset to resolve project paths through `texPaths` rather than hardcoded `manuscript/openbarry`.

- [ ] **Step 4: Run migration and verify both layouts**

Run `pnpm exec tsx /private/tmp/openbar-migration-red.mjs`, `pnpm typecheck`, and `pnpm exec tsx /private/tmp/openbar-root-layout-red.mjs`.

Expected result: all temporary checks pass and typecheck exits 0.

- [ ] **Step 5: Migrate checked-out projects**

Run the temporary migration over `content/projects/command-v`, `content/projects/dp-reconstruction`, `content/projects/noveltybench`, `content/projects/reasoning-attacks`, and `content/projects/private-project-a`. Leave `content/projects/private-project-b` at its existing root `main.tex` layout. Inspect each resulting tree before staging. Preserve `AGENTS.md` and unrelated repository files.

- [ ] **Step 6: Commit**

```bash
git add lib/tex-project/layout-migration.ts lib/tex-project/project.ts lib/store.ts lib/research/demo-fixture.ts lib/tex-project/tex-repo-setup-guide.ts content/projects
git commit -m "feat: support root-level TeX repositories"
```

### Task 3: Git write-through and browser credential retry

**Files:**
- Modify: `lib/server/git-credential-store.ts`
- Modify: `lib/tex-project/overleaf-git.ts`
- Create: `lib/tex-project/project-sync.ts`
- Modify: `app/actions.ts`
- Modify: `lib/research/project-state.ts`
- Modify: `lib/research/webmcp-shared-contract.ts`
- Test: `/private/tmp/openbar-git-sync-red.mjs` (temporary)

**Interfaces:**
- `ProjectSyncStatus = "pushed" | "pending" | "failed" | "unconfigured"`.
- `ProjectSyncResult = { status: ProjectSyncStatus; message: string; commitHash?: string; needsCredential?: boolean }`.
- `syncProjectGit(projectDir: string, message: string, token?: string): Promise<ProjectSyncResult>` commits and pushes the existing project repository through the existing Git functions.
- `syncProjectAction(slug: string, token?: string): Promise<ProjectSyncResult>` retries the current project's pending Git state and is callable by the local UI and browser WebMCP.
- Project state includes the current Git sync result and ahead/behind counts.

- [ ] **Step 1: Write the failing sync check**

Create `/private/tmp/openbar-git-sync-red.mjs` with a temporary root repository and a bare remote. Assert that `syncProjectGit` returns `unconfigured` before a remote exists, `pushed` after a credential-free local remote push, and `pending` or `failed` when the remote rejects the push. Assert that the result never contains the token value and that the changed root manuscript and `.OpenBar/` files are the only staged paths.

- [ ] **Step 2: Run the check and verify the missing behavior**

Run `pnpm exec tsx /private/tmp/openbar-git-sync-red.mjs`.

Expected result: failure because current writes do not call the existing Git operation and no sync result contract exists.

- [ ] **Step 3: Implement credential-safe Git execution**

Extend the existing Git environment helper to accept an optional per-operation token through a short-lived `600` permission credential helper under the operating-system temporary directory. Delete the helper in `finally`. Keep the configured remote credential-free. Redact errors before returning them.

- [ ] **Step 4: Implement sync state and write-through calls**

Add `project-sync.ts` around `pushOverleafGit`. After each existing project mutation in `app/actions.ts`, call the sync operation with the existing commit message. Preserve the current return values while recording the returned sync result for the page state and WebMCP. `syncProjectAction` handles an explicit retry and optional browser token. Read-only actions remain read-only. Workspace-only writes remain workspace operations.

- [ ] **Step 5: Expose status to UI and WebMCP**

Add sync state to `get_project_state` and the existing project page data. Add one shared WebMCP operation named `sync_project` with `{ token?: string }` input, read-only hint false, and a result containing `status`, `message`, `commitHash`, `ahead`, and `behind`. When `needsCredential` is true, the project UI shows a password input and retries `syncProjectAction` without writing the token to browser storage.

- [ ] **Step 6: Run checks and commit**

Run `pnpm exec tsx /private/tmp/openbar-git-sync-red.mjs`, `pnpm typecheck`, `pnpm check:domain`, and `pnpm evals`.

Expected result: the temporary sync check passes, typecheck exits 0, domain checks report `Domain checks passed.`, and WebMCP evals report `WebMCP evals passed.`

```bash
git add lib/server/git-credential-store.ts lib/tex-project/overleaf-git.ts lib/tex-project/project-sync.ts app/actions.ts lib/research/project-state.ts lib/research/webmcp-shared-contract.ts
git commit -m "feat: report Git push state for project writes"
```

### Task 4: Local beta access and production instance

**Files:**
- Modify: `lib/server/access-policy.ts`
- Modify: `README.md`
- Modify: `deploy/README.md`
- Test: `/private/tmp/openbar-local-access-red.mjs` (temporary)

**Interfaces:**
- `OPENBAR_LOCAL_ACCESS=1` permits same-host local production requests while the request host is loopback.
- The deployed host remains governed by its configured access policy.

- [ ] **Step 1: Write the failing local access check**

Create `/private/tmp/openbar-local-access-red.mjs` that calls `callerMayAccess` with a production loopback request and `OPENBAR_LOCAL_ACCESS=1`, then asserts access. Add a second assertion that a production non-loopback host remains denied without a bearer token or configured Cloudflare identity.

- [ ] **Step 2: Run the check and verify the missing behavior**

Run `pnpm exec tsx /private/tmp/openbar-local-access-red.mjs`.

Expected result: failure because `callerMayAccess` has no local production flag.

- [ ] **Step 3: Implement and document local mode**

Pass the explicit local-mode value into the access policy and permit only loopback hosts. Document the local production launch with `OPENBAR_LOCAL_ACCESS=1`, `OPENBARRY_CONTENT`, the migrated project root, and the existing browser WebMCP flow. Keep Cloudflare dashboard work out of this task.

- [ ] **Step 4: Run the check and commit**

Run `pnpm exec tsx /private/tmp/openbar-local-access-red.mjs`, `pnpm typecheck`, and `pnpm build`.

Expected result: the temporary check passes, typecheck exits 0, and the standalone build completes successfully.

```bash
git add lib/server/access-policy.ts README.md deploy/README.md
git commit -m "docs: run the local Git-backed beta instance"
```

### Task 5: Root repository sync and localhost acceptance

**Files:**
- Modify: the checked-out project repositories under `content/projects/`
- Test: `/private/tmp/openbar-acceptance.mjs` (temporary)

- [ ] **Step 1: Update the real Overleaf repositories**

For Private Project A and Private Project B, use credential-free remotes and the existing host token or browser token prompt. Keep all TeX, style, bibliography, citation, and paper assets at each remote root. Keep OpenBar maps and supporting documents under `./.OpenBar/`. Record the resulting commit SHA for each remote. Do not embed credentials in the remote URL.

- [ ] **Step 2: Build and start the local instance**

Run:

```bash
pnpm install --frozen-lockfile
pnpm clean
pnpm typecheck
pnpm build
OPENBAR_LOCAL_ACCESS=1 OPENBARRY_CONTENT="$PWD/content" HOSTNAME=127.0.0.1 PORT=3000 pnpm start
```

- [ ] **Step 3: Run real smoke calls**

In a second shell, run:

```bash
OB_SMOKE_BASE=http://127.0.0.1:3000 OB_SMOKE_SLUGS=command-v,noveltybench pnpm smoke
OB_SMOKE_BASE=http://127.0.0.1:3000 OB_SMOKE_SLUGS=command-v,noveltybench pnpm smoke:demo-state
```

Run a temporary HTTP check against `/api/health`, both project paper routes, both mindmap routes, and one compile request. Assert `ok=true`, root source resolution, `.OpenBar/` map availability, and a pushed or explicitly unconfigured Git state for each project.

- [ ] **Step 4: Verify browser WebMCP**

Use the local browser tab only. Check the home page, paper page, mindmap page, source editor, Agent Ready catalog, one TODO edit, one mindmap edit, and the sync status. Confirm the page remains usable after navigation between paper and mindmap.

- [ ] **Step 5: Remove temporary checks and commit acceptance notes**

Delete every `/private/tmp/openbar-*-red.mjs` and `/private/tmp/openbar-acceptance.mjs` created by this plan. Record command results in the release notes and commit only durable documentation.

### Task 6: Remove obsolete mock test files after scope confirmation

**Files:**
- Delete: `test/cloudflare-config.test.ts`
- Delete: `test/container-contract.test.ts`
- Delete: `test/demo-fixture.test.ts`
- Delete: `test/demo-reset.test.ts`
- Delete: `test/hackathon-journeys.test.ts`
- Delete: `test/public-demo-policy.test.ts`
- Delete: `test/public-demo-ui-contract.test.ts`
- Delete: `test/smoke-contract.test.ts`

- [ ] **Step 1: Confirm the exact deletion set from the user’s test-scope answer**

The eight files above are the retired mock, public-demo, hackathon, and container checks. The five current TeX and research-operation checks remain until the user explicitly selects all 13 files.

- [ ] **Step 2: Delete only the confirmed obsolete files**

Use `apply_patch` delete operations for the exact confirmed paths. Update the test command or release documentation only when the confirmed deletion set requires it.

- [ ] **Step 3: Run the real release checks and commit**

Run `pnpm typecheck`, `pnpm check:domain`, `pnpm evals`, `pnpm build`, and the localhost smoke commands. Commit the deletion separately with `chore: remove retired mock checks`.
