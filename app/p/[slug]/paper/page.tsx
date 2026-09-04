import { notFound } from "next/navigation";
import { BookOpenText } from "lucide-react";

import { PageHeader } from "@/components/shell/page-header";
import { PaperEditor } from "@/features/paper/paper-editor";
import { DRAFT_MINDMAP_ID, getBibliography, getBibliographyRaw, getMindmap, getPaperEditorState, getProject, projectContentDir } from "@/lib/store";
import { convertComplexTables } from "@/lib/tex-project/pandoc-tables";
import { texPaths } from "@/lib/tex-project/project";
import { isPublicDemoMode } from "@/lib/server/demo-mode";
import { requireProjectPage } from "@/lib/server/project-access";

/**
 * The Draft is the live TeX manuscript. TODOs and comments live inline as
 * `\obtodo` / `\obcomment`. The mindmap is the operational companion for
 * current work; it never writes derived paper TODOs back into the map file.
 */
export default async function PaperPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireProjectPage(slug);
  const project = getProject(slug);
  if (!project) notFound();

  const paper = getPaperEditorState(slug);
  const map = getMindmap(slug, DRAFT_MINDMAP_ID);
  const placementTargets = (map?.nodes || []).map((node) => ({
    id: node.id,
    label: ((node.title?.trim() || node.text.split("\n")[0].trim() || node.todoId || node.id)).slice(0, 80),
  }));
  const boundTodoIds = (map?.nodes || []).flatMap((node) => (node.todoId ? [node.todoId] : []));
  const bibliography = getBibliography(slug);
  const pandocTables = paper
    ? await convertComplexTables({
      source: paper.bundle.source,
      cwd: texPaths(projectContentDir(slug)).manuscriptDir,
    })
    : {};

  return (
    <>
      <PageHeader
        title={project.title}
        subtitle={project.tagline || `${project.title} manuscript`}
        project={project}
        readOnlyProject={isPublicDemoMode()}
        icon={<BookOpenText size={18} />}
      />
      <main className="h-[calc(100vh-68px)] w-full overflow-hidden p-2 sm:p-3">
        {paper ? (
          <PaperEditor
            key={slug}
            project={slug}
            title={paper.title}
            initialSections={paper.sections}
          initialBundle={paper.bundle}
          bibliography={bibliography}
          bibliographyRaw={getBibliographyRaw(slug)}
          initialPandocTables={pandocTables}
          placementTargets={placementTargets}
          boundTodoIds={boundTodoIds}
          />
        ) : (
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">This project has no TeX manuscript yet.</p>
        )}
      </main>
    </>
  );
}
