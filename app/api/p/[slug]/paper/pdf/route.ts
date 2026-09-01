import { ProjectAccessError, requireProjectAccess } from "@/lib/server/project-access";
import { projectContentDir } from "@/lib/store";
import { getCompiledPdf } from "@/lib/tex-project/compile";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  try {
    await requireProjectAccess(slug);
    const pdf = getCompiledPdf(projectContentDir(slug));
    if (!pdf) return new Response("No compiled PDF is available yet.", { status: 404 });
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
