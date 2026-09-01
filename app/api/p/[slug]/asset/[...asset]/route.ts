import fs from "node:fs";
import path from "node:path";

import { ProjectAccessError, requireProjectAccess } from "@/lib/server/project-access";
import { projectContentDir } from "@/lib/store";
import { resolveProjectAsset } from "@/lib/tex-project/asset-resolver";
import { texPaths } from "@/lib/tex-project/project";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

const SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; asset: string[] }> },
) {
  const { slug, asset } = await params;
  if (!asset || asset.length === 0) return new Response("Not found", { status: 404 });
  try {
    await requireProjectAccess(slug);
    const manuscriptDir = texPaths(projectContentDir(slug)).manuscriptDir;
    const file = await resolveProjectAsset(projectContentDir(slug), asset.join("/"), manuscriptDir);
    if (!file) return new Response("Not found", { status: 404 });
    const extension = path.extname(file).toLowerCase();
    const type = MIME[extension];
    if (!type) return new Response("Not found", { status: 404 });
    const headers: Record<string, string> = {
      "Cache-Control": "private, max-age=60",
      "Content-Type": type,
      "X-Content-Type-Options": "nosniff",
    };
    if (extension === ".svg") headers["Content-Security-Policy"] = SVG_CSP;
    return new Response(fs.readFileSync(file), { headers });
  } catch (error) {
    if (error instanceof ProjectAccessError) {
      return new Response(error.message, { status: error.status });
    }
    return new Response("Not found", { status: 404 });
  }
}
