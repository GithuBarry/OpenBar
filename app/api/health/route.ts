import { getRuntimeCapabilities } from "@/lib/research/capabilities";
import { accessHealthStatus } from "@/lib/server/cloudflare-access";

export const dynamic = "force-dynamic";

export async function GET() {
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
      latexpand: capabilities.latexpand.available,
    },
    writableContent: capabilities.writableContent.available,
    cloudflareAccess: access.cloudflareAccess,
    issuerConfigured: access.issuerConfigured,
    serviceTokensConfigured: access.serviceTokensConfigured,
  });
}
