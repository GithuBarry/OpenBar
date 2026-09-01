import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  Bot,
  FileText,
  GitBranch,
  LockKeyhole,
  Network,
  Settings2,
} from "lucide-react";

import { ThemeToggle } from "@/components/shell/theme-toggle";
import { getWorkspaceSettings } from "@/lib/workspace";
import { requireWorkbenchPage } from "@/lib/server/project-access";

export const metadata: Metadata = {
  title: "About",
  description: "How OpenBarry keeps collaborative research work editable, connected, and stored in repository files.",
};

const FEATURES = [
  {
    icon: FileText,
    title: "One living manuscript",
    body: "Edit the real TeX include graph in one continuous workspace. TODOs and comments stay next to the relevant prose.",
  },
  {
    icon: BookOpenText,
    title: "Research state in the repository",
    body: "Paper, annotations, mindmaps, and project skills live in ordinary files. Browser storage is only for personal layout preferences.",
  },
  {
    icon: Network,
    title: "A map of current work",
    body: "The mindmap shows open paper TODOs, recent edits, and ideas without asking you to maintain a separate research dashboard.",
  },
  {
    icon: Bot,
    title: "People and browser agents together",
    body: "A fresh agent calls get_project_state, navigates on its own, and edits through the same live paper the human is looking at.",
  },
];

const DAILY_FLOW = [
  ["Start from a project", "Open the manuscript, planning map, or LLM Wiki that matches the work in front of you."],
  ["Write in repository files", "Draft TeX, add task anchors where work remains, and save directly into the repository structure."],
  ["Connect evidence", "Record sources, results, decisions, and objections next to the claim or section they support."],
  ["Use an agent with context", "Let WebMCP read the visible working state and make constrained edits through the same save path."],
  ["Compile for a handoff", "Use the PDF when checking layout, page budget, and the exact paper artifact shared with collaborators."],
] as const;

export default async function AboutPage() {
  await requireWorkbenchPage();
  const workspace = getWorkspaceSettings();

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="ob-chrome-header sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 font-semibold tracking-tight">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink">
              <GitBranch size={16} />
            </span>
            <span className="truncate">{workspace.name}</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/" className="btn-ghost text-xs">Open workspace <ArrowRight size={13} /></Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-10 pt-14 sm:pt-20">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Research workbench</p>
        <h1 className="mt-4 max-w-4xl font-serif text-4xl font-semibold leading-[1.04] tracking-tight sm:text-6xl">
          A shared place for the paper, the evidence, the plan, and the agent work around them.
        </h1>
        <p className="mt-6 max-w-3xl text-base leading-7 text-muted sm:text-lg">
          {workspace.name} is a TeX-first workspace for research that changes every day. It keeps the actual manuscript files at the center, then connects the tasks, knowledge, planning, and browser-agent tools that help move a project forward.
        </p>
        <div className="mt-8 flex flex-wrap gap-2">
          <span className="chip">Repository-backed research state</span>
          <span className="chip">Editable by people and agents</span>
          <span className="chip">WebMCP-ready</span>
        </div>
      </section>

      <section className="border-y border-line bg-surface/60">
        <div className="mx-auto grid max-w-6xl gap-px overflow-hidden sm:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article key={title} className="border-line bg-canvas/50 p-6 sm:border-r [&:nth-child(2n)]:border-r-0">
              <Icon size={18} className="text-accent" />
              <h2 className="mt-4 text-base font-semibold">{title}</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted">{body}</p>
            </article>
          ))}
        </div>
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
              Open the local workspace at <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">http://127.0.0.1:3000</code>. PDF compilation uses the installed TeX toolchain. Pandoc supports the explicit document-conversion path.
            </p>
          </div>
          <div className="rounded-xl border border-line bg-canvas p-6">
            <div className="flex items-center gap-2 text-accent"><LockKeyhole size={17} /><span className="text-sm font-semibold">Access and agent setup</span></div>
            <p className="mt-3 text-sm leading-6 text-muted">
              Browser WebMCP tools appear on the paper, mindmap, and wiki pages that own their live state. The authenticated HTTP MCP endpoint lives at <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">/api/mcp</code> for programmatic use.
            </p>
            <p className="mt-4 text-sm leading-6 text-muted">
              Production access supports Cloudflare Access through <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">CLOUDFLARE_ACCESS_TEAM_DOMAIN</code> and <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">CLOUDFLARE_ACCESS_AUD</code>, or a dedicated <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">OPENBARRY_MCP_TOKEN</code>. Set <code className="rounded bg-surface-2 px-1 py-0.5 text-[12px]">OPENBARRY_CONTENT</code> when the content folder is mounted elsewhere.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-14 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">How state stays durable</p>
          <h2 className="mt-3 font-serif text-3xl font-semibold tracking-tight">Research work stays in files you can inspect and edit.</h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
            Manuscripts, project metadata, mindmaps, wiki pages, tasks, evidence, and source records are represented in the project directory. Device preferences such as theme, sidebar visibility, and the local planning-map viewpoint remain personal browser settings.
          </p>
        </div>
        <aside className="rounded-xl border border-line bg-surface p-6">
          <p className="text-sm font-semibold">Release posture</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            Cloudflare Pages is the selected future host. This workbench remains unpublished while active research work is prepared for a safe judge-facing example.
          </p>
          <p className="mt-4 text-sm leading-6 text-muted">
            The repository code uses the MIT License. Public release also needs a sanitized demo project, deployment configuration, and a short walkthrough video.
          </p>
        </aside>
      </section>
    </main>
  );
}
