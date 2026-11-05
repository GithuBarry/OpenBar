import type { PaperCompileStatus } from "@/lib/tex-project/compile"

/** Stable URLs let open editors keep observing compiler jobs across releases. */
export function getBrowserPaperCompileStatus(project: string): Promise<PaperCompileStatus> {
  return readCompileResponse(fetch(`/api/p/${encodeURIComponent(project)}/paper/compile`, { cache: "no-store" }))
}

export function requestBrowserPaperCompile(project: string, signal?: AbortSignal): Promise<PaperCompileStatus> {
  return readCompileResponse(fetch(`/api/p/${encodeURIComponent(project)}/paper/compile`, { method: "POST", signal }))
}

async function readCompileResponse(request: Promise<Response>): Promise<PaperCompileStatus> {
  const response = await request
  const result = await response.json().catch(() => null) as { compile?: PaperCompileStatus; error?: string } | null
  if (response.ok && result?.compile && ["idle", "running", "success", "error", "unavailable"].includes(result.compile.state)) return result.compile
  throw new Error(result?.error || "Could not check the PDF. Retry to reconnect to OpenBar.")
}
