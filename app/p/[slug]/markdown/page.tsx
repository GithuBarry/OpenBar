import Link from "next/link";
import { notFound } from "next/navigation";
import { openMarkdownAction } from "@/app/markdown-actions";
import { MarkdownWorkbench } from "@/features/document/markdown-workbench";
import { MARKDOWN_MANUSCRIPT_PATH } from "@/lib/markdown-manuscript";
import { getMindmap, getProjectMetadata, projectContentDir } from "@/lib/store";
import { readProjectFiles } from "@/lib/research/project-files";
import { requireProjectPage } from "@/lib/server/project-access";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { isViewOnlyMode } from "@/lib/server/view-only";

async function MarkdownPaper({ slug, file }: { slug: string; file: string }) {
  if (!MARKDOWN_MANUSCRIPT_PATH.test(file)) notFound();
  const project = getProjectMetadata(slug);
  if (!project) notFound();
  const snapshot = await openMarkdownAction(slug, file);
  return <MarkdownWorkbench key={`${slug}:${file}`} project={slug} initial={snapshot}
    primary={file === project.markdownFile} rootId={getMindmap(slug)?.rootId} />;
}

export default async function MarkdownPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ file?: string }>;
}) {
  const { slug } = await params;
  await requireProjectPage(slug);
  if (isPublicDemoMode() || isViewOnlyMode()) notFound();
  const file = (await searchParams).file;
  if (file) return <MarkdownPaper slug={slug} file={file} />;
  const root = projectContentDir(slug);
  const listing = [".", "_posts"].flatMap(dir => {
    const r = readProjectFiles(root, { paths: [dir] });
    return r.ok ? r.value.entries.filter(e => e.kind === "file" && MARKDOWN_MANUSCRIPT_PATH.test(e.path)) : [];
  });
  return <section className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-12">
    <h1 className="font-serif text-3xl">Markdown manuscripts</h1>
    <form className="p-glass-sm flex items-center gap-2 rounded-2xl p-3">
      <input className="input p-field min-w-0 grow" name="file" aria-label="Project Markdown path" placeholder="_posts/2027-04-30-my-post.md" required />
      <button className="p-button p-button-glass ob-glass-button">Open file</button>
    </form>
    {listing.map(e => <Link key={e.path} className="text-accent" href={`?file=${encodeURIComponent(e.path)}`}>{e.path}</Link>)}
  </section>;
}
