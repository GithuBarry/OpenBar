# Disposable public demo deployment

For direct campus access to actual papers, see [Campus viewing](campus/README.md).

This package runs OpenBar in disposable public-demo mode in one Cloudflare
Container behind a small Worker. Cloudflare Access protects the hostname. The
image contains the real published `Command-V` and `NoveltyBench` projects from
`examples/published-papers`. The container keeps writable paper state at
`/data/openbar` and the same-origin reset endpoint restores both projects from
the image copy.

The demo state survives edits within the current Container instance. A
Container replacement, rebuild, or recovery event can discard `/data/openbar`,
after which startup seeds the configured projects from the image fixture. The
Reset demo action provides recovery to that known fixture baseline.

Durable researcher hosting requires persistent storage for `OPENBARRY_CONTENT`
plus a backup and restore policy. Attach that storage before accepting
long-lived authored work. The current Wrangler configuration intentionally
ships the disposable demo boundary and supplies no durable content binding.

The recommended release path is Cloudflare Workers Builds. Workers Builds runs
the existing Dockerfile-backed Container build in Cloudflare's build
environment. Docker Desktop is optional for local Container checks.

Install the Cloudflare Access policy before sharing the demo URL.

## Requirements

- Node 26.8.1 and pnpm 11.9.0
- A Cloudflare account with Workers Containers enabled
- The OpenBar GitHub repository connected to Workers Builds
- A domain managed by Cloudflare for the private hostname
- Docker Desktop is optional for local Container verification

## Build locally

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm seed:demo
pnpm cf:types
pnpm exec wrangler deploy --dry-run
```

The standalone image expects the same tools that the editor uses:
`latexmk`, `pdflatex`, `latexpand`, `pandoc`, and `git`.

Docker Desktop can verify the local Container image and Worker when those
checks are useful:

```bash
pnpm docker:build
pnpm cf:dev
```

`pnpm docker:build` and `pnpm cf:dev` require Docker Desktop with a running
Linux engine. Workers Builds removes that local requirement for the release
build.

## Recommended deployment: Workers Builds

Create or select the `openbar-private-demo` Worker in Cloudflare Workers &
Pages, connect the OpenBar GitHub repository, and open Settings → Builds.
Use the repository root as the build root and enter these settings:

| Setting | Value |
| --- | --- |
| Worker name | `openbar-private-demo` |
| Repository | The OpenBar GitHub repository |
| Production branch | `cloudflare-demo`, or the selected release branch |
| Root directory | Repository root |
| Build command | `pnpm typecheck && pnpm build` |
| Deploy command | `pnpm exec wrangler deploy --containers-rollout=immediate` |
| Non-production branch builds | Disabled |
| `NODE_VERSION` | `26.8.1` |
| `PNPM_VERSION` | `11.9.0` |

Save the settings, then push the production branch or retry the production
build. Monitor the complete Workers Build log through the image build and
Container rollout. The build uses the existing `wrangler.jsonc` settings:

- Container image: `./deploy/openbar.Dockerfile`
- Image build context: `.`
- Maximum instances: `1`
- Instance type: `standard-1`

Workers Builds keeps the Container image build in Cloudflare's build
environment. A registry image rewrite is outside this release path. GitHub
Actions running the same Wrangler deploy is the fallback when Workers Builds
repository integration is unavailable.

## Local Worker and Container

The local Worker entry point is `cloudflare/worker.ts`. Wrangler uses
`wrangler.jsonc` to build `deploy/openbar.Dockerfile`, attach one
`OpenBarContainer`, and route the fixed `public-demo` instance.

```bash
pnpm cf:types
pnpm cf:dev
```

`wrangler dev` requires Docker Desktop. The local Worker listens on port
`8787`.

## Deploy from Workers Builds

Workers Builds supplies the Cloudflare build environment and runs the deploy
command from the settings above. A local Wrangler login is useful for type
generation, dry-runs, and optional local checks:

```bash
pnpm exec wrangler login
pnpm cf:types
pnpm exec wrangler deploy --dry-run
```

The production deploy command is:

```bash
pnpm exec wrangler deploy --containers-rollout=immediate
```

Keep the returned Worker URL private until Access is active. The Container is
limited to one `standard-1` instance and sleeps after two hours of inactivity.

## Private custom hostname

1. Add a custom domain for the deployed Worker in Cloudflare or add the exact
   hostname as a Worker route.
2. Create a Cloudflare Access application for that exact hostname.
3. Add the approved email or group policy. Add a service-token policy when an
   operational client needs authenticated access.
4. Require the Access policy before sending the hostname to anyone.
5. Open `/api/health` after signing in. Confirm `mode` is `public-demo`,
   `demoSlugs` contains `command-v` and `noveltybench`, and the document tools
   report the expected capabilities.
6. Complete the manual protected-hostname acceptance described below.

Record the deployed commit SHA, the Workers Build ID or URL, the final build
result, the workers.dev URL, and the Container rollout status.

## Release verification

After the cloud build succeeds, complete the following manual acceptance on
the protected workers.dev URL or private custom hostname. Confirm `/api/health`
returns `ok=true`, `mode=public-demo`, both
published projects are listed, `latexmk`, `pdflatex`, `latexpand`, and
Pandoc are available, and `writableContent=true`. Open both papers and both
Primary mindmaps, compile one paper, update a shared TODO and confirm the
change appears on every linked map card, use Reset demo to restore both
projects, and confirm Agent Ready changes when moving between paper and
mindmap pages.

## State and reset

The public-demo server allows paper, map, wiki, comment, TODO, table, compile,
and lint operations for the two published projects. Project creation, project
metadata changes, repository import, uploads, workspace identity, instruction
writes, and skill writes stay disabled in demo mode.

The `Reset demo` button sends a same-origin POST to `/api/demo/reset`. The
server checks the browser origin and fetch site, then atomically restores both
project directories. A fresh Container instance seeds the same two projects
from the image fixture.

## Tunnel alternative

For a private page on a separate origin host, use
`cloudflare-tunnel.yml.example` to point a Cloudflare Tunnel at the origin.
Cloudflare Access should protect the hostname before it is shared.
