# Root Manuscript and OpenBar Data Layout

## Goal

Make every connected TeX repository look like the manuscript it contains. TeX, style, bibliography, citation, figure, and other paper assets remain at the repository root. OpenBar-owned maps and supporting documents live in `./.OpenBar/`.

## Repository contract

The canonical repository layout is:

```text
project/
  main.tex
  other paper .tex files
  style files such as .sty and .bst
  bibliography and citation files such as .bib
  figures and paper assets
  .OpenBar/
    project metadata
    selected main TeX filename
    mindmaps/
    wiki and other OpenBar documents
    records
    local build data
```

TeX-owned TODO identity, TODO text, comments, markers, and lifecycle timestamps remain in TeX comments. OpenBar-owned hierarchy, map placement, labels, wiki pages, and application documents live in `.OpenBar/`. The project record may name a nonstandard root entry file. The root entry remains directly accessible to the editor and compiler. Bibliography and citation source files remain manuscript files at the root. OpenBar may keep a derived bibliography rendering in `.OpenBar/`.

New repositories use the canonical root layout. A one-time migration moves existing `manuscript/` paper assets to the project root and moves OpenBar records from the old `openbarry/` location into `.OpenBar/`. The migration uses ordinary filesystem moves followed by one Git commit so the resulting repository has a clear history.

## Project discovery and operations

`texPaths(projectDir)` returns the project root as the source directory for canonical repositories. Its OpenBar paths resolve below `.OpenBar/`. Root-file discovery uses the existing source graph and accepts the project record's selected entry file before the conventional `paper.tex`, `main.tex`, and `ms.tex` names.

The existing paper editor, source bundle, TODO operations, comments, compiler, asset resolver, conversion flow, Git inspection, and Git push use the paths returned by `texPaths`. They keep all manuscript files in the repository source set and keep OpenBar records in `.OpenBar/`.

A root-only TeX repository can be opened before it has OpenBar metadata. The first metadata write creates `.OpenBar/` and leaves the root manuscript bytes unchanged. A project record uses a TeX title as the initial display title when no OpenBar title exists.

## Credential input

Overleaf Git uses a credential-free remote URL. Credential resolution accepts a token supplied with the current browser operation, then the host environment, then the configured operating-system Git helper. A browser-entered token is held in memory for the operation and is excluded from URLs, Git remotes, logs, tool output, and browser storage. The UI asks for the token when the host has no usable credential and retries the same Git operation after submission.

## Remote durability

After a successful existing write operation, OpenBar attempts the project's Git commit and push. The operation exposes `pushed`, `pending`, `failed`, or `unconfigured` so the UI and WebMCP can report the durable result. A local change with a failed push remains visible as `Push required` and can be retried with a browser-supplied token. Git status remains the source for reloadable ahead and behind state. Read-only operations do not create commits.

## Local access

The local host provides direct project access for beta work. After the real Git projects are migrated, a local production server runs against those checked-out repositories and exposes the existing browser WebMCP catalog to the open browser tab. Deployment access policy remains the responsibility of the later Cloudflare Zero Trust setup. Local mode does not require a personal identity or a shared account.

## Compatibility and removal

The reader accepts the existing nested layout during migration. New writes target the canonical root layout. Once all checked-in projects have migrated and the real localhost smoke checks pass, the old-layout reader and old path names are removed. No second project store, fake tool executor, HTTP MCP, browser TeX compiler, or remote persistence layer is introduced.

## Verification

Temporary checks cover:

1. a root-only repository resolves `main.tex` from its root
2. `.OpenBar/` is selected for OpenBar records and mindmaps
3. nested projects migrate without losing root source files
4. Git status and push include root manuscript assets and `.OpenBar/` data while excluding credentials
5. a successful write reports a pushed result and a failed push reports a retryable pending result
6. the browser credential prompt retries an Overleaf operation without storing the token
7. the local production instance serves paper, mindmap, wiki, compile, and WebMCP smoke flows for more than one project

Temporary checks live under `/private/tmp` and are deleted after verification.
