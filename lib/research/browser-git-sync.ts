import type { OverleafGitPushResult, OverleafGitStatus } from "@/lib/tex-project/overleaf-git"

type BrowserSyncResult = OverleafGitPushResult & { uncertain?: boolean }
export type PendingBrowserPull = { operationId: string; persisted: boolean }

function pullStorageKey(project: string): string { return `openbar:pending-pull:${project}` }

export function readPendingBrowserPull(project: string): string | null {
  try {
    const value = sessionStorage.getItem(pullStorageKey(project))
    return value && /^[a-f0-9-]{36}$/i.test(value) ? value : null
  } catch { return null }
}

export function clearPendingBrowserPull(project: string, operationId: string): void {
  try {
    if (sessionStorage.getItem(pullStorageKey(project)) === operationId) sessionStorage.removeItem(pullStorageKey(project))
  } catch { /* A retained marker causes a safe reconciliation on the next visit. */ }
}

/** Stable browser URLs keep open editors synchronized across application updates. */
export async function getBrowserGitStatus(project: string, refreshRemote = false): Promise<OverleafGitStatus> {
  const response = await fetch(`/api/p/${encodeURIComponent(project)}/git?refresh=${refreshRemote}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) })
  const body = await response.json().catch(() => null) as { status?: OverleafGitStatus; error?: string } | null
  if (response.ok && body?.status) return body.status
  throw new Error(body?.error || "Git status is unavailable. Try again.")
}

/** Resolve the exact pull, or cancel an operation that has yet to reach the server. */
export async function requireGitPullBarrier(project: string, operationId: string): Promise<void> {
  const response = await fetch(`/api/p/${encodeURIComponent(project)}/git`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reconcile-pull", operationId }),
    cache: "no-store",
  })
  const body = await response.json().catch(() => null) as {
    result?: { state?: unknown; message?: unknown; result?: BrowserSyncResult }; error?: unknown
  } | null
  if (response.ok && body?.result?.state === "resolved"
    && typeof body.result.result?.ok === "boolean" && typeof body.result.result.message === "string"
    && (body.result.result.uncertain === undefined || body.result.result.uncertain === false)) return
  const message = typeof body?.result?.message === "string" ? body.result.message
    : typeof body?.error === "string" ? body.error : "Git update status could not be confirmed. Check again."
  throw new Error(message)
}

export function pushBrowserProject(project: string, message?: string): Promise<OverleafGitPushResult> {
  return synchronize(project, "push", message)
}

function pullOperationId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function pullBrowserProject(project: string, onUncertain?: (pending: PendingBrowserPull) => void): Promise<{ ok: boolean; message: string } & PendingBrowserPull> {
  const existing = readPendingBrowserPull(project)
  if (existing) {
    onUncertain?.({ operationId: existing, persisted: true })
    throw new Error("Check the previous Git update before starting another pull.")
  }
  const operationId = pullOperationId()
  let persisted = false
  try { sessionStorage.setItem(pullStorageKey(project), operationId); persisted = true } catch { /* The active tab still retains the operation ID. */ }
  const pending = { operationId, persisted }
  if (!persisted) onUncertain?.(pending)
  try {
    const result = await synchronize(project, "pull", undefined, operationId)
    if (result.uncertain) onUncertain?.(pending)
    else if (!result.ok) clearPendingBrowserPull(project, operationId)
    return { ...result, ...pending }
  }
  catch (error) { onUncertain?.(pending); throw error }
}

async function synchronize(project: string, action: "push" | "pull", message?: string, operationId?: string): Promise<BrowserSyncResult> {
  const response = await fetch(`/api/p/${encodeURIComponent(project)}/git`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...(message ? { message } : {}), ...(operationId ? { operationId } : {}) }),
  })
  const body = await response.json().catch(() => null) as { result?: BrowserSyncResult; error?: string } | null
  if (response.ok && body?.result && typeof body.result.ok === "boolean" && typeof body.result.message === "string"
    && (body.result.uncertain === undefined || typeof body.result.uncertain === "boolean")) return body.result
  throw new Error(body?.error || "Git synchronization is unavailable. Try again.")
}
