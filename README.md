# OpenBar

OpenBar is a TeX-first research workspace where people and browser agents share a live
manuscript, task list, knowledge pages, and planning map. This repository contains the
application infrastructure. Private manuscript and project records belong in a separate
content directory supplied at runtime.

## What it provides

- A continuous source editor built from the real TeX include graph
- Automatic TeX preview with `unified-latex` and a Pandoc fallback for complex tables
- Raw-TeX preservation for escaped characters, nested groups, custom macros, and unsupported content
- Compact manuscript tasks with optional owner, priority, target date, status, and source links
- Connected mindmaps backed by parent ids and sibling order
- Editable wiki, notes, slides, claims, evidence, sources, figures, and artifact links
- Page-local WebMCP tools plus an authenticated Streamable HTTP MCP endpoint

## Main routes

- `/` — project cockpit
- `/p/<slug>/paper` — source editor, preview, PDF, and Open items
- `/p/<slug>/mindmap` — connected planning map
- `/p/<slug>/wiki` — editable research knowledge pages
- `/api/mcp` — Streamable HTTP MCP endpoint
- `/api/health` — runtime capability and configuration status

The legacy `/p/<slug>/agenda` route redirects to the paper page. `get_agenda` remains
available to agents.

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
pnpm build
OB_SMOKE_SLUG=<slug> pnpm smoke
git diff --check
```

## Agent workflow

Browser WebMCP tools register on the page that owns the live state. Agents read the current
revision, source ranges, sections, tasks, mindmap, or wiki page, then request hash-checked
writes through the same operations used by the visible controls. Repository files remain the
durable source for those edits.

The HTTP MCP endpoint validates identities, project ids, artifact ids, paths, request origins,
and expected state. Configure authentication with Cloudflare Access variables or
`OPENBARRY_MCP_TOKEN`. Set `OPENBARRY_ALLOWED_PATHS` only for explicit source directories.

## Format model

- TeX manuscripts stay raw and editable.
- Interactive preview uses `unified-latex` and HAST.
- Complex table fragments use a debounced Pandoc preview.
- Explicit conversion uses sandboxing, hashes, and loss reporting.
- Raw TeX islands preserve source that a smaller projection cannot represent safely.
- HTML documents support static and interactive rendering policies.

OpenBar is released under the [MIT License](LICENSE). Hosting and a sanitized demo are later
release steps. Keep private content in a separate mounted content store.
