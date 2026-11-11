# OpenBar Experience and Durability

## Goal

Make OpenBar a dependable paper-and-mindmap workspace while preserving the
paper repository as the authoritative source for manuscript work. A user must
be able to inspect the exact paper source behind every TODO, edit or arrange
map cards without losing work, recover an interrupted multi-file save, and see
whether a local save has also reached Git. The browser and WebMCP must expose
the same operations and the same evidence.

## Invariants

- TeX owns TODO identity, text, timestamps, completion, comments, markers, and
  intentionally incomplete paper structures.
- The Primary map covers every stable paper TODO either in its tree or in
  Primary Unplaced. Secondary maps may reuse a TODO once per map.
- A map owns placement, labels, references, progress, presentation, and map
  history. It never stores a second authoritative copy of TODO text or status.
- A targeted paper location is identified by source graph file and stable
  section ID, with source range and source hash captured at read time. Section
  titles are display text, never write addresses. Operations that omit a
  section target use the manuscript root insertion point.
- Local persistence and remote Git synchronization are separate outcomes. A
  failed push never rolls back a successful local save and never deletes a
  newly created TODO.
- A write either commits its complete source batch or leaves a journal that can
  recover the previous state on the next project open. Recovery reports the
  paths it touched and any conflict that needs attention.
- All mutation endpoints are idempotent by request ID. Retrying a completed
  request returns its original result rather than creating another TODO or
  moving a card twice.
- Existing legacy project layouts remain readable while canonical writes use
  the root manuscript and `.OpenBar/` data layout.

## Architecture

### 1. Source context index

`source-graph.ts` remains the source-discovery boundary. It will produce a
tolerant paper index for every reachable TeX file, including files whose
OpenBar section envelope or TeX body is malformed. Each section descriptor
contains:

- stable section ID and file path;
- nested heading path and heading source range;
- editable source range and source hash;
- parse status and a precise diagnostic when the envelope or body cannot be
  decoded;
- nearby source excerpt and a human paper link.

The composed paper view may still provide an editable normalized source, but
the project state, TODO locations, navigation, and diagnostics are built from
this index rather than a title-based reconstruction. Writes with an explicit
paper destination resolve the descriptor by section ID and verify the expected
source hash. Root-targeted writes use the manuscript root insertion point.

### 2. Coordinated paper and map operations

Paper operations are implemented as pure source transformations followed by a
single persisted transaction. A conversion operation owns its request ID,
optional destination section ID, expected paper hash, expected map hash, and
resolved map storage identity. An omitted destination uses the manuscript root
insertion point. It performs:

1. request replay lookup;
2. map/card and source-context validation;
3. paper TODO insertion or existing-TODO resolution;
4. map binding with the paper TODO ID;
5. one local persistence boundary for all affected files;
6. a separately reported Git synchronization attempt.

If local persistence fails, neither side is reported as saved. If map
persistence fails after paper transformation, the transaction journal restores
the prior paper bytes. If Git fails, both local results remain durable and the
result is `pending` or `failed` with a retry action. A card already bound to a
TODO returns that TODO and its current location, making retries safe.

Map identity is resolved once from the requested map ID and on-disk role. A
`draft` request can only address the Primary map, and a `planning` request can
only address the matching secondary file. The resolved identity is used for
hashing, locking, normalization, and writing.

### 3. Locking and recovery

All source and map writes use the supported `proper-lockfile` API with stale
and renewal settings that the selected API accepts. There is no custom mkdir
fallback. Async operations use the renewing async lock and ownership-aware
release. Synchronous callers use the supported synchronous option set and are
kept out of long-running mutation paths.

Multi-file source saves write a versioned journal under the project’s OpenBar
directory before replacing files. The journal records request ID, expected
previous hashes, intended next hashes, and relative paths. Project opening
recovers an interrupted batch only when the on-disk state is unambiguous;
mixed or unexpected bytes remain in place and are surfaced as a recovery
conflict with affected paths.

### 4. Map editing model

The reducer gains field-level reversible edits. Each inspector field has a
baseline, dirty state, inverse, and conflict check. Cancel restores only that
field’s baseline; an external revision conflict preserves the local draft and
offers reload or reapply. Human and WebMCP edits share operation definitions,
request IDs, expected revisions, and structured results.

Node deletion defaults to removing one node while preserving its children in
the parent’s sibling position. Branch deletion is a separate explicit action
with a preview of the affected subtree. Reorder previews show the exact
before/after insertion location and remain keyboard accessible.

Progress is a map-owned presentation field with values 0 through 6 and a
`ditched` status. The card shows a start icon, a partial circle, a completed
checkmark, or a muted yellow circle-slash in its upper-right corner. Each card
keeps its explicitly chosen state. TeX owns TODO completion independently.
Legacy numeric values are read through a deterministic migration.

### 5. Paper-first UI

The map screen has a quiet canvas, a readable default scale, stable connector
geometry, and a reserved context rail. The rail presents paper context before
advanced metadata: section path, excerpt, source range, parse diagnostics,
destination preview, and navigation. Normal cards do not repeat paper
locations. The inspector retains drafts across unrelated saves and navigation
flushes pending local mutations before route changes.

Map, Outline, and Unplaced are peer views. Unplaced is a searchable vertical
list with counts, excerpts, destination previews, and bounded batch placement.
The Outline view shows hierarchy, ordering, and the same context affordances.
TODO cards can edit their TeX-owned title/text through the paper operation
service with preview, Cmd/Ctrl+Enter apply, and Escape cancel.

Content format is explicit and safe: plain text, constrained Markdown, and TeX
are rendered by shared components. Images pasted or attached in the inspector
are stored as project assets with stable references and displayed through the
same safe resolver. A compact command/help surface exposes paper editing,
compile, map, and sync actions without hiding the normal UI.

### 6. Git synchronization and Changes

Every mutating action reports `{ local, remote }`. `local` records whether the
requested files were durably saved and includes recovery diagnostics. `remote`
is one of `pushed`, `pending`, `failed`, or `unconfigured`, with commit and
ahead/behind evidence when available. A project-level Changes view reads Git
status and groups changed paper, map, wiki, and asset paths. Push retry accepts
a one-operation credential in memory and never places it in a URL, browser
storage, journal, or log.

### 7. WebMCP contract

The shared project-state response includes AGENTS guidance, source-derived
outline, malformed-section diagnostics, TODO locations, nearby excerpts,
markers, map hierarchy, and compile diagnostics. Mutation tools use the same
request IDs and expected hashes as the UI. Edit tools support preview and
apply; compile results include exact source hash, raw log/artifact references,
structured diagnostics, and stale-result protection. The expectations block
is versioned and states that Paper owns scientific content, map placement is
independent, and remote sync failure does not undo local work.

The WebMCP harness remains a real contract harness over pure operation
definitions. It must not become a second fake persistence path.

### 8. Performance

Project state is indexed once per source hash and map revision. Canvas nodes,
edges, inspector sections, and paper context are memoized by stable IDs.
Typing updates a local draft and coalesces persistence; unrelated nodes do not
rerender. Navigation and search use the same index. A profiling script and
browser acceptance checklist record a real ten-minute typing session with
render counts, save latency, heap growth, and stale-result incidents.

## Verification strategy

Validation uses one temporary file at a time outside the repository and removes
it after the check. No new durable test file is kept in the repository:

- tolerant source discovery and stable section-ID writes, including duplicate
  titles and malformed envelopes;
- role/id/hash resolution for Primary and secondary maps;
- lock renewal, ownership-aware release, and contention;
- journal recovery and mixed-state diagnostics;
- idempotent conversion, existing-TODO retry, local-save preservation after
  remote failure, and no rollback of saved paper work;
- field-level cancel/conflict handling and child-preserving deletion;
- seven progress states, safe content formats, source-derived locations,
  Unplaced/Outline contracts, and WebMCP parity;
- production typecheck, build, and manual localhost acceptance against both
  published projects.

The existing dirty tree is user-owned. Implementation will integrate its
partial root-layout and durability changes, preserve unrelated artifacts, and
remove only explicitly identified stale generated material during the final
cleanup. The final integration target is the repository’s `main` branch, with
the current branch merged and pushed only after fresh verification.
# Card notes and visible-content guidance

Each mindmap card may carry map-owned supporting notes that open through a small,
initially closed disclosure. Background notes open in their own initially closed disclosure. Critical
and important notes appear as visible paragraphs with red and amber accents.
TODO cards retain their TeX-owned title and body, with all three note surfaces
owned by each map. Text length follows the existing request-size protection.
