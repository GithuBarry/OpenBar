# OpenBar architecture

OpenBar is a paper-first research workbench. Durable research state lives in
the project repository. The browser is an editor and a visual interpretation
of those files. A fresh agent should be able to operate the same project
through WebMCP without remembered OpenBar knowledge.

## Product loop

```text
research thought / result / question
              ↓
          PAPER
 argument + TODOs + comments
 + planned tables/figures/plots
              ↕  shared todoId
     PRIMARY MINDMAP
  every paper TODO + thinking
              ↕  selected todoIds
    SECONDARY MAPS
   optional research views
              ↕
           REPO
      durable project files
              ↕
      OpenBar operations
         ↙         ↘
      Human        Agent
```

One-line definition:

> OpenBar turns the research paper into an agent-operable research plan.
> The Primary mindmap covers every paper TODO. Secondary maps reuse
> selected TODOs as different views of the same work.

## Project inventory boundary

The supported product inventory is the web content-store project inventory at
`OPENBARRY_CONTENT/projects/<slug>`. The web home page and workspace WebMCP
derive project discovery from this source.

The workspace-registry CLI reads a machine-local registration file for
checkout and credential diagnostics. Its inventory is experimental and stays
separate from web results until registration and web integration share one
inventory. `openbar projects list` and `openbar doctor --all` label this source
in human output, help text, and structured metadata.

## Invariants

### Paper first

A project is a TeX manuscript. Paper owns the argument, every `\obtodo`,
comments, and useful incomplete structures. Completing a TODO does not
require new prose.

### Shared TODO identity

One research TODO has exactly one durable TeX source. TeX owns id, text, and
completion. Each mindmap may hold one card for that `todoId`. Maps own
placement, labels, refs, optional progress, and appearance. Completing or
editing the TeX TODO updates every bound card. Moving a card is local to
that map.

### Primary coverage

The Primary mindmap is the complete operational view of paper TODOs:

```text
all paper TODO ids
= primary placed ids
+ primary Unplaced ids
```

Unplaced is part of coverage. A freshly created TODO often has no tree
location yet.

### Secondary maps

A secondary map is an optional research view: free-form nodes plus any
subset of paper TODOs. The same `todoId` across maps is valid. The same
`todoId` twice in one map is invalid. Secondary maps never drive Primary
Unplaced.

Creating a TODO from a secondary map writes `\obtodo` in TeX, binds the
current card, and leaves the new TODO in Primary Unplaced until placed. A
conversion may target a stable paper section or use a neutral insertion in the
manuscript root.
Deleting a secondary TODO card removes that view only. Deleting a Primary
TODO card returns the TeX TODO to Primary Unplaced. Removing the TeX TODO
leaves missing-source cards for repair.

### Repo first

Research content belongs in repository files:

- `.tex` / `.bib`
- figures and tables
- TeX comments and OpenBar annotations
- mindmap files (`role=draft` = Primary; `role=planning` = secondary)
- `AGENTS.md` and project-local `skills/*/SKILL.md`
- workspace `AGENTS.md` and `content/skills/*/SKILL.md`

Browser storage is only for personal interface preferences (panel sizes, last
section, theme, scroll).

### Maintenance-light state

A persisted field must be authored because the researcher cared, derived
automatically from the repository, or required for an operation. Open TODO
counts, outlines, remaining markers, recent edits, compile status, and
search hits are derived. Research vocabulary stays in the paper and optional
project skills. The core product stores no maturity score or priority scale.

### Project-specific meaning

OpenBar supplies mechanics: paper, comments, TODOs, maps, labels, search,
repo, skills. Research methodology lives in optional project skills, not as
a universal ontology. Labels and comment kinds are free-form.

### Progressive use

Paper only is complete. Paper + TODOs + Primary mindmap is complete.
Secondary maps, rich annotations, wiki notes, and agents are optional.

### Fresh-agent usability

A new agent session should work from WebMCP tool descriptions alone:

```text
get_project_state
        ↓
check_inbox
        ↓
understand project and pending human requests
        ↓
search_project
        ↓
navigate_project
        ↓
page-specific read/edit tools
        ↓
compile / inspect
```

Do not ask the user to navigate when `navigate_project` can move the UI.

## Manuscript state

Ordinary TeX is the durable record once something is understood well enough
for the paper.

Inline annotations stay next to the relevant prose:

```tex
\obtodo{Run the dense-query baseline.}
\obtodo[id=eval-dense]{Run the dense-query baseline.}
\obcomment{Need to understand whether this survives dense queries.}
\obcomment[id=transfer-thought,kind=claim]{Performance should remain robust under transfer.}
\obmarker{todo}{result}
```

`kind`, labels, and other unknown attributes are optional project
vocabulary. OpenBar round-trips them without assigning universal research
meaning. Comment ids can be added when a map first links the comment.

`\obmarker` is a paper-local hole (unresolved cell, planned plot, missing
caption detail). It is not an operational TODO and does not create a
mindmap card. Promote work into maps with `\obtodo`.

Do not add a new annotation syntax until `\obtodo` / `\obcomment` /
`\obmarker` / ordinary TeX comments are insufficient.

## Compiler process boundary

Paper compilation runs `latexmk` with `-no-shell-escape` from an immutable
temporary source snapshot. The child receives an explicit environment
allowlist containing the executable `PATH` (including discovered TeX binary
directories), snapshot `TEXINPUTS`, disposable `HOME` and temporary
directories, a stable `C.UTF-8` locale, and TeX's paranoid `openin_any` and
`openout_any` settings. Compiler output retained in compile status is bounded
to a useful tail.

This is an immediate environment-hardening measure. The allowlist limits
application-secret and process-marker exposure while the compiler still runs
with the host process's ordinary filesystem and operating-system privileges.
Filesystem isolation remains a separate deployment control. Durable
multi-tenant hosting requires an independently sandboxed, unprivileged worker
with restricted mounts, disabled or tightly restricted network access, and
CPU, memory, process-count, and wall-clock resource limits for every untrusted
TeX compile.

## Structured incompleteness

A paper may contain useful structure before measurements exist: empty or
partial result tables, planned figures and plots, captions that name the
intended comparison, section headings with TODOs, comments that describe
expected analysis.

That structure preserves the scope of the scientific argument. Agents
should treat it as state, not as unfinished chrome to flatten.

For experiment tables:

- preserve row and column axes
- fill cells only from available results
- leave unresolved cells marked
- add rows or columns when research scope expands
- preserve unrelated cells during edits

Prefer the smallest paper change that satisfies the request. Do not
regenerate a Results section to insert one number.

## Multiple maps

```text
Primary:
  complete TODO coverage (placed or Unplaced)
  free-form research thinking
  labels and optional comment/external refs

Secondary:
  optional research views
  free-form nodes
  optional subset of shared TODO cards

same todoId across maps: valid
same todoId twice inside one map: invalid
```

The Primary route is `/p/<slug>/mindmap`. Secondary routes are
`/p/<slug>/mindmap/<mapId>`. Primary is undeletable. Storage keeps
`id=draft` / `role=draft` for Primary and `role=planning` for secondary
maps; the UI says Primary.

TODO cards store only a `todoId`. Runtime merges that binding with the
parsed TeX TODO. Hierarchy has no automatic task semantics.

Recent means cards whose meaningful content, TODO state, or linked paper
target changed in the selected window (default 7 days), on the map that
owns the card. Pan, zoom, selection, and collapse do not count.

## Skills

Product code owns editing, persistence, search, navigation, compile, and
WebMCP operations.

Project skills own research taste: methodology, writing, experimental rigor,
review style, advisor habits. Discover:

```text
AGENTS.md
skills/<id>/SKILL.md
.openbar/skills/<id>/SKILL.md
content/skills/<id>/SKILL.md   (workspace)
```

Priority: project-local skill → workspace skill → bundled OpenBar fallback.

## Universal WebMCP tools

These tools are available on every project page:

| Tool | Role |
| --- | --- |
| `get_project_state` | Compact orientation: outline TODO counts, Primary Unplaced, map list (id, title, primary, nodeCount), recent activity, AGENTS path/hash. Pass `detail=full` for bodies. |
| `search_project` | Lexical search over paper, TODOs, comments, mindmap labels/refs, wiki |
| `navigate_project` | Move the UI to an id or href from the tools above |
| `read_project_skill` | Read a project, workspace, or bundled skill |
| `update_project` | Icon, title, overview, research kind, color, venue, tagline, label, links, collaborators, archive state |

Page-specific paper and mindmap tools appear after navigation. Tool
descriptions are part of the agent UX: they should teach a memoryless agent
how OpenBar works. `place_todo_card` adds a shared card to the open map; it
does not move a globally unique card.

## Design test

For every feature, ask:

1. Does this help research flow into the paper, help the researcher see
   current work, improve editing, or let a fresh agent operate the project?
2. Can the value come from state the project already contains?
3. Does it preserve useful incompleteness instead of flattening the plan?
