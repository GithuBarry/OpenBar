import { redirect } from "next/navigation";

/**
 * Kept only so old bookmarks do not break after the Paper graph tab was
 * retired. The editable mindmap is now the project-planning surface.
 */
export default async function PaperGraphRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/p/${slug}/mindmap`);
}
