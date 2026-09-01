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
      argument + durable state
              ↕
          MINDMAP
     current work + recent activity
              ↕
           REPO
      durable project files
              ↕
      OpenBar operations
         ↙         ↘
      Human        Agent
```

One-line definition:

> OpenBar helps research flow directly into the paper while keeping the
> surrounding work visible, navigable, and agent-accessible from the repository
> itself.

## Invariants

### Paper first

A project is a TeX manuscript (`hasTexProject`). `/p/[slug]` opens the paper
editor. Every durable idea should have an easy path to a manuscript location:
prose, `\obtodo`, `\obcomment`, or a mindmap node linked to a section.

### Repo first

Research content belongs in repository files:

- `.tex` / `.bib`
- figures and tables
- TeX comments and OpenBar annotations
- mindmap files
- `AGENTS.md` and project-local `skills/*/SKILL.md`

Browser storage is only for personal interface preferences (panel sizes, last
section, theme, scroll).

### Maintenance-light state

A persisted field must be authored because the researcher cared, derived
automatically from the repository, or required for an operation. Open TODO
counts, outlines, recent edits, compile status, and search hits are derived.

### Project-specific meaning

OpenBar supplies mechanics: paper, comments, TODOs, mindmap, search, repo,
skills. Research methodology lives in optional project skills, not as a
universal ontology.

### Progressive use

Paper only is complete. Paper + TODOs + mindmap is complete. Rich annotations,
multiple maps, wiki notes, and agents are optional.

### Fresh-agent usability

A new agent session should work from WebMCP tool descriptions alone:

```text
get_project_state
        ↓
understand project
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
\obcomment[kind=result]{20n sampling looks substantially better.}
```

`kind` and other unknown attributes are optional project vocabulary. OpenBar
round-trips them without assigning universal research meaning.

Do not add a new annotation syntax until `\obtodo` / `\obcomment` / ordinary
TeX comments are insufficient.

## Mindmap

The mindmap is the live operational view: what needs attention, what changed,
what result just came in, what questions remain, and where each item touches
the manuscript.

Saved nodes are researcher-authored structure (`text`, hierarchy, optional
paper refs). Derived overlays (open TODOs, recent edits, recent comments,
recent completions) are computed from the manuscript and must never write
themselves into the mindmap file. Pinning is the explicit promotion to a
saved node.

## Skills

Product code owns editing, persistence, search, navigation, compile, and
WebMCP operations.

Project skills own research taste: methodology, writing, experimental rigor,
review style, advisor habits. Discover:

```text
AGENTS.md
skills/<id>/SKILL.md
```

Priority: project-local skill → project instruction files → optional OpenBar
bundled fallback.

## Universal WebMCP tools

These tools are available on every project page:

| Tool | Role |
| --- | --- |
| `get_project_state` | Factual orientation: outline, TODOs, maps, recent activity, skills, current location |
| `search_project` | Lexical search over paper, TODOs, comments, mindmap, wiki |
| `navigate_project` | Move the UI to an id or href from the tools above |
| `read_project_skill` | Read a project-local or bundled skill |

Page-specific paper and mindmap tools appear after navigation. Tool
descriptions are part of the agent UX: they should teach a memoryless agent
how OpenBar works.

`get_project_context` remains as a compatibility dump. Prefer
`get_project_state`.

## Design test

For every feature, ask:

1. Does this help research flow into the paper, help the researcher understand
   current work, improve editing, or let a fresh agent operate the project?
2. Can the value come from state the project already contains?
