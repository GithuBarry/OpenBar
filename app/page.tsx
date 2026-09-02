import Link from "next/link";

import { getEditableTexPaper, listProjects } from "@/lib/store";
import { analyzePaper, paperTodoIsOpen } from "@/lib/research/paper-analysis";
import { requireWorkbenchPage } from "@/lib/server/project-access";
import { AboutFeatureGrid } from "@/components/about-features";
import { ProjectCard } from "@/components/project-card";
import { CreateProjectButton } from "@/components/project/create-project";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { WorkspaceIdentity } from "@/components/workspace-identity";
import { WorkspaceMark } from "@/components/workspace-mark";
import { WorkspaceWebMcp } from "@/features/use-workspace-webmcp";
import { getWorkspaceSettings } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireWorkbenchPage();
  const workspace = getWorkspaceSettings();
  const projects = listProjects();
  const rows = projects.map((project) => {
    const paper = getEditableTexPaper(project.slug);
    const todos = paper ? analyzePaper(paper.source).todos.filter(paperTodoIsOpen).length : 0;
    return { project, todos };
  });
  const openTodos = rows.reduce((n, r) => n + r.todos, 0);

  return (
    <main className="min-h-screen bg-canvas">
      <WorkspaceWebMcp />
      <header className="ob-chrome-header sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex min-w-0 items-center gap-4">
            <WorkspaceMark />
            <WorkspaceIdentity workspace={workspace} />
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden gap-4 text-xs text-muted sm:flex">
              <Stat n={projects.length} label="projects" />
              <Stat n={openTodos} label="open todos" />
            </div>
            <ThemeToggle />
            <CreateProjectButton />
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 py-6 md:grid-cols-2">
        {rows.map(({ project, todos }) => (
          <ProjectCard key={project.slug} project={project} todos={todos} />
        ))}
      </section>

      <section id="about" className="border-t border-line bg-surface/40">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">About</p>
          <h2 className="mt-3 max-w-4xl font-serif text-2xl font-semibold tracking-tight sm:text-3xl">
            A shared place for the paper, the plan, and the work around them.
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-muted sm:text-base">
            {workspace.name} turns the research paper into an agent-operable plan. Open work stays in the manuscript, and the mindmap shows how the shared TODOs connect to the research plan.
          </p>
        </div>
        <div className="border-y border-line bg-surface/60">
          <AboutFeatureGrid />
        </div>
        <div className="mx-auto max-w-6xl px-6 py-6">
          <Link href="/about" className="text-xs text-muted hover:text-ink">More about {workspace.name}</Link>
        </div>
      </section>
    </main>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="text-center">
      <div className="font-mono text-base font-semibold leading-none text-ink tabular-nums">{n}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-faint">{label}</div>
    </div>
  );
}
