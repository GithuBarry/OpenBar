import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  LockKeyhole,
  Settings2,
} from "lucide-react";

import { AboutFeatureGrid } from "@/components/about-features";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { WorkspaceMark } from "@/components/workspace-mark";
import { getWorkspaceSettings } from "@/lib/workspace";
import { platformWishlistAvailable } from "@/lib/research/platform-wishlist";
import { requireWorkbenchPage } from "@/lib/server/project-access";
import packageJson from "@/package.json";

export const metadata: Metadata = {
  title: "About and setup",
  description: "Set up OpenBar, create your first paper, check PDF compilation, and connect an agent.",
};

const NODE_VERSION = packageJson.engines.node.replace(/^>=/, "")
const PNPM_VERSION = packageJson.packageManager.split("@")[1]

const DAILY_FLOW = [
  ["Create a paper", "In your private workspace, choose New project, enter a title, and choose where the project should live. A fresh paper opens with an Introduction and a starter TODO."],
  ["Write and check saving", "Edit the manuscript, wait for the save indicator, then reload to confirm your edit is saved. Open Instructions to add the project’s AGENTS.md and any useful skills."],
  ["Check the shared TODO", "Open Mindmap and find the starter TODO in the Primary map or Primary Unplaced. Completing it updates the paper and every map that uses it."],
  ["Compile the paper", "Return to Paper and select Recompile, then open PDF. Check that the PDF reflects your text. A compilation error includes the TeX log for diagnosing missing packages or source errors."],
] as const;

export default async function AboutPage() {
  await requireWorkbenchPage();
  const workspace = getWorkspaceSettings();
  const viewOnly = process.env.OPENBAR_VIEW_ONLY === "1";

  return (
    <main id="main-content" tabIndex={-1} className="ob-main-brand min-h-screen bg-canvas text-ink">
      <header className="ob-chrome-header sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <WorkspaceMark name={workspace.name} tagline={workspace.tagline} compactTagline="Serving Draft" />
          <div className="flex items-center gap-3">
            <Link href="/" className="p-button p-button-borderless btn-ghost text-xs">Open workspace <ArrowRight size={13} /></Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-10 sm:py-12">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Research workbench</p>
        <h1 className="mt-4 max-w-4xl font-sans text-4xl font-semibold leading-[1.04] tracking-tight sm:text-6xl">
          Set up your research workspace.
        </h1>
        <p className="mt-6 max-w-3xl text-base leading-7 text-muted sm:text-lg">
          {workspace.name} keeps your paper, shared TODOs, mindmaps, and agent instructions together. Use an existing workspace, or run your own copy with the steps below.
        </p>
        <nav aria-label="Setup guide" className="mt-6 flex flex-wrap gap-3 text-sm">
          {platformWishlistAvailable() && <Link href="/wishlist" className="text-accent underline underline-offset-4">Platform wishlist</Link>}
          <a href="#local-setup" className="text-accent underline underline-offset-4">Install locally</a>
          <a href="#first-paper" className="text-accent underline underline-offset-4">Start your first paper</a>
          <a href="#agent-setup" className="text-accent underline underline-offset-4">Agent instructions</a>
        </nav>
      </section>

      <section id="local-setup" aria-labelledby="local-setup-heading" className="scroll-mt-24 border-y border-line bg-surface/50">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex items-center gap-2 text-accent"><Settings2 size={17} /><p className="text-sm font-semibold">Local setup</p></div>
          <h2 id="local-setup-heading" className="mt-3 font-sans text-3xl font-semibold tracking-tight">Run OpenBar on your computer.</h2>
          <p className="mt-3 text-sm leading-6 text-muted">These commands use a macOS, Linux, or WSL terminal. If someone already hosts your workspace, go straight to <a href="#first-paper" className="text-accent underline">your first paper</a>.</p>
          <ol className="mt-6 grid gap-5 lg:grid-cols-2">
            <li className="min-w-0 rounded-xl border border-line bg-canvas p-5">
              <h3 className="text-sm font-semibold">1. Install the app</h3>
              <p className="mt-2 text-sm leading-6 text-muted">Install Git and <a href="https://nodejs.org/en/download" className="text-accent underline">Node.js {NODE_VERSION}</a>, the version pinned in <code>.nvmrc</code>. Then run:</p>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface-2 p-4 font-mono text-xs leading-6 text-ink"><code>{`git clone https://github.com/GithuBarry/OpenBar.git\ncd OpenBar\nnpm install --global pnpm@${PNPM_VERSION}\npnpm install --frozen-lockfile`}</code></pre>
            </li>
            <li className="min-w-0 rounded-xl border border-line bg-canvas p-5">
              <h3 className="text-sm font-semibold">2. Install the document tools</h3>
              <p className="mt-2 text-sm leading-6 text-muted">PDF compilation uses TeX Live, including <code>latexmk</code>, <code>pdflatex</code>, and your paper’s LaTeX packages. macOS users can install <a href="https://tug.org/mactex/" className="text-accent underline">MacTeX</a>. For Linux and WSL, use <a href="https://tug.org/texlive/" className="text-accent underline">TeX Live</a> or your system package manager.</p>
              <p className="mt-2 text-sm leading-6 text-muted"><a href="https://pandoc.org/installing.html" className="text-accent underline">Pandoc</a> and <code>latexpand</code> support document conversion. <code>synctex</code> supports jumping between the PDF and its source. Install the tools in the environment where OpenBar runs.</p>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface-2 p-4 font-mono text-xs leading-6 text-ink"><code>{"latexmk -v\npdflatex -version\npandoc --version\nlatexpand --help"}</code></pre>
            </li>
            <li className="min-w-0 rounded-xl border border-line bg-canvas p-5">
              <h3 className="text-sm font-semibold">3. Choose where papers are saved</h3>
              <p className="mt-2 text-sm leading-6 text-muted">The default is the <code>content</code> folder in your OpenBar checkout. Projects live in <code>content/projects/&lt;slug&gt;</code>. To use another folder, add this setting to <code>.env.local</code> in the checkout, using your own absolute path:</p>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface-2 p-4 font-mono text-xs leading-6 text-ink"><code>{'OPENBARRY_CONTENT="/absolute/path/to/openbar-content"'}</code></pre>
              <p className="mt-2 text-sm leading-6 text-muted">Give the OpenBar process write access and back up the entire content folder, including hidden <code>.OpenBar</code> directories. The app repository’s ignore rules keep private project content separate from app commits. Restart OpenBar after changing the setting.</p>
            </li>
            <li className="min-w-0 rounded-xl border border-line bg-canvas p-5">
              <h3 className="text-sm font-semibold">4. Start and check the workspace</h3>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface-2 p-4 font-mono text-xs leading-6 text-ink"><code>{"pnpm dev --hostname 127.0.0.1"}</code></pre>
              <p className="mt-2 text-sm leading-6 text-muted">Keep the terminal running and open <a href="http://localhost:3000" className="text-accent underline">localhost:3000</a>. Use the address printed in the terminal if port 3000 is occupied.</p>
              <p className="mt-2 text-sm leading-6 text-muted">Open <code>/api/health</code> on that same local address. Check <code>writableContent: true</code>, <code>tools.git: true</code>, <code>tools.latexmk: true</code>, and <code>tools.pdflatex: true</code>. Each tool’s <code>false</code> value identifies an installation or executable-path issue. A successful paper compile is the final check.</p>
            </li>
          </ol>
        </div>
      </section>

      <section id="first-paper" aria-labelledby="first-paper-heading" className="mx-auto grid max-w-6xl scroll-mt-24 gap-6 px-6 py-10 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">First paper</p>
          <h2 id="first-paper-heading" className="mt-3 font-sans text-3xl font-semibold tracking-tight">Check the whole writing loop.</h2>
          <p className="mt-4 text-sm leading-6 text-muted">
            Keep a paper in OpenBar or connect it to Overleaf during setup. Use your Overleaf dashboard to select an existing project or check the name and create a blank one. For a paper you already started in OpenBar, use Connect Overleaf on its project card. The paper’s save indicator reports local saves and Git sync separately.
          </p>
          <Link href="/" className="p-button p-button-default btn-outline mt-4 text-sm">Open workspace <ArrowRight size={14} /></Link>
          <p className="mt-4 text-sm leading-6 text-muted">An existing OpenBar project can be copied into the content folder’s <code>projects</code> directory. Keep its manuscript, bibliography, figures, and hidden <code>.OpenBar</code> metadata together, then reload the workspace.</p>
        </div>
        <ol className="space-y-4">
          {DAILY_FLOW.map(([title, body], index) => (
            <li key={title} className="grid grid-cols-[2rem_1fr] gap-3 rounded-xl border border-line bg-surface p-4">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent">{index + 1}</span>
              <div>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="agent-setup" aria-labelledby="agent-setup-heading" className="scroll-mt-24 border-y border-line bg-surface/50">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="flex items-center gap-2 text-accent"><LockKeyhole size={17} /><p className="text-sm font-semibold">Agent access</p></div>
          <h2 id="agent-setup-heading" className="mt-3 font-sans text-3xl font-semibold tracking-tight">OpenBar agent instructions</h2>
          {viewOnly ? (
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
              This shared viewer provides read-only access. Follow project links to read the paper, mindmap, and wiki. For editing or agent tools, ask the workspace owner for private workspace access.
            </p>
          ) : (
            <Link href="/agents" className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-accent underline underline-offset-4">Read the agent instructions and connection guide <ArrowRight size={14} /></Link>
          )}
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 py-10 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">How state stays durable</p>
          <h2 className="mt-3 font-sans text-3xl font-semibold tracking-tight">Research work stays in files you can inspect and edit.</h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
            Manuscripts, project metadata, mindmaps, and source records are represented in the project directory. TeX owns TODO identity, text, and completion, while each map owns card placement, labels, refs, progress, and appearance. Device preferences such as theme, sidebar visibility, and the local planning-map viewpoint remain personal browser settings.
          </p>
        </div>
        <aside className="rounded-xl border border-line bg-surface p-6">
          <p className="text-sm font-semibold">Hosting for collaborators</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            Shared hosting needs a protected HTTPS address, persistent content storage, and backups. Cloudflare Access can protect browser sessions. Trusted private-network hosting can use the operator’s local-access configuration. The bundled Cloudflare demo uses disposable content that resets with the container.
          </p>
          <a href="https://github.com/GithuBarry/OpenBar/blob/main/deploy/README.md" className="mt-3 inline-block text-sm text-accent underline">Deployment instructions</a>
          <p className="mt-4 text-sm leading-6 text-muted">
            The repository code uses the MIT License. Review project content before sharing a workspace.
          </p>
        </aside>
      </section>

      <section className="border-t border-line bg-surface/60" aria-label="What OpenBar provides">
        <AboutFeatureGrid />
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-8 text-sm leading-6 text-muted">
        Thank you to <a href="https://xmind.com/" className="text-accent underline underline-offset-4">Xmind</a> and{" "}
        <a href="https://www.marginnote.com/" className="text-accent underline underline-offset-4">MarginNote</a> for inspiring OpenBar’s mindmaps and connected notes.
      </footer>
    </main>
  );
}
