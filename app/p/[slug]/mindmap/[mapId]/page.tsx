import { MindmapScreen } from "@/features/mindmap/mindmap-screen";

export default async function ExtraMindmapPage({
  params,
}: {
  params: Promise<{ slug: string; mapId: string }>;
}) {
  const { slug, mapId } = await params;
  return <MindmapScreen slug={slug} mapId={mapId} />;
}
