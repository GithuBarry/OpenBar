import type { getEditablePaperAction, persistSourceBundleAction } from "@/app/actions"

type EditablePaper = Awaited<ReturnType<typeof getEditablePaperAction>>
type SourceSaveResult = Awaited<ReturnType<typeof persistSourceBundleAction>>

export async function getBrowserEditablePaper(project: string): Promise<EditablePaper> {
  const response = await fetch(`/api/p/${encodeURIComponent(project)}/paper/source`, { cache: "no-store" })
  const result = await response.json().catch(() => null) as { paper?: EditablePaper; error?: string } | null
  if (response.ok && result && "paper" in result) return result.paper ?? null
  throw new Error(result?.error || "Could not read the saved paper.")
}

/** Preserve the save receipt and compare-and-swap failure across deployments. */
export async function saveBrowserPaperSource(
  project: string,
  nextSource: string,
  expectedBundleHash: string,
  options: { signal?: AbortSignal; dryRun?: boolean } = {},
): Promise<SourceSaveResult> {
  if (options.signal?.aborted) throw Object.assign(new Error("Operation cancelled."), { code: "cancelled" })
  // Once submitted, retain the committed revision receipt even if the caller
  // cancels. The save queue acknowledges it before reporting cancellation.
  const response = await fetch(`/api/p/${encodeURIComponent(project)}/paper/source`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nextSource, expectedBundleHash, dryRun: options.dryRun }),
  })
  const result = await response.json().catch(() => null) as SourceSaveResult | { error?: string } | null
  if (result && "ok" in result && typeof result.ok === "boolean") return result
  throw new Error(result && "error" in result && result.error || "Could not save the paper. Your edits remain in this tab.")
}
