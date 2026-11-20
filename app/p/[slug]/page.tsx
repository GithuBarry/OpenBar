import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireProjectPage } from "@/lib/server/project-access";

export default async function ProjectRoot({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireProjectPage(slug);
  const url = (await headers()).get("x-openbar-project-url") ?? "";
  const query = url.indexOf("?");
  redirect(`/p/${slug}/paper${query === -1 ? "" : url.slice(query)}`);
}
