import { MindmapScreen } from "@/features/mindmap/mindmap-screen";

export default async function MindmapPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <MindmapScreen slug={slug} />;
}
