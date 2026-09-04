import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getProject, getWikiPage, listWiki } from "@/lib/store";
import { PageHeader } from "@/components/shell/page-header";
import { WikiPageClient } from "@/features/wiki/wiki-page-client";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { requireProjectPage } from "@/lib/server/project-access";

export default async function WikiDetail({
  params,
}: {
  params: Promise<{ slug: string; page: string }>;
}) {
  const { slug, page } = await params;
  await requireProjectPage(slug);
  const project = getProject(slug);
  const wiki = getWikiPage(slug, page);
  if (!project || !wiki) notFound();
  const pages = listWiki(slug);

  return (
    <>
      <PageHeader
        title={wiki.title}
        subtitle={project.title}
        project={project}
        readOnlyProject={isPublicDemoMode()}
        actions={
          <Link href={`/p/${slug}/wiki`} className="btn-ghost text-sm">
            <ArrowLeft size={15} /> Wiki
          </Link>
        }
      />
      <div className="mx-auto max-w-3xl p-6">
        <WikiPageClient page={wiki} pages={pages} />
      </div>
    </>
  );
}
