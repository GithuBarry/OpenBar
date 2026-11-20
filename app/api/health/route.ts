import { getRuntimeCapabilities } from "@/lib/research/capabilities";
import { accessHealthStatus } from "@/lib/server/cloudflare-access";
import { isPublicDemoMode, publicDemoSlugs } from "@/lib/server/demo-mode";
import { isViewOnlyMode } from "@/lib/server/view-only";

export const dynamic = "force-dynamic";

export async function GET() {
  if (isViewOnlyMode()) return Response.json({ ok: true, mode: "view-only", writableContent: false })
  const capabilities = getRuntimeCapabilities();
  const access = accessHealthStatus();
  return Response.json({
    ok: true,
    documentModes: capabilities.documentModes,
    tools: {
      git: capabilities.git.available,
      pandoc: capabilities.pandoc.available,
      latexmk: capabilities.latexmk.available,
      pdflatex: capabilities.pdflatex.available,
      synctex: capabilities.synctex.available,
      latexpand: capabilities.latexpand.available,
    },
    writableContent: capabilities.writableContent.available,
    cloudflareAccess: access.cloudflareAccess,
    issuerConfigured: access.issuerConfigured,
    serviceTokensConfigured: access.serviceTokensConfigured,
    mode: isPublicDemoMode() ? "public-demo" : "private-workbench",
    demoSlugs: isPublicDemoMode() ? publicDemoSlugs() : [],
  });
}
