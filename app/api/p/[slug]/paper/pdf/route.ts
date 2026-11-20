import { ProjectAccessError, requireProjectAccess } from "@/lib/server/project-access";
import { projectContentDir } from "@/lib/store";
import { currentArtifactId, getCompiledPdf, markDisplayedArtifact } from "@/lib/tex-project/compile";
import { isViewOnlyMode } from "@/lib/server/view-only";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  try {
    await requireProjectAccess(slug);
    const projectDir = projectContentDir(slug);
    const artifactId = new URL(request.url).searchParams.get("artifact") || undefined;
    const resolvedArtifactId = artifactId || currentArtifactId(projectDir);
    const pdf = getCompiledPdf(projectDir, resolvedArtifactId);
    if (!pdf) return new Response("No compiled PDF is available yet.", { status: 404 });
    if (resolvedArtifactId && !isViewOnlyMode()) markDisplayedArtifact(projectDir, resolvedArtifactId);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'inline; filename="paper.pdf"',
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ProjectAccessError) {
      return new Response(error.message, { status: error.status });
    }
    return new Response("Unknown project.", { status: 404 });
  }
}
