import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getProject, getWikiPage, getWikiTex } from "@/lib/store";
import { inferDocumentFormat } from "@/lib/document-format";
import { PageHeader } from "@/components/shell/page-header";
import { WikiPageClient } from "@/features/wiki/wiki-page-client";

export default async function WikiDetail({
  params,
}: {
  params: Promise<{ slug: string; page: string }>;
}) {
  const { slug, page } = await params;
  const project = getProject(slug);
  const wiki = getWikiPage(slug, page);
  if (!project || !wiki) notFound();
  const format = inferDocumentFormat(wiki.body, wiki.format);
  const source = format === "tex" ? (getWikiTex(slug, page) ?? wiki.body) : wiki.body;

  return (
    <>
      <PageHeader
        title={wiki.title}
        subtitle={project.title}
        actions={
          <Link href={`/p/${slug}/wiki`} className="btn-ghost text-sm">
            <ArrowLeft size={15} /> Wiki
          </Link>
        }
      />
      <div className="mx-auto max-w-3xl p-6">
        <WikiPageClient page={wiki} tex={source} />
      </div>
    </>
  );
}
