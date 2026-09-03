import { notFound } from "next/navigation";

import { getProject, listVisibleProjects } from "@/lib/store";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { requireProjectPage } from "@/lib/server/project-access";
import { PublicDemoNotice } from "@/components/demo/public-demo-notice";
import { Sidebar } from "@/components/shell/sidebar";
import { ProjectAgentShell } from "@/components/shell/project-agent-shell";
import { getWorkspaceSettings } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireProjectPage(slug);
  const project = getProject(slug);
  if (!project) notFound();
  const projects = listVisibleProjects();
  const workspace = getWorkspaceSettings();
  const publicDemo = isPublicDemoMode();

  return (
    <ProjectAgentShell project={slug} publicDemo={publicDemo}>
      <div className="flex h-screen overflow-hidden">
        <Sidebar
          projects={projects}
          activeSlug={slug}
          workspaceName={workspace.name}
          workspaceTagline={workspace.tagline}
          publicDemo={publicDemo}
        />
        <main className="flex-1 overflow-y-auto bg-canvas">
          {publicDemo && <PublicDemoNotice />}
          {children}
        </main>
      </div>
    </ProjectAgentShell>
  );
}
