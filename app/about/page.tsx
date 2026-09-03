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
import { requireWorkbenchPage } from "@/lib/server/project-access";

export const metadata: Metadata = {
  title: "About",
  description: "How OpenBar keeps the manuscript, the mindmap, and browser WebMCP on the same research state.",
};

const DAILY_FLOW = [
  ["Start from the workspace", "A browser agent opens / and uses list_projects, search_projects, or open_project to choose a paper."],
  ["Orient to the project", "After the paper opens, get_project_state returns the manuscript, TODO coverage, maps, skills, and repository instructions."],
  ["Navigate to the work", "search_project finds paper, TODO, comment, map, or wiki locations. navigate_project opens the matching page or focus."],
  ["Use the active page", "Paper, mindmap, wiki, and instructions tools act on live editor state, selected cards, page navigation, focus, and visible actions."],
  ["Compile for a handoff", "Use the PDF when checking layout, page budget, and the exact paper artifact shared with collaborators."],
] as const;

export default async function AboutPage() {
  await requireWorkbenchPage();
  const workspace = getWorkspaceSettings();

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="ob-chrome-header sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <WorkspaceMark name={workspace.name} tagline={workspace.tagline} compactTagline="Serving Draft" />
          <div className="flex items-center gap-3">
            <Link href="/" className="btn-ghost text-xs">Open workspace <ArrowRight size={13} /></Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-10 pt-14 sm:pt-20">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Research workbench</p>
        <h1 className="mt-4 max-w-4xl font-serif text-4xl font-semibold leading-[1.04] tracking-tight sm:text-6xl">
          A shared place for the paper, the plan, and the agent that operates both.
        </h1>
        <p className="mt-6 max-w-3xl text-base leading-7 text-muted sm:text-lg">
          {workspace.name} turns the research paper into an agent-operable research plan. Browser WebMCP keeps the agent in the same visible workspace as the researcher. Open work stays next to the relevant prose, and the mindmap keeps flexible topics, shared TODOs, and paper structure connected.
        </p>
        <div className="mt-8 flex flex-wrap gap-2">
          <span className="chip">Repository-backed research state</span>
          <span className="chip">Editable by people and agents</span>
          <span className="chip">Browser WebMCP interface</span>
        </div>
      </section>

      <section className="border-y border-line bg-surface/60">
        <AboutFeatureGrid />
      </section>

      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-14 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Daily workflow</p>
          <h2 className="mt-3 font-serif text-3xl font-semibold tracking-tight">Work in a loop that stays close to the source.</h2>
          <p className="mt-4 text-sm leading-6 text-muted">
            The product favors a small number of durable actions. Each step produces a file, an edited section, or a compiled artifact that a collaborator can inspect later.
          </p>
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

      <section className="border-y border-line bg-surface/50">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-14 lg:grid-cols-2">
          <div className="rounded-xl border border-line bg-canvas p-6">
            <div className="flex items-center gap-2 text-accent"><Settings2 size={17} /><span className="text-sm font-semibold">Local setup</span></div>
            <p className="mt-3 text-sm leading-6 text-muted">Use the repository as the source of truth, then run the local workspace against that content.</p>
            <pre className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface-2 p-4 font-mono text-xs leading-6 text-ink"><code>{"pnpm install\npnpm dev"}</code></pre>
            <p className="mt-4 text-sm leading-6 text-muted">
              Open the local workspace on port 3000. PDF compilation uses the installed TeX toolchain. Pandoc supports the explicit document-conversion path.
            </p>
          </div>
          <div className="rounded-xl border border-line bg-canvas p-6">
            <div className="flex items-center gap-2 text-accent"><LockKeyhole size={17} /><span className="text-sm font-semibold">Agent Ready</span></div>
            <p className="mt-3 text-sm leading-6 text-muted">
              Agent Ready reports browser WebMCP registration on the active project page. The home page registers workspace tools. Project pages add the four project context tools, including complete project metadata editing. Paper, mindmap, wiki, and instructions pages add tools for the page currently open.
            </p>
            <p className="mt-4 text-sm leading-6 text-muted">
              A compatible browser agent follows the workspace journey through this active catalog. WebMCP handles live editor state, selected cards, navigation, focus, and visible page actions. Page-local tools leave the catalog as the page changes. Set <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">OPENBARRY_CONTENT</code> when the content folder is mounted elsewhere.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-14 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">How state stays durable</p>
          <h2 className="mt-3 font-serif text-3xl font-semibold tracking-tight">Research work stays in files you can inspect and edit.</h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
            Manuscripts, project metadata, mindmaps, wiki pages, and source records are represented in the project directory. TeX owns TODO identity, text, and completion, while each map owns card placement, labels, refs, progress, and appearance. Device preferences such as theme, sidebar visibility, and the local planning-map viewpoint remain personal browser settings.
          </p>
        </div>
        <aside className="rounded-xl border border-line bg-surface p-6">
          <p className="text-sm font-semibold">Release posture</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            OpenBar keeps the paper workflow repository-backed and ready for browser collaboration.
          </p>
          <p className="mt-4 text-sm leading-6 text-muted">
            The repository code uses the MIT License. Review project content before sharing a workspace.
          </p>
        </aside>
      </section>
    </main>
  );
}
