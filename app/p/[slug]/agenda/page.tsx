import { notFound, redirect } from "next/navigation";

import { getProject } from "@/lib/store";

export default async function AgendaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();
  redirect(`/p/${encodeURIComponent(slug)}/paper`);
}
