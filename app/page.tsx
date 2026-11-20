import Link from "next/link";

import { getEditableTexPaper, projectContentDir } from "@/lib/store";
import { analyzePaper, paperTodoIsOpen } from "@/lib/research/paper-analysis";
import { getProjectGitDestination } from "@/lib/tex-project/overleaf-git";
import { requireWorkbenchPage } from "@/lib/server/project-access";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { AboutFeatureGrid } from "@/components/about-features";
import { PublicDemoNotice } from "@/components/demo/public-demo-notice";
import { ResetDemoButton } from "@/components/demo/reset-demo-button";
import { ProjectBoard } from "@/components/project-board";
import { CreateProjectButton } from "@/components/project/create-project";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { WorkspaceIdentity } from "@/components/workspace-identity";
import { WorkspaceMark } from "@/components/workspace-mark";
import { AgentReadyIndicator } from "@/components/shell/agent-ready";
import { WorkspaceWebMcp } from "@/features/use-workspace-webmcp";
import { getWorkspaceSettings, getWorkspaceLayout } from "@/lib/workspace";
import { isViewOnlyMode } from "@/lib/server/view-only";

export const dynamic = "force-dynamic";

export default async function Home() {
  await requireWorkbenchPage();
  const workspace = getWorkspaceSettings();
  const layout = getWorkspaceLayout();
  const projects = layout.projects;
  const publicDemo = isPublicDemoMode();
  const viewOnly = isViewOnlyMode()
  const rows = await Promise.all(projects.map(async (project) => {
    const paper = getEditableTexPaper(project.slug);
    const todos = paper ? analyzePaper(paper.source).todos.filter(paperTodoIsOpen).length : 0;
    const destination = publicDemo || viewOnly ? undefined : await getProjectGitDestination(projectContentDir(project.slug));
    return { project, todos, destination };
  }));

  return (
    <main id="main-content" tabIndex={-1} className="ob-main-brand min-h-screen bg-canvas">
      {!viewOnly && <WorkspaceWebMcp />}
      <div className="flex h-dvh flex-col">
        <header className="ob-chrome-header ob-home-header shrink-0 sticky top-0 z-10">
          <div className="ob-home-header-inner mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
            <div className="ob-home-header-brand flex min-w-0 items-center gap-4">
              <WorkspaceMark />
              {viewOnly ? <span className="text-sm font-semibold">{workspace.name}</span> : <WorkspaceIdentity workspace={workspace} />}
            </div>
            <div className="ob-home-header-actions flex items-center gap-4">
              <ThemeToggle />
              {viewOnly ? <span className="text-xs text-muted" role="status">View only</span> : <><AgentReadyIndicator />{publicDemo ? <ResetDemoButton slug={projects[0]?.slug || "private-project-a"} /> : <CreateProjectButton />}</>}
            </div>
          </div>
        </header>

        {publicDemo && <PublicDemoNotice />}

        <ProjectBoard rows={rows} initialHash={layout.hash} readOnly={publicDemo || viewOnly} />
      </div>

      <section id="about" className="pb-20 pt-20 sm:pb-28 sm:pt-28">
        <div className="mx-auto mb-5 max-w-6xl px-6">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">About</p>
        </div>
        <AboutFeatureGrid />
        <div className="mx-auto max-w-6xl px-6 pt-10">
          <h2 className="mt-3 max-w-4xl font-sans text-2xl font-semibold tracking-tight sm:text-3xl">
            A shared place for the paper, the plan, and the work around them.
          </h2>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-muted sm:text-base">
            {workspace.name} turns the research paper into an agent-operable plan. Open work stays in the manuscript, and the mindmap shows how the shared TODOs connect to the research plan.
          </p>
          <Link href="/about" className="mt-6 inline-block text-xs text-muted hover:text-ink">More about {workspace.name}</Link>
        </div>
      </section>
    </main>
  );
}
