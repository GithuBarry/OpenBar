import type { ForceSyncDirection } from "@/lib/tex-project/overleaf-git";

export type ForceFinishResult = { ok: boolean; message: string; applied?: boolean; uncertain?: boolean };
export type ForcePullReconciliation = () => Promise<ForceFinishResult>;
export type PendingForcePull = { token: string; persisted: boolean };

function forcePullStorageKey(project: string): string { return `openbar:pending-force-pull:${project}`; }

export function readPendingForcePull(project: string): string | null {
  try {
    const token = sessionStorage.getItem(forcePullStorageKey(project));
    return token && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(token) ? token : null;
  } catch { return null; }
}

export function persistPendingForcePull(project: string, token: string): PendingForcePull {
  const existing = readPendingForcePull(project);
  if (existing && existing !== token) throw new Error("Check the previous force pull before starting another.");
  try { sessionStorage.setItem(forcePullStorageKey(project), token); return { token, persisted: true }; }
  catch { return { token, persisted: false }; }
}

export function clearPendingForcePull(project: string, token: string): void {
  try { if (sessionStorage.getItem(forcePullStorageKey(project)) === token) sessionStorage.removeItem(forcePullStorageKey(project)); }
  catch { /* A retained marker causes a safe reconciliation on the next visit. */ }
}

export async function requireResolvedForcePull(reconcile: ForcePullReconciliation): Promise<void> {
  const result = await reconcile();
  if (!result.ok || result.uncertain) throw new Error(result.message || "Git update status is still uncertain. Check again.");
}

/** Preserve the editor guard when a force pull may have reached the server. */
export async function finishForceRequest(
  direction: ForceSyncDirection,
  request: () => Promise<unknown>,
  onPullUncertain?: () => void,
): Promise<ForceFinishResult> {
  let result: ForceFinishResult;
  try {
    const response = await request();
    if (!response || typeof response !== "object") throw new Error("Force synchronization received an incomplete response.");
    const value = response as Partial<ForceFinishResult>;
    if (typeof value.ok !== "boolean" || typeof value.message !== "string"
      || (value.applied !== undefined && typeof value.applied !== "boolean")
      || (value.uncertain !== undefined && typeof value.uncertain !== "boolean")) {
      throw new Error("Force synchronization received an incomplete response.");
    }
    result = value as ForceFinishResult;
  } catch (error) {
    if (direction === "pull") onPullUncertain?.();
    throw error;
  }
  if (direction === "pull" && result.uncertain) onPullUncertain?.();
  return result;
}
