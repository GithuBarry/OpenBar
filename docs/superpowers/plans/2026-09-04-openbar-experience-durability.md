# OpenBar experience and durability implementation plan

> **Verification constraint:** The user approved no new durable test files.
> Use one temporary validation file outside the repository for focused
> behavior checks, remove it after verification, and preserve existing test
> files and their failures honestly. Use
> `superpowers:verification-before-completion` before any completion,
> commit, or push claim.

**Goal:** Implement the full `output/openbar-experience-review/review.md`
experience and the five durability repairs while preserving the paper/map
invariants in `AGENTS.md`.

**Architecture:** Extend the source graph into a tolerant, source-derived
paper context index. Route paper and map mutations through shared operation
services with stable IDs, expected hashes, request replay, and a journaled
local transaction. Report local persistence and Git synchronization as
separate structured outcomes. Build the map UI, paper context rail, WebMCP,
and project state from those shared contracts.

**Tech stack:** Next.js 16.3.3, React 19, TypeScript, Node filesystem/Git,
`proper-lockfile`, unified LaTeX parsing, browser WebMCP.

**Source requirements:** `AGENTS.md` and
`output/openbar-experience-review/review.md`.

## Working rules

- Work in the existing checkout and preserve unrelated dirty changes and
  generated evidence until the cleanup inventory is complete.
- Use `apply_patch` for edits. Do not reset, clean, or broadly delete.
- Keep TeX as the source of TODO text/status and paper comments/markers.
- Resolve paper destinations by stable section ID and expected source hash;
  never by section title.
- A failed remote push leaves the local save intact and retryable.
- Use one temporary validation file outside the repository at a time for
  durable observable behavior; remove it after verification and leave no new
  test file in the repository.
- Use one GPU or no GPU only; this task has no model/cluster requirement.

## Task 1: Finish canonical layout and shared paper context indexing

**Files:**

- Modify `lib/tex-project/project.ts`, `lib/tex-project/source-graph.ts`,
  `lib/tex-project/source-bundle.ts`, `lib/tex-project/paper-compose.ts`,
  `lib/research/paper-analysis.ts`, `lib/research/project-state.ts`,
  `lib/research/artifact-link.ts`.
- Use a temporary source-context validation file and remove it after the red/
  green cycle; preserve only existing repository tests.

### Step 1: Add failing tests

Create fixtures with root-layout and legacy-layout projects containing:

1. two sections with the same human heading but different stable IDs;
2. a reachable section with a malformed OpenBar edit envelope;
3. a nested heading path and a TODO/comment/marker;
4. an include with a missing or dynamic target.

Assert, using literal expected values, that the project state exposes every
section, its file, stable ID, heading path, source range/hash, excerpt, parse
diagnostic, TODO location, and graph diagnostic. Assert that writing to the
second repeated-title section changes only its file/range.

Run the temporary validation file; the new expectations must fail against the
current title-based and parse-dropping behavior.

### Step 2: Implement tolerant descriptors

Add a source-context descriptor type and have the graph retain source files
even when section metadata or body parsing fails. Parse metadata, headings,
OpenBar ranges, and nearby excerpts independently. Preserve exact diagnostics
and source hashes. Extend paper analysis with heading levels/paths and source
ranges, plus a fallback that still reports TODO-like macros in malformed
regions.

Build project state from the source context index, merge TODO metadata without
copying TeX-owned fields to maps, and retain links that identify file and
section ID. Use the same context for paper navigation and operation targets.

### Step 3: Verify and refactor

Run the focused tests, then `npm run typecheck` and
`npm run check:domain`. Remove title matching from write paths and preserve
the legacy reader only where it is required for migration.

## Task 2: Make source persistence journaled and lock-safe

**Files:**

- Modify `lib/tex-project/codec.ts`, `lib/tex-project/source-persist.ts`,
  `lib/tex-project/source-bundle.ts`.
- Modify `lib/d3-hierarchy.d.ts` only as needed for the installed
  `proper-lockfile` API.
- Use the temporary validation file for journal and lock behavior; do not add
  durable test files.

### Step 1: Add failing tests

Test real filesystem behavior with temporary projects:

- two async writers contend for the same lock and the second writer waits;
- a lock held by one owner cannot be released by another owner;
- a multi-file batch with a simulated replacement failure leaves a journal;
- project open restores the previous complete batch when all files are either
  previous or intended bytes;
- mixed unexpected bytes remain untouched and return affected paths and a
  conflict diagnostic.

Run each focused file and record the red failures before production edits.

### Step 2: Implement supported locking

Use the supported async `proper-lockfile` API with renewal, stale timeout,
bounded retries, and ownership-aware release. Keep synchronous options within
the dependency’s supported constraints and route long-running mutation paths
through async locking. Delete the custom mkdir lock path and its expiry-only
release behavior. Ensure all callers release only their own lock in `finally`.

### Step 3: Implement recovery journal

Record a version, request ID, project-relative paths, previous hashes/bytes,
and intended hashes/bytes before any multi-file replacement. Use atomic
journal writes. Recover on project open before composing the paper; restore
only unambiguous prior state, otherwise report a structured conflict. Clear
the journal only after every intended replacement is durable. Include affected
paths in source-persistence diagnostics.

### Step 4: Verify

Run focused tests, `npm run typecheck`, `npm run check:domain`, and the full
`npm test` suite. Inspect the journal and lock paths in a temporary fixture to
ensure no credentials or absolute paths are persisted.

## Task 3: Unify map identity, conversion, idempotency, and sync outcomes

**Files:**

- Modify `lib/tex-project/project.ts`, `lib/store.ts`,
  `lib/research/paper-todo-persist.ts`, `app/actions.ts`,
  `lib/research/operations.ts`, `lib/research/operation-service.ts`,
  `lib/research/operation-result.ts`, `lib/research/webmcp-mindmap-contract.ts`,
  `lib/research/webmcp-shared-contract.ts`.
- Add `lib/research/request-replay.ts` and `lib/research/project-sync.ts`.
- Use the temporary validation file for map identity, conversion durability,
  and project-sync behavior; do not add durable test files.

### Step 1: Add failing tests

Cover these observable breaks:

- a secondary ID with `role=draft` rejects without writing Primary;
- duplicate section titles insert into the requested stable section only;
- converting a card creates and binds one TODO locally;
- repeated conversion with the same request ID returns the first result;
- a card already bound to a TODO returns the existing TODO/location;
- map-save failure does not leave a paper TODO behind;
- remote push failure leaves both local files intact and returns retryable
  remote status; it never returns a rolled-back local result.

Run focused tests and confirm red output before implementation.

### Step 2: Centralize identity and local transaction

Resolve map ID, role, path, expected disk hash, and destination identity as
one object. Use it for validation, lock, hash, normalization, and write. Add
request replay storage under `.OpenBar` with bounded records and atomic writes;
replays must verify operation name and input fingerprint before returning a
stored result.

Create one conversion service that validates the source context, inserts or
resolves the TODO, binds the map card, and persists the affected local state
through the journal. Return a structured local result and preserve the card
and TODO on any remote error. Existing bound cards are successful idempotent
reads, not failures.

### Step 3: Add explicit Git sync state

Wrap the existing Git integration with `pushed`, `pending`, `failed`, and
`unconfigured` states, commit hash, ahead/behind data, retry message, and
credential-needed signal. Accept an optional one-operation credential without
writing it to remotes, logs, browser storage, or journals. Call sync after
successful local mutation only. Add a project-level retry action and include
the last result in project state.

### Step 4: Update contracts and verify

Make UI and WebMCP conversion calls use the central action. Add expected paper
source hash, map disk hash, stable section ID, and request ID to mutation
schemas. Add a separate keep-children node removal operation and explicit
branch removal. Run focused tests, full tests, typecheck, domain checks, and
WebMCP evals.

## Task 4: Implement reducer-level editing, progress, rendering, and assets

**Files:**

- Modify `features/mindmap/mindmap-state.ts`,
  `features/mindmap/mindmap-editor.tsx`,
  `features/mindmap/mindmap-screen.tsx`,
  `features/mindmap/mindmap-switcher.tsx`,
  `features/mindmap/paper-activity-rail.tsx`, `lib/types.ts`,
  `lib/schemas.ts`, `lib/mindmap/node-metadata.ts`, `app/globals.css`.
- Add shared safe renderer/asset helpers in `lib/` or `features/mindmap/` as
  appropriate.
- Use the temporary validation file for reducer and renderer behavior; do not
  extend or add durable test files.

### Step 1: Add failing tests

Assert pure reducer behavior for:

- canceling one dirty field leaves other dirty fields untouched;
- conflict preserves the draft and exposes reload/reapply choices;
- deleting a node keeps children in the parent’s original sibling slot;
- explicit branch delete removes exactly the previewed subtree;
- progress accepts empty plus six states and never changes TODO completion;
- plain, Markdown, and TeX content render safely without raw HTML injection.

Add a UI contract test for peer Map/Outline/Unplaced views, searchable
vertical Unplaced entries, context-first inspector order, hidden normal-card
paper labels, and the seven-circle progress control. Run red first.

### Step 2: Implement reducer and model

Add field-level inverse metadata and operation IDs. Make keep-children the
default deletion, preserving sibling ordering; keep branch deletion separate.
Represent progress with a named seven-state value and a deterministic legacy
numeric migration. Keep TODO completion sourced from TeX only.

### Step 3: Implement paper-first editor

Memoize node/edge/context components by stable IDs. Keep collapsed IDs keyed by
project/map rather than content revision. Preserve inspector drafts until
selection or explicit cancel/save. Add destination previews, section path,
excerpt, source range, malformed-source repair affordance, search, batch
placement, and Outline hierarchy. Flush pending local mutations before map
navigation. Use explicit canvas editing mode so browser Tab remains usable.

Add TODO title/text editing through the paper operation service with preview,
Cmd/Ctrl+Enter apply, Escape cancel, and expected hashes. Remove paper
locations from ordinary cards while retaining them in context.

Render plain/Markdown/TeX through safe shared components; support pasted or
attached images through project asset references and the existing safe asset
resolver. Add quiet canvas styling, reserved context rail, keyboard-visible
reorder previews, compact help/commands, and a Changes/advisor entry point.

### Step 4: Verify UI contracts and behavior

Run focused reducer/renderer tests, then typecheck and full tests. Use the
existing demo fixture and inspect both published-paper maps manually through
the local app after the server build is available.

## Task 5: Make project state, WebMCP, compile evidence, and commands complete

**Files:**

- Modify `lib/research/project-state.ts`, `lib/research/capabilities.ts`,
  `lib/research/webmcp-*.ts`, `features/use-shared-webmcp.ts`,
  `features/mindmap/use-mindmap-webmcp.ts`, `features/paper/use-paper-webmcp.ts`,
  `features/use-workspace-webmcp.ts`, `lib/tex-project/compile.ts`,
  `lib/tex-project/tex-diagnostics.ts`, and relevant command/help UI.
- Use the temporary validation file for WebMCP and compile evidence contracts;
  do not add durable test files.

### Step 1: Add failing contract tests

Use the real contract harness to assert that project state contains AGENTS
guidance, source-derived outline and parse failures, markers, TODO locations
and excerpts, map hierarchy, and compile diagnostics. Assert edit preview vs
apply, stable expected-hash conflicts, request replay, and compile results
with source hash, raw log/artifact references, structured diagnostics, and
stale-result rejection.

### Step 2: Implement shared expectations and operations

Version the expectations block with the Paper/map ownership rules. Expose
source context and changes/sync state through shared project state. Make all
paper/map tools call the same action/service used by the UI. Add paper TODO
preview/apply, relocation preserving TODO ID, compile stale protection, and
remote sync retry.

### Step 3: Add performance instrumentation

Add a bounded profiling helper or script that records real interaction timing,
render counters, queue latency, heap snapshots when supported, and stale
responses. Document the ten-minute typing protocol in the acceptance notes;
do not substitute a static source check for the live measurement.

### Step 4: Verify

Run focused contract tests, `npm run evals`, typecheck, domain checks, and a
production build. Confirm the WebMCP catalog exposes no duplicate competing
operation for the same behavior.

## Task 6: Repair existing baseline failures and clean documentation

**Files:**

- Modify the missing demo notice component or its contract test fixture,
  `test/project-state.test.ts`, README/deploy docs, and relevant architecture
  docs.
- Add a concise release/acceptance note under `docs/` describing local/remote
  durability, recovery diagnostics, and the supported root/legacy layouts.

### Steps

1. Investigate the live project-state fixture failure without weakening the
   invariant or fabricating a research project that is not in this checkout.
2. Restore the required public-demo UI contract with the real published-paper
   names and current UI behavior.
3. Remove stale docs that describe deleted architecture or obsolete priority/
   maturity/evidence workflows; retain current invariants and migration notes.
4. Inventory `output/` and other untracked artifacts. Keep review/design
   evidence needed by the repository; remove only exact temporary artifacts
   created by this task, and report every removal.
5. Run `npm test` and inspect the documentation links and status inventory.

## Task 7: Tailscale access, full verification, integration, and push

### Verification checklist

Run each command freshly and capture exit status/output:

```text
npm test
npm run typecheck
npm run check:domain
npm run evals
npm run build
npm run smoke:demo-state
```

Start the production server on loopback and run the existing HTTP smoke flow
against both published projects. Check paper, map, Outline, Unplaced, source
context, one TODO edit, one map edit, compile diagnostics, Changes, and sync
retry. If a live ten-minute browser profile is possible in the current app,
record it; otherwise report that measurement as an explicit remaining
verification gap rather than implying it was performed.

For the requested tailnet access, start the production server on the host's
Tailscale-reachable interface, verify the advertised tailnet IPv4 address from
the host, and curl the app through that address. Document the exact launch
environment, port, project URL shape, and any remaining tailnet firewall
condition. Do not put credentials in the URL.

Use `git diff --check`, inspect `git status`, verify no secrets or dependency
trees are tracked, and re-read the plan checklist against the actual result.

### Integration

Commit the implementation and durable docs with focused messages on the
current branch. Confirm the current branch is clean, inspect the remote and
`main` history, then merge the verified branch into `main` without resetting
or discarding unrelated work. Run the final verification on `main`, push
`main`, and report the exact pushed commit and any remote limitation.

## Execution status (2026-09-04)

The implementation is complete for the durable behaviors in this plan. The
five missing Private Project A edit-envelope end markers were repaired in the nested
project repository without changing manuscript prose. The root app now has
tolerant source context, stable section-ID writes, journaled source
transactions, canonical map identity, retry-safe conversion, distinct local
and remote outcomes, paper-first inspection, seven-state map progress,
compile evidence, shared expectations, and Tailscale dev-origin hydration.

Fresh checks currently recorded:

- `npm run typecheck`, `npm run build`, `npm run check:domain`, and
  `npm run evals` pass.
- The temporary validation file passes source-context, insertion, journal,
  conversion, retry, progress, sibling-preserving deletion, and lock checks;
  it is removed during final cleanup.
- `npm test` retains one pre-existing fixture gap: the navigation test asks for
  `dp-reconstruction`, but this checkout contains the real Private Project A and
  Private Project B projects and no such project. No synthetic project is being
  added to hide that gap.
- The existing frontend smoke script treats optional `/wiki` pages as
  required and therefore reports 404s for both real projects. Paper,
  mindmap, home, health, asset isolation, and the Tailscale bundle request
  were checked separately; the optional wiki behavior remains unchanged.
- A sustained ten-minute typing profile was not run and remains an explicit
  performance-verification gap.
