/**
 * Stable import path for research policy.
 *
 * Claim evaluation lives in `claim-model.ts`. This file re-exports those
 * functions and does not encode a seed→paper-ready identity ladder.
 * `state: "paper-ready"` is a display hint only. There is no `promoteClaim`.
 */

export {
  assessClaim,
  evaluateClaimForPurpose,
  getClaimConcerns,
} from "./claim-model";

export type {
  Claim,
  ClaimAssessment,
  ClaimConsideration,
  ClaimPurposeContext,
  ClaimPurposeEvaluation,
} from "./claim-model";

import type { EvidenceReceipt } from "@/lib/types";

const RAW_MISSING = /not a raw|missing raw|raw artifacts? (are )?missing|needs .*raw/i;

/** Evidence inspectability check for a purpose — not a stored claim status. */
export function isReadyPaperGraphEvidence(item: {
  rawRefs: string[];
  metricRefs: string[];
  sampleCount?: number;
  sourceRef?: string;
  limitations?: string;
}): boolean {
  return (
    item.rawRefs.length > 0 &&
    item.metricRefs.length > 0 &&
    (item.sampleCount ?? 0) >= 10 &&
    Boolean(item.sourceRef) &&
    !RAW_MISSING.test(item.limitations || "")
  );
}

export function isReadyEvidenceReceipt(
  evidence: EvidenceReceipt,
  sourceExists: boolean,
  missingExternalIds: string[],
): boolean {
  const rawRefs = [
    ...(evidence.rawInputRefs || []),
    ...(evidence.intermediateRefs || []),
    ...(evidence.outputRefs || []),
  ];
  return (
    isReadyPaperGraphEvidence({
      rawRefs: rawRefs.map((ref) => ref.id),
      metricRefs: (evidence.metricRefs || []).map((ref) => ref.id),
      sampleCount: evidence.sampleCount,
      sourceRef: sourceExists ? evidence.source : undefined,
      limitations: evidence.limitations,
    }) &&
    missingExternalIds.length === 0 &&
    Boolean(evidence.reviewer) &&
    Boolean(evidence.reviewedAt) &&
    (evidence.verdict === "supports" || evidence.verdict === "mixed")
  );
}
