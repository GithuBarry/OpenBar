import { notFound } from "next/navigation";
import { BookText } from "lucide-react";

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
      <PageHeader title={`${project.title} Wiki`} subtitle={project.tagline || "Project knowledge base"} project={project} readOnlyProject={isPublicDemoMode()} icon={<BookText size={18} />} />
      <main className="mx-auto max-w-4xl p-6">
        <WikiIndex slug={slug} pages={listWiki(slug)} />
      </main>
    </>
  );
}
