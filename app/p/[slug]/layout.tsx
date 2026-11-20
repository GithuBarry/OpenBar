import { notFound } from "next/navigation";

import { getProjectMetadata } from "@/lib/store";
import { workspaceInstructionsAvailable } from "@/lib/research/project-skills";
import { platformWishlistAvailable } from "@/lib/research/platform-wishlist";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { requireProjectPage } from "@/lib/server/project-access";
import { Sidebar } from "@/components/shell/sidebar";
import { ProjectAgentShell } from "@/components/shell/project-agent-shell";
import { getWorkspaceLayout, getWorkspaceSettings } from "@/lib/workspace";
import { getProjectAgentMentions } from "@/lib/research/project-state";
import { isViewOnlyMode } from "@/lib/server/view-only";

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
  const project = getProjectMetadata(slug);
  if (!project) notFound();
  const projects = getWorkspaceLayout().projects;
  const workspace = getWorkspaceSettings();
  const publicDemo = isPublicDemoMode();
  const viewOnly = isViewOnlyMode()

  return (
    <ProjectAgentShell project={slug} publicDemo={publicDemo} viewOnly={viewOnly} wishlistAvailable={platformWishlistAvailable()}>
      {!viewOnly && <meta name="openbar-agent-requests" content={JSON.stringify(getProjectAgentMentions(slug))} />}
      <div className="flex h-dvh overflow-hidden">
        <Sidebar
          projects={projects}
          activeSlug={slug}
          workspaceName={workspace.name}
          workspaceTagline={workspace.tagline}
          publicDemo={publicDemo}
          viewOnly={viewOnly}
        />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 overflow-y-auto bg-canvas">
          {!viewOnly && workspaceInstructionsAvailable() && (
            <link rel="help" title="Project agent instructions" href={`/p/${encodeURIComponent(slug)}/instructions`} />
          )}
          {children}
        </main>
      </div>
    </ProjectAgentShell>
  );
}
