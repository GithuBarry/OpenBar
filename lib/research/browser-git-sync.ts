import type { OverleafGitPushResult, OverleafGitStatus } from "@/lib/tex-project/overleaf-git"

/** Stable browser URLs keep open editors synchronized across application updates. */
export async function getBrowserGitStatus(project: string, refreshRemote = false): Promise<OverleafGitStatus> {
  const response = await fetch(`/api/p/${encodeURIComponent(project)}/git?refresh=${refreshRemote}`, { cache: "no-store" })
  const body = await response.json().catch(() => null) as { status?: OverleafGitStatus; error?: string } | null
  if (response.ok && body?.status) return body.status
  throw new Error(body?.error || "Git status is unavailable. Try again.")
}

export function pushBrowserProject(project: string, message?: string): Promise<OverleafGitPushResult> {
  return synchronize(project, "push", message)
}

export function pullBrowserProject(project: string): Promise<{ ok: boolean; message: string }> {
  return synchronize(project, "pull")
}

async function synchronize(project: string, action: "push" | "pull", message?: string): Promise<OverleafGitPushResult> {
  const response = await fetch(`/api/p/${encodeURIComponent(project)}/git`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...(message ? { message } : {}) }),
  })
  const body = await response.json().catch(() => null) as { result?: OverleafGitPushResult; error?: string } | null
  if (response.ok && body?.result) return body.result
  throw new Error(body?.error || "Git synchronization is unavailable. Try again.")
}
