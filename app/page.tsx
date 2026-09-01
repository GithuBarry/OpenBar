import { GitBranch } from "lucide-react";
import Link from "next/link";

import { listProjects } from "@/lib/store";
import { buildProjectPaperGraph, paperGraphMaturity } from "@/lib/paper-graph";
import { requireWorkbenchPage } from "@/lib/server/project-access";
import { ProjectCard } from "@/components/project-card";
import { CreateProjectButton } from "@/components/project/create-project";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { WorkspaceIdentity } from "@/components/workspace-identity";
import { getWorkspaceSettings } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireWorkbenchPage();
  const workspace = getWorkspaceSettings();
  const projects = listProjects();
  const rows = projects.map((project) => {
    const graph = buildProjectPaperGraph(project.slug);
    return { project, graph, maturity: paperGraphMaturity(graph) };
  });

  const openTodos = rows.reduce((n, r) => n + r.graph.todos.length, 0);

  return (
    <main className="min-h-screen bg-canvas">
      <header className="ob-chrome-header sticky top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-accent-ink">
              <GitBranch size={18} />
            </span>
            <WorkspaceIdentity workspace={workspace} />
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden gap-4 text-xs text-muted sm:flex">
              <Stat n={projects.length} label="projects" />
              <Stat n={openTodos} label="open todos" />
            </div>
            <Link href="/about" className="btn-ghost text-xs">About</Link>
            <ThemeToggle />
            <CreateProjectButton />
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 py-6 md:grid-cols-2">
        {rows.map(({ project, graph, maturity }) => (
          <ProjectCard
            key={project.slug}
            project={project}
            todos={graph.todos.length}
            maturity={maturity}
          />
        ))}
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
