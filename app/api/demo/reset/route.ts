import path from "node:path";

import { revalidatePath } from "next/cache";

import { resetDemoFixture } from "@/lib/research/demo-fixture";
import { isPublicDemoMode, publicDemoSlugs } from "@/lib/server/demo-mode";
import { requestIsSameOrigin } from "@/lib/server/request-origin";

function noStoreJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  if (!isPublicDemoMode()) return noStoreJson({ error: "Not found" }, 404);
  if (!requestIsSameOrigin(request)) return noStoreJson({ error: "Forbidden" }, 403);

  const slugs = publicDemoSlugs();
  try {
    resetDemoFixture(process.env.OPENBARRY_CONTENT || path.join(process.cwd(), "content"));
    revalidatePath("/", "layout");
    for (const slug of slugs) revalidatePath(`/p/${slug}`, "layout");
    return noStoreJson({ ok: true, slugs });
  } catch (error) {
    console.error("Could not reset public demo", error);
    return noStoreJson({ error: "Could not reset the demo right now." }, 500);
  }
}
