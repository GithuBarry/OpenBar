import { notFound } from "next/navigation";
import { FileText } from "lucide-react";

import { PageHeader } from "@/components/shell/page-header";
import { WikiPageClient } from "@/features/wiki/wiki-page-client";
import { getProject, getWikiPage, listWiki } from "@/lib/store";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { requireProjectPage } from "@/lib/server/project-access";

export default async function WikiDetail({
  params,
}: {
  params: Promise<{ slug: string; page: string }>;
}) {
  const { slug, page: pageSlug } = await params;
  await requireProjectPage(slug);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pageSlug)) notFound();
  const project = getProject(slug);
  const page = getWikiPage(slug, pageSlug);
  if (!project || !page) notFound();

  return (
    <>
      <PageHeader
        title={project.title}
        subtitle={`Wiki · ${page.title}`}
        project={project}
        readOnlyProject={isPublicDemoMode()}
        icon={<FileText size={18} />}
      />
      <div className="mx-auto max-w-4xl p-6">
        <WikiPageClient page={page} pages={listWiki(slug)} />
      </div>
    </>
  );
}
