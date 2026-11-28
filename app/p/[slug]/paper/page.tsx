import { notFound } from "next/navigation";
import { PaperEditor } from "@/features/paper/paper-editor";
import { DRAFT_MINDMAP_ID, getBibliographyData, getMindmap, getPaperEditorState, getProjectMetadata } from "@/lib/store";
import { requireProjectPage } from "@/lib/server/project-access";
import { MarkdownWorkbench } from "@/features/document/markdown-workbench";
import { openMarkdownAction } from "@/app/markdown-actions";

/**
 * The Draft is the live TeX manuscript. TODOs and comments live inline as
 * `\obtodo` / `\obcomment`. The mindmap is the operational companion for
 * current work; it never writes derived paper TODOs back into the map file.
 */
export default async function PaperPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ source?: string }>;
}) {
  const { slug } = await params;
  await requireProjectPage(slug);
  const project = getProjectMetadata(slug);
  if (!project) notFound();

  if (project.markdownFile && (await searchParams).source !== "tex") {
    const initial = await openMarkdownAction(slug, project.markdownFile);
    return <MarkdownWorkbench key={`${slug}:${project.markdownFile}`} project={slug} initial={initial} primary rootId={getMindmap(slug)?.rootId} />;
  }
  const paper = getPaperEditorState(slug);
  const map = getMindmap(slug, DRAFT_MINDMAP_ID);
  const placementTargets = (map?.nodes || []).map((node) => ({
    id: node.id,
    todoId: node.todoId,
    label: ((node.title?.trim() || node.text.split("\n")[0].trim() || node.todoId || node.id)).slice(0, 80),
  }));
  const bibliography = getBibliographyData(slug);

  return (
    <div className="h-full min-h-0 w-full overflow-clip">
      {paper ? (
        <PaperEditor
          key={slug}
          project={slug}
          title={paper.title}
          initialSections={paper.sections}
          initialBundle={paper.bundle}
          sourceContext={paper.sourceContext}
          bibliography={bibliography.entries}
          bibliographyRaw={bibliography.raw}
          placementTargets={placementTargets}
        />
      ) : (
        <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">This project has no TeX manuscript yet.</p>
      )}
    </div>
  );
}
