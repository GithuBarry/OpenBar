# OpenBar

A research-paper workspace for people and agents. Edit the LaTeX manuscript,
organize its TODOs in mindmaps, and keep the paper, references, and figures in
one project repository.

| Plan in mindmaps | Edit the paper |
| --- | --- |
| ![Mindmap with inline card editing and paper TODOs](docs/images/mindmap.png) | ![LaTeX editor beside the paper reader](docs/images/paper-editor.png) |

## What you can do

- Edit LaTeX with file folding, a reader, PDF preview, and citation completion.
- Keep TODOs, comments, questions, and unfinished results beside the relevant prose.
- Organize paper TODOs in a Primary mindmap and optional secondary maps.
- Read and edit `.bib` files, paste references, insert citations, and connect to Overleaf.
- Give agents project file access through MCP or WebMCP, with protected app state and an inbox for `@agent` mentions.

## Run locally

Use the Node version in [.nvmrc](.nvmrc) and the pnpm version in
[package.json](package.json).

```bash
pnpm install
pnpm dev
```

Open [localhost:3000](http://localhost:3000). Projects live under
`content/projects/<slug>`. Set `OPENBARRY_CONTENT` to use another content directory.

TeX Live with `latexmk` enables PDF compilation.
[TexLab](https://github.com/latex-lsp/texlab) adds LaTeX completion. See the
deployment guide for optional conversion tools.

## Connect an agent

Open `/agents` in the running app for connection instructions. Start with
`get_project_state` to read the current paper, maps, instructions, and available
skills. Say “check updates” to inspect the agent inbox.

The manuscript owns TODO text and completion. Each mindmap owns its layout,
labels, and presentation. Browser preferences stay on the current device.

## Documentation

- [Architecture and product model](docs/architecture.md)
- [MCP and WebMCP operations](docs/webmcp.md)
- [Hosting and deployment](deploy/README.md)
- [Release checks](docs/release-acceptance.md)
- [Agent instructions](AGENTS.md)

## Development

```bash
pnpm typecheck
pnpm build
```

[MIT license](LICENSE).
