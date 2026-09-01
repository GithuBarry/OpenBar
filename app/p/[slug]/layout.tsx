import { notFound } from "next/navigation";

import { getProject, listProjects } from "@/lib/store";
import { requireWorkbenchPage } from "@/lib/server/project-access";
import { Sidebar } from "@/components/shell/sidebar";
import { getWorkspaceSettings } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  await requireWorkbenchPage();
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();
  const projects = listProjects();
  const workspace = getWorkspaceSettings();

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar projects={projects} activeSlug={slug} workspaceName={workspace.name} />
      <main className="flex-1 overflow-y-auto bg-canvas">{children}</main>
    </div>
  );
}
