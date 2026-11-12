import styles from "./mindmap-switcher.module.css";
import { notFound } from "next/navigation";

import { MindmapEditor } from "@/features/mindmap/mindmap-editor";
import { MindmapSwitcher } from "@/features/mindmap/mindmap-switcher";
import { MindmapTitleProvider } from "@/features/mindmap/mindmap-title-context";
import { deriveMindmap } from "@/lib/mindmap-derive";
import { getProjectState } from "@/lib/research/project-state";
import { isPrimaryMindmap } from "@/lib/research/todo-map";
import { DRAFT_MINDMAP_ID, getMindmap, getProjectMetadata, listMindmaps } from "@/lib/store";

export async function MindmapScreen({ slug, mapId: rawMapId }: { slug: string; mapId?: string }) {
  if (!getProjectMetadata(slug)) notFound();

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

  const header = (
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
  );

  return (
    <MindmapTitleProvider key={`${slug}:${activeId}`}><div className={styles.screen}>
      <div className="min-h-0 flex-1 overflow-hidden">
        <MindmapEditor
          key={`${slug}:${activeId}`}
          project={slug}
          header={header}
          initialMindmap={mindmap}
          draftMindmap={isPrimary ? primaryFallback : null}
          paperState={state}
        />
      </div>
    </div></MindmapTitleProvider>
  );
}
