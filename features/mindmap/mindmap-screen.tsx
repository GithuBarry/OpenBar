import Link from "next/link";
import { BookOpenText, Network } from "lucide-react";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shell/page-header";
import { MindmapEditor } from "@/features/mindmap/mindmap-editor";
import { MindmapSwitcher } from "@/features/mindmap/mindmap-switcher";
import { deriveMindmap } from "@/lib/mindmap-derive";
import { getProjectState } from "@/lib/research/project-state";
import { DRAFT_MINDMAP_ID, getMindmap, getProject, listMindmaps, listWiki } from "@/lib/store";
import type { ArtifactRef } from "@/lib/types";

export async function MindmapScreen({ slug, mapId: rawMapId }: { slug: string; mapId?: string }) {
  const project = getProject(slug);
  if (!project) notFound();

  const mapId = !rawMapId || rawMapId === "mindmap" ? DRAFT_MINDMAP_ID : rawMapId;
  const draftOutline = deriveMindmap(slug);
  const maps = listMindmaps(slug);
  const requested = getMindmap(slug, mapId);
  const mindmap = requested
    || (mapId === DRAFT_MINDMAP_ID ? (maps[0] || draftOutline) : null);
  if (!mindmap) notFound();

  const activeId = mindmap.id || mapId;
  const isDraft = mindmap.role === "draft" || activeId === DRAFT_MINDMAP_ID;
  const state = getProjectState(slug, {
    kind: "mindmap",
    href: `/p/${slug}/mindmap${activeId === DRAFT_MINDMAP_ID ? "" : `/${activeId}`}`,
    mapId: activeId,
  });
  const artifactSuggestions: ArtifactRef[] = [
    { kind: "project", id: slug, label: project.title },
    ...(state?.paper?.outline || []).map((section) => ({
      kind: "draft-section" as const,
      id: section.id,
      label: section.title,
    })),
    ...(state?.paper?.todos || []).map((todo) => ({
      kind: "draft-todo" as const,
      id: todo.id,
      label: todo.text,
    })),
    ...listWiki(slug).map((page) => ({
      kind: "wiki-page" as const,
      id: page.slug,
      label: page.title,
    })),
  ];

  return (
    <>
      <PageHeader
        title={`${project.title} Mindmap`}
        subtitle={isDraft ? "Research planning map" : mindmap.title || "Planning canvas"}
        project={project}
        icon={<Network size={18} />}
        actions={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <MindmapSwitcher
              project={slug}
              activeId={activeId}
              maps={maps.map((map) => ({
                id: map.id || DRAFT_MINDMAP_ID,
                title: map.title || map.id || "Map",
                role: map.role || "planning",
                createdAt: map.createdAt,
              }))}
            />
            <Link href={`/p/${slug}/paper`} className="btn-outline text-xs"><BookOpenText size={12} /> Paper</Link>
          </div>
        }
      />
      <main className="h-[calc(100vh-73px)] overflow-hidden bg-canvas p-4">
        <MindmapEditor
          key={`${slug}:${activeId}`}
          project={slug}
          initialMindmap={mindmap}
          draftMindmap={isDraft ? draftOutline : null}
          paperState={state}
          artifactSuggestions={artifactSuggestions}
        />
      </main>
    </>
  );
}
