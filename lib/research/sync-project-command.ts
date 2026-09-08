import { getOverleafSyncDetails, prepareOverleafPull, finishOverleafPull, type OverleafConflictChoice } from "@/lib/tex-project/overleaf-git";
import { assertAdministrativeWriteAllowed } from "@/lib/server/demo-mode";
import { failResult, okResult, type OperationResult } from "./operation-result";

export async function syncProjectCommand(projectDir: string, input: unknown): Promise<OperationResult<unknown>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return failResult("invalid_arguments", "Provide a synchronization action.", false);
  const args = input as Record<string, unknown>;
  try {
    if (Object.keys(args).some((key) => !["action", "refresh", "token", "resolutions"].includes(key))) return failResult("invalid_arguments", "Unknown synchronization argument.", false);
    if (args.refresh !== undefined && typeof args.refresh !== "boolean") return failResult("invalid_arguments", "refresh must be a boolean.", false);
    if (args.action === "inspect") return okResult(await getOverleafSyncDetails(projectDir, args.refresh === true));
    assertAdministrativeWriteAllowed("Overleaf synchronization review");
    if (args.action === "review_pull") {
      const result = await prepareOverleafPull(projectDir);
      return result.ok ? okResult({ ...result.review, scope: "Saved repository files", resolutionScope: "Each choice selects an entire file", nextStep: "Resolve every listed conflict. apply_pull requires this token and one resolution per path. Untracked files are preserved. The main checkout remains at localCommit throughout review." }) : failResult("sync_review_failed", result.message, true);
    }
    if (args.action !== "apply_pull" && args.action !== "cancel_pull") return failResult("invalid_arguments", "Choose inspect, review_pull, apply_pull, or cancel_pull.", false);
    if (typeof args.token !== "string") return failResult("invalid_arguments", "A review token is required.", false);
    const resolutions = args.resolutions ?? [];
    if (!Array.isArray(resolutions) || resolutions.length > 1000 || resolutions.some((item) => !item || typeof item !== "object" || typeof item.path !== "string" || !["local", "remote", "merged"].includes(item.choice) || (item.choice === "merged" && typeof item.text !== "string"))) return failResult("invalid_arguments", "Provide valid whole-file resolutions.", false);
    const result = await finishOverleafPull(projectDir, args.token, resolutions as OverleafConflictChoice[], args.action === "cancel_pull");
    return result.ok ? okResult({ ...result, sync: await getOverleafSyncDetails(projectDir) }) : failResult("sync_conflict", result.message, true);
  } catch (error) { return failResult("sync_failed", error instanceof Error ? error.message : "Synchronization failed.", true); }
}
