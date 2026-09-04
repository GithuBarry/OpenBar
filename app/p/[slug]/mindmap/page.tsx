import { MindmapScreen } from "@/features/mindmap/mindmap-screen";
import { requireProjectPage } from "@/lib/server/project-access";

export default async function MindmapPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requireProjectPage(slug);
  return <MindmapScreen slug={slug} />;
}
