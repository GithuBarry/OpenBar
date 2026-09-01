# OpenBar

OpenBar is a **paper-first research workbench**. The manuscript is where research
becomes real. The mindmap shows current work. The repository stores durable
state. Humans and browser agents share the same project through WebMCP.

> OpenBar helps research flow directly into the paper while keeping the
> surrounding work visible, navigable, and agent-accessible from the repository
> itself.

See [docs/architecture.md](docs/architecture.md) for the product model.

## What it provides

- A live TeX editor for the real include graph, with companion preview and PDF compile
- Inline manuscript TODOs and comments (`\obtodo`, `\obcomment`) that survive Git and other editors
- A mindmap that derives current paper work without writing overlays into the map file
- Page-local WebMCP tools plus an authenticated Streamable HTTP MCP endpoint
- Optional project-local skills (`AGENTS.md`, `skills/*/SKILL.md`)

## Fresh-agent sequence

A new agent conversation should not need remembered OpenBar knowledge:

```text
get_project_state → search_project → navigate_project → page tools → compile
```

Universal tools on every project page:

| Tool | Purpose |
| --- | --- |
| `get_project_state` | Outline, open TODOs, mindmaps, recent activity, skills, current location |
| `search_project` | Lexical search over paper, TODOs, comments, mindmap, wiki |
| `navigate_project` | Move the UI to an id or href from the tools above |
| `read_project_skill` | Read a project-local or bundled skill |

Paper-page tools then cover reading, replacing sections, TODOs, comments, compile, and lint. Agent edits use the same live editor, undo history, and revision-checked save path as human edits.

## Main routes

- `/` — project list
- `/p/<slug>/paper` — manuscript editor, preview, PDF, and TODOs
- `/p/<slug>/mindmap` — operational map plus derived paper work
- `/p/<slug>/wiki` — optional notes
- `/api/mcp` — Streamable HTTP MCP endpoint
- `/api/health` — runtime capability status

`/p/<slug>` redirects to the paper.

## Local setup

```bash
pnpm install
pnpm dev
```

Set `OPENBARRY_CONTENT` to the mounted content directory before opening a project route.
The standalone MCP development server runs with:

```bash
pnpm mcp
```

## Release checks

```bash
pnpm typecheck
pnpm test
pnpm build
OB_SMOKE_SLUG=<slug> pnpm smoke
git diff --check
```

## Repository state

Research content belongs in the project files:

- manuscript TeX, bibliography, figures, tables
- `\obtodo` / `\obcomment` annotations
- mindmap files
- `AGENTS.md` and `skills/*/SKILL.md`

Browser storage is only for personal interface preferences.

OpenBar is released under the [MIT License](LICENSE).
