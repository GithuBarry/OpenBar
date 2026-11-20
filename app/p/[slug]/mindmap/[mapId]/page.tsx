import { MindmapScreen } from "@/features/mindmap/mindmap-screen";
import { requireProjectPage } from "@/lib/server/project-access";

export default async function ExtraMindmapPage({
  params,
}: {
  params: Promise<{ slug: string; mapId: string }>;
}) {
  const { slug, mapId } = await params;
  await requireProjectPage(slug);
  return <MindmapScreen slug={slug} mapId={mapId} />;
}
