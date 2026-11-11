import Link from "next/link";
import styles from "./mindmap-switcher.module.css";
import { FileText } from "lucide-react";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/shell/page-header";
import { MindmapEditor } from "@/features/mindmap/mindmap-editor";
import { MindmapSwitcher } from "@/features/mindmap/mindmap-switcher";
import { MindmapTitleProvider } from "@/features/mindmap/mindmap-title-context";
import { deriveMindmap } from "@/lib/mindmap-derive";
import { getProjectState } from "@/lib/research/project-state";
import { isPrimaryMindmap } from "@/lib/research/todo-map";
import { DRAFT_MINDMAP_ID, getMindmap, getProjectMetadata, listMindmaps } from "@/lib/store";
import { isPublicDemoMode } from "@/lib/server/demo-mode";

export async function MindmapScreen({ slug, mapId: rawMapId }: { slug: string; mapId?: string }) {
  const project = getProjectMetadata(slug);
  if (!project) notFound();

  const mapId = !rawMapId || rawMapId === "mindmap" ? DRAFT_MINDMAP_ID : rawMapId;
  const primaryFallback = deriveMindmap(slug);
  const maps = listMindmaps(slug);
  const requested = getMindmap(slug, mapId);
  const mindmap = isPrimaryMindmap(mapId)
    ? (requested || primaryFallback)
    : requested;
  if (!mindmap) notFound();

  const activeId = mindmap.id || mapId;
  const isPrimary = isPrimaryMindmap(mindmap);
  const state = getProjectState(slug, {
    kind: "mindmap",
    href: `/p/${slug}/mindmap${isPrimary ? "" : `/${activeId}`}`,
    mapId: activeId,
  });

  return (
    <MindmapTitleProvider key={`${slug}:${activeId}`}><div className={styles.screen}>
      <PageHeader
        compact
        className={`${styles.pageHeader} p-toolbar-group`}
        location="Mindmap"
        title={`${project.title} Mindmap`}
        subtitle={isPrimary ? "Primary research map" : "Planning map"}
        project={project}
        readOnlyProject={isPublicDemoMode()}
        actions={
          <div className={styles.headerActions}>
            <Link href={`/p/${slug}/paper`} className={`p-toolbar-btn ${styles.paperLink}`} aria-label="Open paper"><FileText size={14} /><span>Paper</span></Link>
            <MindmapSwitcher
              project={slug}
              activeId={activeId}
              maps={maps.map((map) => ({
                id: map.id || DRAFT_MINDMAP_ID,
                title: map.title || map.id || "Map",
                role: map.role || (isPrimaryMindmap(map) ? "draft" : "planning"),
                createdAt: map.createdAt,
              }))}
            />
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <MindmapEditor
          key={`${slug}:${activeId}`}
          project={slug}
          initialMindmap={mindmap}
          draftMindmap={isPrimary ? primaryFallback : null}
          paperState={state}
        />
      </div>
    </div></MindmapTitleProvider>
  );
}
