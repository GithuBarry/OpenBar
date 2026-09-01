/**
 * Claim annotation model.
 *
 * A claim is text + links + tags + assessments. Support is multidimensional;
 * a stored `state` ladder (seed → paper-ready) is not the identity of a claim.
 *
 * Persistence — no new TeX macros. Extra keys already round-trip:
 *
 * Comment envelopes (`% OB-DATA-BEGIN openbarry/record@1 id=…`):
 *   JSON already accepts extra fields. Persist `tags`, `assessments`,
 *   `challengeIds`, and `notes` on claim records. Legacy keys map in:
 *     claim            → text
 *     evidenceIds      → evidenceIds
 *     objectionIds     → challengeIds (if challengeIds absent)
 *     state            → deprecated display hint
 *
 * `\obclaim[id=…, state=…, evidence=…]{text}`:
 *   Optional args are already a free-form key=value map (`parseAnchorAttrs`).
 *   Extra keys such as `tags` parse without a syntax change. Structured
 *   `assessments` belong in the envelope, not the macro. `state=` stays as
 *   a deprecated display hint so existing `state=hypothesis` markup keeps
 *   compiling; it is not a readiness identity.
 *
 * Policy names `evaluateClaimForPurpose` / `getClaimConcerns` / `assessClaim`
 * live here until `lib/research/research-policy.ts` re-exports them.
 */

import { z } from "zod";

import { parseClaimTags, tagSchema } from "./claim-tags";

export const claimAssessmentSchema = z
  .object({
    id: z.string().min(1),
    dimension: z.string().min(1).max(64),
    value: z.union([z.string(), z.number(), z.boolean()]),
    scope: z.string().optional(),
    rationale: z.string().optional(),
    sourceIds: z.array(z.string()).optional(),
    createdBy: z.enum(["human", "agent", "system"]).optional(),
    createdAt: z.string().min(1),
  })
  .strict();

export type ClaimAssessment = z.infer<typeof claimAssessmentSchema>;

export const claimSchema = z
  .object({
    id: z.string().min(1),
    text: z.string(),
    evidenceIds: z.array(z.string()).default([]),
    challengeIds: z.array(z.string()).default([]),
    tags: z.array(tagSchema).default([]),
    assessments: z.array(claimAssessmentSchema).default([]),
    notes: z.array(z.string()).optional(),
    /** @deprecated Display ladder only. Not claim identity. */
    state: z.string().optional(),
  })
  .strict();

export type Claim = z.infer<typeof claimSchema>;

export type ResearchConfiguration = {
  suggestedClaimTags: string[];
  assessmentDimensions: {
    id: string;
    label: string;
    values?: string[];
    description?: string;
  }[];
};

export const DEFAULT_RESEARCH_CONFIGURATION: ResearchConfiguration = {
  suggestedClaimTags: [
    "needs-ablation",
    "citation-needed",
    "core-thesis",
    "speculative",
    "qualitative",
    "theory",
    "negative-result",
    "reviewer-sensitive",
    "replicated",
    "cross-model",
    "needs-replication",
    "empirical",
    "main-result",
  ],
  assessmentDimensions: [
    { id: "replication", label: "Replication", values: ["missing", "partial", "replicated"] },
    { id: "benchmark_support", label: "Benchmark support", values: ["weak", "mixed", "strong"] },
    { id: "writing_readiness", label: "Writing readiness" },
    { id: "generalization", label: "Generalization" },
  ],
};

export type ClaimPurposeContext = {
  purpose: string;
  venue?: string;
  projectConfig?: ResearchConfiguration;
};

export type ClaimConsiderationSeverity = "low" | "medium" | "high";

export type ClaimConsideration = {
  dimension: string;
  severity: ClaimConsiderationSeverity;
  message: string;
  code: string;
  sourceIds?: string[];
};

/** Derived judgment for a purpose — not a stored claim identity. */
export type ClaimPurposeJudgment = "ready" | "needs-work";

export type ClaimPurposeEvaluation = {
  claimId: string;
  purpose: string;
  assessment: ClaimPurposeJudgment;
  considerations: ClaimConsideration[];
};

const IDENTITY_TAGS = new Set(["unsupported", "weak", "moderate", "strong", "paper-ready"]);
const MISSING_REPLICATION = new Set([
  "missing",
  "absent",
  "incomplete",
  "needs-more-seeds",
  "needs-more",
  "needs-replication",
  "n=1",
  "single-seed",
  "unreplicated",
]);
const OK_REPLICATION = new Set(["replicated", "complete", "done", "ok", "yes"]);
const BENCHMARK_ON = /^(strong|weak|moderate|mixed|unsupported)-on-(.+)$/i;

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function splitIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).map((id) => id.trim()).filter(Boolean);
  if (typeof raw === "string") {
    return raw
      .split(/[,\s]+/)
      .map((id) => id.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeNotes(value: unknown): string[] | undefined {
  const notes = asStringList(value).map((note) => note.trim()).filter(Boolean);
  return notes.length > 0 ? notes : undefined;
}

function recordValue(data: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (data[key] !== undefined) return data[key];
  }
  return undefined;
}

/** Map an `openbarry/record@1` claim envelope (or ClaimCard JSON) onto Claim. */
export function claimFromRecord(record: unknown): Claim {
  if (!record || typeof record !== "object") throw new Error("Claim record must be an object.");
  const data = record as Record<string, unknown>;
  const challengeIds = splitIds(recordValue(data, "challengeIds"));
  return claimSchema.parse({
    id: data.id,
    text: data.text ?? data.claim ?? "",
    evidenceIds: splitIds(recordValue(data, "evidenceIds")),
    challengeIds: challengeIds.length > 0 ? challengeIds : splitIds(recordValue(data, "objectionIds")),
    tags: parseClaimTags((data.tags as string | string[] | undefined) ?? []),
    assessments: data.assessments ?? [],
    notes: normalizeNotes(data.notes),
    state: data.state === undefined || data.state === null ? undefined : String(data.state),
  });
}

/**
 * Map `\obclaim` optional-arg keys onto Claim. Assessments are envelope-only.
 * `state` is preserved as a deprecated hint when present.
 */
export function claimFromAnchor(attrs: Record<string, string>, text: string): Claim {
  return claimSchema.parse({
    id: attrs.id,
    text,
    evidenceIds: splitIds(attrs.evidence || attrs.evidenceIds),
    challengeIds: splitIds(attrs.challenges || attrs.challengeIds),
    tags: parseClaimTags(attrs.tags),
    assessments: [],
    state: attrs.state,
  });
}

function dimOf(value: string): string {
  return value.trim().toLowerCase();
}

function valueText(value: string | number | boolean): string {
  return String(value).trim().toLowerCase();
}

function isReplicationDimension(dimension: string): boolean {
  return dimOf(dimension) === "replication" || dimOf(dimension).includes("replicat");
}

function isBenchmarkDimension(dimension: string): boolean {
  const dim = dimOf(dimension);
  return dim === "benchmark_support" || dim.includes("benchmark");
}

function isMissingReplicationValue(value: string | number | boolean): boolean {
  if (value === false || value === 0) return true;
  return MISSING_REPLICATION.has(valueText(value));
}

function isOkReplicationValue(value: string | number | boolean): boolean {
  if (value === true) return true;
  return OK_REPLICATION.has(valueText(value));
}

function isSingleSeedValue(value: string | number | boolean, rationale?: string): boolean {
  const text = `${valueText(value)} ${rationale ?? ""}`.toLowerCase();
  return /\bn\s*=\s*1\b/.test(text) || /single[- ]seed|only one (random )?seed/.test(text) || valueText(value) === "n=1" || valueText(value) === "single-seed";
}

type Observation = Omit<ClaimConsideration, "severity"> & { defaultSeverity: ClaimConsiderationSeverity };

function sourceIdsOf(assessment: ClaimAssessment): string[] | undefined {
  return assessment.sourceIds && assessment.sourceIds.length > 0 ? assessment.sourceIds : undefined;
}

function observeClaim(claim: Claim): Observation[] {
  const observed: Observation[] = [];
  const replicationAssessments = claim.assessments.filter((item) => isReplicationDimension(item.dimension));
  const missingReplication = replicationAssessments.find((item) => isMissingReplicationValue(item.value));
  const okReplication = replicationAssessments.some((item) => isOkReplicationValue(item.value));
  const taggedNeedsReplication = claim.tags.some((tag) => dimOf(tag) === "needs-replication");

  if (missingReplication || (taggedNeedsReplication && !okReplication)) {
    const source = missingReplication;
    const singleSeed = source ? isSingleSeedValue(source.value, source.rationale) : false;
    observed.push({
      dimension: "replication",
      code: singleSeed ? "single-seed-result" : "missing-replication",
      message: source?.rationale?.trim() || (singleSeed ? "Only one seed is available." : "Replication evidence is missing."),
      sourceIds: source ? sourceIdsOf(source) : undefined,
      defaultSeverity: "high",
    });
  }

  const polarities = new Map<string, string>();
  for (const item of claim.assessments.filter((entry) => isBenchmarkDimension(entry.dimension))) {
    polarities.set((item.scope || item.id).toLowerCase(), valueText(item.value));
  }
  for (const tag of claim.tags) {
    const match = tag.match(BENCHMARK_ON);
    if (!match) continue;
    polarities.set(match[2]!.toLowerCase(), match[1]!.toLowerCase());
  }
  const polarityValues = [...new Set(polarities.values())];
  const mixedByValue = claim.assessments.some(
    (item) => isBenchmarkDimension(item.dimension) && valueText(item.value) === "mixed",
  );
  if (mixedByValue || polarityValues.length > 1) {
    const scopes = [...polarities.entries()].map(([scope, value]) => `${scope}: ${value}`).join("; ");
    const mixedAssessment = claim.assessments.find(
      (item) => isBenchmarkDimension(item.dimension) && (valueText(item.value) === "mixed" || polarityValues.length > 1),
    );
    observed.push({
      dimension: "benchmark_support",
      code: "mixed-benchmark-support",
      message: mixedAssessment?.rationale?.trim() || (scopes ? `Evidence is mixed across benchmarks (${scopes}).` : "Evidence is mixed across benchmarks."),
      sourceIds: mixedAssessment ? sourceIdsOf(mixedAssessment) : undefined,
      defaultSeverity: "medium",
    });
  }

  if (claim.evidenceIds.length === 0) {
    observed.push({
      dimension: "evidence",
      code: "claim-without-linked-evidence",
      message: "No evidence is linked to this claim.",
      defaultSeverity: "high",
    });
  }

  if (claim.challengeIds.length > 0) {
    observed.push({
      dimension: "challenge",
      code: "claim-with-unresolved-challenge",
      message: `Unresolved challenge(s): ${claim.challengeIds.join(", ")}.`,
      defaultSeverity: "medium",
    });
  }

  if (claim.tags.some((tag) => dimOf(tag) === "needs-ablation")) {
    observed.push({
      dimension: "method",
      code: "missing-baseline",
      message: "Claim is tagged needs-ablation.",
      defaultSeverity: "medium",
    });
  }

  return observed;
}

function resolvePurpose(purpose: string | ClaimPurposeContext): ClaimPurposeContext {
  return typeof purpose === "string" ? { purpose } : purpose;
}

function severityForPurpose(observation: Observation, purpose: string): ClaimConsiderationSeverity {
  const key = purpose.trim().toLowerCase();
  if (key === "draft" || key === "general") {
    if (observation.defaultSeverity === "high") return "medium";
    return observation.defaultSeverity;
  }
  if ((key === "camera_ready_main_result" || key === "main_result") && observation.dimension === "replication") {
    return "high";
  }
  if (key === "camera_ready_main_result" && observation.dimension === "benchmark_support") {
    return "high";
  }
  return observation.defaultSeverity;
}

function considerationsFor(claim: Claim, purpose: string): ClaimConsideration[] {
  return observeClaim(claim).map((observation) => ({
    dimension: observation.dimension,
    code: observation.code,
    message: observation.message,
    sourceIds: observation.sourceIds,
    severity: severityForPurpose(observation, purpose),
  }));
}

function judgmentOf(considerations: ClaimConsideration[]): ClaimPurposeJudgment {
  return considerations.some((item) => item.severity === "medium" || item.severity === "high")
    ? "needs-work"
    : "ready";
}

export function evaluateClaimForPurpose(
  claim: Claim,
  purpose: string | ClaimPurposeContext,
): ClaimPurposeEvaluation {
  const context = resolvePurpose(purpose);
  const considerations = considerationsFor(claim, context.purpose);
  return {
    claimId: claim.id,
    purpose: context.purpose,
    assessment: judgmentOf(considerations),
    considerations,
  };
}

export function getClaimConcerns(
  claim: Claim,
  context?: string | ClaimPurposeContext,
): ClaimConsideration[] {
  const purpose = typeof context === "string" ? context : context?.purpose ?? "general";
  return considerationsFor(claim, purpose);
}

/** Same derived evaluation as `evaluateClaimForPurpose`; default purpose is `general`. */
export function assessClaim(
  claim: Claim,
  context?: string | ClaimPurposeContext,
): ClaimPurposeEvaluation {
  const purpose = typeof context === "string" ? context : context?.purpose ?? "general";
  const rest = typeof context === "object" && context ? context : { purpose };
  return evaluateClaimForPurpose(claim, { ...rest, purpose });
}

/** Tags that look like a status ladder are annotations, not claim identity. */
export function isStatusLadderTag(tag: string): boolean {
  return IDENTITY_TAGS.has(tag.trim().toLowerCase());
}
