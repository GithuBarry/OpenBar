# Research trust repairs

## Goal

Make the paper-first OpenBar workflow predictable across the paper, Primary
and secondary mindmaps, browser WebMCP, HTTP MCP, demo content, and release
checks. The existing TODO title, icon editing, reader appearance, metrics,
and TeX focus work remain part of the product.

The paper remains the source of truth for TODO identity, title, details,
timestamps, and completion. Each map owns its card placement, ordinary-card
content, labels, references, progress, and presentation. A deleted paper TODO
leaves its map cards in place as repairable missing-source cards.

## Scope and decisions

### Safe shared TODO behavior

- Removing `\\obtodo` from TeX keeps every referencing node on every map.
- The current map branch remains intact. The explicit branch-delete action
  remains the way to remove a card and its descendants.
- Missing-source cards offer relinking to a TODO available on the current map
  or conversion to an ordinary card.
- Primary candidates use Primary Unplaced TODOs.
- Secondary candidates use all paper TODOs absent from the current map.
- One TODO remains valid once per map and may appear on multiple maps.

### Deterministic project navigation

- Project hrefs must resolve to the currently open project.
- Hrefs accept the supported paper, mindmap, and wiki routes with an optional
  anchor. Malformed encoding and unsupported trailing path parts fail cleanly.
- `mindmap:<mapId>` opens the selected map route.
- `mindmap:<mapId>:node:<nodeId>` opens that map and node.
- Unknown IDs return an explicit navigation error instead of silently opening
  paper home.

### Live map membership

The paper activity rail derives available TODOs from the current in-memory map
before the next server refresh. Primary and secondary views use the same live
absence calculation, with Primary Unplaced retained as the Primary presentation
label.

### Free-form authored metadata

- Comment creation and editing carry an optional free-form `kind`.
- Labels use one shared normalizer that trims, removes empty values, compares
  case-insensitively, preserves the first spelling and order, and enforces
  count and length limits.
- References trim IDs and labels, discard empty values, remove duplicate
  `(kind, id)` pairs, and enforce generous count and label limits.
- The label picker draws from the vocabulary across all maps in the project.

### Paper structure and templates

- Table summaries and table edits share one complexity detector.
- Default result grids, figures, and plots use generic research placeholders.
- Repeated planned-figure insertion receives unique labels or uses a marker
  without a static label.
- Existing table axes, partial values, markers, captions, and labels remain
  intact during edits.

### Demo and transport story

- The checked-in dense-retrieval demo contains a real Transferability secondary
  map with shared TODO cards and ordinary cards.
- Its paper includes an intentionally incomplete result matrix.
- Project instructions describe the demo's chosen organization as local
  vocabulary and explain shared TODO coverage.
- README describes explicit `pnpm seed:demo` setup.
- Browser WebMCP is documented as the primary live experience. HTTP MCP is
  documented as the companion endpoint. The demo script name and comments
  identify its HTTP transport.
- HTTP operations use the current shared semantics where the corresponding
  capability exists. The browser-only capability list remains explicit.

### Release and deployment

- The TeX image is pinned to a verified digest.
- The release checklist includes typecheck, tests, domain checks, WebMCP
  evaluations, build, frontend smoke, and diff checks.
- The eval harness uses production reducers and pure operations for behavior
  that it checks.

## Implementation units

1. Add pure helpers for map TODO candidates, project href parsing and
   navigation, metadata normalization, and shared table complexity.
2. Update paper deletion, relinking, activity rail derivation, and map role
   handling to use those helpers.
3. Wire comment kinds through operations, WebMCP, paper UI, and TeX parsing.
4. Update demo files, seed behavior, README, docs, generic templates, and
   the pinned TeX image.
5. Align HTTP MCP schemas, registration, descriptions, and error results with
   the live browser contract where applicable.
6. Replace duplicated eval behavior with production calls and add focused
   coverage for deletion, relinking, navigation, roles, metadata, tables,
   and stale writes.

## Error handling

User actions report a specific repair or retry message. Navigation reports an
invalid target for malformed, cross-project, missing, or unsupported targets.
Stale source, map revision, and project hash writes keep their current retry
path. A failed paper deletion leaves the map unchanged. A failed map save
leaves the in-memory edit available for retry.

## Temporary verification

Each production fix gets a short-lived regression check created before the
fix, run once to confirm the expected failure, then run again after the fix.
The new scratch test file is removed after the full repair pass. Existing
project checks remain available for final verification. Live browser smoke
checks cover home icon editing, paper and mindmap title display, TODO routing,
Tab child creation, reader appearance, metric details, and TeX focus context.

## Completion criteria

- All scoped behavior is implemented without changing the paper-first data
  ownership rules.
- Temporary repair tests are removed.
- Existing and final release checks pass.
- The dense demo visibly exercises Primary Unplaced, a secondary map, shared
  TODOs, and incomplete paper structure.
- The running app opens the paper view cleanly after verification.
