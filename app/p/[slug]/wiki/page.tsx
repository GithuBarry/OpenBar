import { notFound } from "next/navigation";
import { NotebookTabs } from "lucide-react";

import { PageHeader } from "@/components/shell/page-header";
import { WikiIndex } from "@/features/wiki/wiki-index";
import { getProject, listWiki } from "@/lib/store";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { requireProjectPage } from "@/lib/server/project-access";

export default async function WikiPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireProjectPage(slug);
  const project = getProject(slug);
  if (!project) notFound();

  return (
    <>
      <PageHeader
        title={project.title}
        subtitle="Supporting notes"
        project={project}
        readOnlyProject={isPublicDemoMode()}
        icon={<NotebookTabs size={18} />}
      />
      <div className="mx-auto max-w-6xl p-6">
        <WikiIndex slug={slug} pages={listWiki(slug)} />
      </div>
    </>
  );
}
