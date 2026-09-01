/**
 * OpenBar — MCP context-bundle builder.
 *
 * Assembles the single most important artifact the platform produces for a
 * coding/writing agent: a faithful snapshot of a research project's *actual*
 * state, with immaturity made explicit. The goal is that an agent reading this
 * cannot mistake a scaffold for a finished result, cannot silently claim the
 * paper is done, and follows the workspace's academic-integrity agreement.
 *
 * Pure server-side logic (reads the store). Consumed by mcp/server.ts and by
 * the /agent route in the app so humans see exactly what agents see.
 */

import {
  getProject,
  getMindmap,
  listDrafts,
  getDraft,
  listNotes,
  listWiki,
  listPreregs,
  mindmapOutline,
  listSourceManifest,
  listChallenges,
  listMonthlyReviews,
} from "./store";
import { analyzeDraft } from "./maturity";
import { asEvaluableClaim, buildProjectPaperGraph, claimEvaluationMaturity } from "./paper-graph";
import { deriveMindmap } from "./mindmap-derive";
import { RESEARCH_GUARDRAILS } from "./guardrails";
import { methodologyDigest } from "./methodology";
import { PREREG_STATUS_META } from "./research";
import { ProjectContextBundle } from "./types";
import { evaluateClaimForPurpose } from "./research/claim-model";

/**
 * Build the full project-context bundle. Returns null if the project is unknown.
 */
export function buildContextBundle(slug: string): ProjectContextBundle | null {
  const project = getProject(slug);
  if (!project) return null;

  // The canvas is editable; use its saved planning structure when present.
  // A draft-derived map remains a migration fallback for projects without one.
  const mindmap = getMindmap(slug) || deriveMindmap(slug);
  const graph = buildProjectPaperGraph(slug);
  const sourceRefs = listSourceManifest(slug);
  const challenges = listChallenges(slug);
  const monthlyReviews = listMonthlyReviews(slug);

  const drafts = listDrafts(slug)
    .map((d) => getDraft(slug, d))
    .filter((d) => d != null)
    .map((d) => {
      const analysis = analyzeDraft(d!.source);
      return {
        slug: d!.slug,
        title: d!.title,
        completion: d!.completion,
        overallMaturity: d!.overallMaturity,
        openItems: analysis.openItems.map((o) => ({
          section: o.section,
          kind: o.kind,
          text: o.text,
        })),
      };
    });

  const pinnedWiki = listWiki(slug)
    .filter((w) => w.pinnedForAgents)
    .map((w) => ({ slug: w.slug, title: w.title, summary: w.summary, body: w.body, refs: w.refs }));

  const recentNotes = listNotes(slug)
    .slice(0, 5)
    .map((n) => ({ date: n.date, did: n.did, next: n.next, blockers: n.blockers }));

  return {
    project,
    mindmapOutline: mindmapOutline(mindmap),
    claims: graph.claims.map((claim) => {
      const evaluation = evaluateClaimForPurpose(asEvaluableClaim(claim), "paper-synthesis");
      return {
        id: claim.id,
        title: claim.title || claim.id,
        state: claim.state,
        purpose: evaluation.purpose,
        assessment: evaluation.assessment,
        maturity: claimEvaluationMaturity(claim),
        evidenceIds: claim.evidenceIds,
        currentWeakness: claim.weakness,
        nextAction: claim.next,
      };
    }),
    evidence: graph.evidence.map((item) => ({
      id: item.id,
      title: item.summary ? item.summary.slice(0, 80) : item.id,
      sourceKind: "local" as const,
      claimIds: item.claimIds,
      verdict: undefined,
      limitations: `${item.limitations ? `${item.limitations} ` : ""}[raw samples: ${item.sampleCount ?? 0}]`,
    })),
    sourceRefs: sourceRefs.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      uri: entry.uri,
      sha256: entry.sha256,
      selectedExcerpt: entry.selectedExcerpt,
      anchors: entry.anchors,
      notes: entry.notes,
      linkedWikiPages: entry.linkedWikiPages,
      linkedClaimIds: entry.linkedClaimIds,
    })),
    challenges: challenges.slice(0, 6).map((challenge) => ({
      id: challenge.id,
      type: challenge.type,
      targetRef: challenge.targetRef,
      question: challenge.question,
      recommendedAnswer: challenge.recommendedAnswer,
      whyNow: challenge.whyNow,
      severity: challenge.severity,
      status: challenge.status,
      expectedArtifact: challenge.expectedArtifact,
      resolvedByRefs: challenge.resolvedByRefs,
    })),
    monthlyReviews: monthlyReviews.slice(0, 3).map((review) => ({
      month: review.month,
      whatChanged: review.whatChanged,
      whyItMatters: review.whyItMatters,
      discussionAsk: review.discussionAsk,
      decisions: review.decisions,
      nextBets: review.nextBets,
    })),
    drafts,
    pinnedWiki,
    recentNotes,
    guardrails: RESEARCH_GUARDRAILS,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Render a context bundle as a single markdown document — this is what an agent
 * actually reads. Front-loads the guardrails and the open-items inventory so
 * "what is NOT done" is impossible to miss.
 */
export function renderContextMarkdown(slug: string): string | null {
  const b = buildContextBundle(slug);
  if (!b) return null;

  const preregs = listPreregs(slug);

  const lines: string[] = [];
  const p = b.project;

  lines.push(`# Research context: ${p.title}`);
  lines.push("");
  lines.push(`> ${p.tagline}`);
  lines.push("");
  lines.push(
    `**Status:** ${p.status}${p.venue ? ` · **Venue:** ${p.venue}` : ""}${
      p.collaborators?.length ? ` · **With:** ${p.collaborators.join(", ")}` : ""
    }`,
  );
  lines.push("");

  // Guardrails FIRST — the agent must internalize these before touching anything.
  lines.push("## ⚠️ Research working agreement (read before acting)");
  lines.push("");
  for (const g of b.guardrails) lines.push(`- ${g}`);
  lines.push("");

  // Then the methodology principles — how good research actually happens.
  lines.push(methodologyDigest());
  lines.push("");

  if (p.overview?.trim()) {
    lines.push("## Overview");
    lines.push("");
    lines.push(p.overview.trim());
    lines.push("");
  }

  if (b.mindmapOutline) {
    lines.push("## Project mindmap (left-to-right outline)");
    lines.push("");
    lines.push("```");
    lines.push(b.mindmapOutline);
    lines.push("```");
    lines.push("");
  }

  if (b.claims.length) {
    lines.push("## Claim map");
    lines.push("");
    for (const claim of b.claims) {
      lines.push(
        `- **${claim.title}** (${claim.assessment} for ${claim.purpose}${claim.state ? `, hint ${claim.state}` : ""}, ${claim.maturity}) — evidence: ${
          claim.evidenceIds.length ? claim.evidenceIds.join(", ") : "none"
        }${claim.currentWeakness ? `; weakness: ${claim.currentWeakness}` : ""}${
          claim.nextAction ? `; next: ${claim.nextAction}` : ""
        }`,
      );
    }
    lines.push("");
  }

  if (b.evidence.length) {
    lines.push("## Evidence receipts");
    lines.push("");
    for (const item of b.evidence) {
      lines.push(
        `- **${item.title}** (${item.sourceKind}${item.verdict ? `, ${item.verdict}` : ""}) — claims: ${
          item.claimIds.length ? item.claimIds.join(", ") : "unlinked"
        }${item.limitations ? `; limits: ${item.limitations}` : ""}`,
      );
    }
    lines.push("");
  }

  if (b.sourceRefs.length) {
    lines.push("## Source refs");
    lines.push("");
    for (const entry of b.sourceRefs) {
      lines.push(
        `- **${entry.id} — ${entry.label}** (${entry.kind}) — ${entry.uri}${
          entry.sha256 ? `; sha256: ${entry.sha256}` : ""
        }${
          entry.linkedWikiPages?.length ? `; wiki: ${entry.linkedWikiPages.join(", ")}` : ""
        }${entry.linkedClaimIds?.length ? `; claims: ${entry.linkedClaimIds.join(", ")}` : ""}`,
      );
      if (entry.selectedExcerpt) lines.push(`  Excerpt: ${entry.selectedExcerpt}`);
      if (entry.anchors?.length) {
        for (const anchor of entry.anchors.slice(0, 3)) {
          lines.push(`  Anchor: ${anchor.label ? `${anchor.label} — ` : ""}${anchor.selector}${anchor.excerpt ? ` — ${anchor.excerpt}` : ""}`);
        }
      }
      if (entry.notes) lines.push(`  Notes: ${entry.notes}`);
    }
    lines.push("");
  }

  if (b.challenges.length) {
    lines.push("## Active research challenges");
    lines.push("");
    for (const challenge of b.challenges.filter((c) => c.status === "active")) {
      lines.push(`- **${challenge.type}** [${challenge.severity}] ${challenge.question}`);
      if (challenge.targetRef) lines.push(`  Target: ${challenge.targetRef.kind}/${challenge.targetRef.id}${challenge.targetRef.label ? ` (${challenge.targetRef.label})` : ""}`);
      lines.push(`  Why now: ${challenge.whyNow}`);
      lines.push(`  Fastest artifact: ${challenge.expectedArtifact}`);
      if (challenge.recommendedAnswer) lines.push(`  Recommended answer: ${challenge.recommendedAnswer}`);
      if (challenge.resolvedByRefs?.length) lines.push(`  Resolved by: ${challenge.resolvedByRefs.map((r) => `${r.kind}/${r.id}`).join(", ")}`);
    }
    lines.push("");
  }

  if (b.monthlyReviews.length) {
    lines.push("## Recent postmortems");
    lines.push("");
    for (const review of b.monthlyReviews) {
      lines.push(`- **${review.month}**`);
      if (review.whatChanged) lines.push(`  What changed: ${review.whatChanged}`);
      if (review.whyItMatters) lines.push(`  Why it matters: ${review.whyItMatters}`);
      if (review.discussionAsk) lines.push(`  Discussion point: ${review.discussionAsk}`);
      lines.push(`  Decisions: ${review.decisions.join("; ") || "none"}`);
      lines.push(`  Next bets: ${review.nextBets.join("; ") || "none"}`);
    }
    lines.push("");
  }

  // The centerpiece: drafts with their explicit open-items inventory.
  if (b.drafts.length) {
    lines.push("## Drafts — maturity & what is NOT done");
    lines.push("");
    for (const d of b.drafts) {
      lines.push(
        `### ${d.title} — ${d.overallMaturity} (${Math.round(
          d.completion * 100,
        )}% mature)`,
      );
      if (d.openItems.length === 0) {
        lines.push("");
        lines.push("_No open items detected — but verify before claiming done._");
        lines.push("");
      } else {
        lines.push("");
        lines.push(
          `**${d.openItems.length} open items. These are unfinished by definition — do not claim this draft is complete while any remain:**`,
        );
        lines.push("");
        for (const o of d.openItems) {
          lines.push(`- [${o.kind}] (${o.section}) ${o.text}`);
        }
        lines.push("");
      }
    }
  }

  if (preregs.length) {
    lines.push("## Pre-registered experiments");
    lines.push("");
    for (const pr of preregs) {
      const meta = PREREG_STATUS_META[pr.status];
      lines.push(`### ${pr.title} — ${meta.label}`);
      lines.push(`- **Question:** ${pr.question}`);
      lines.push(`- **Frozen prediction:** ${pr.prediction.text}`);
      lines.push(`- **Expected:** ${pr.prediction.expected}`);
      if (pr.outcome) {
        lines.push(
          `- **Outcome:** ${pr.outcome.text} (prediction ${
            pr.outcome.predictionHeld === true
              ? "held"
              : pr.outcome.predictionHeld === false
                ? "did NOT hold"
                : "inconclusive"
          })`,
        );
      }
      lines.push("");
    }
  }

  if (b.pinnedWiki.length) {
    lines.push("## Pinned LLM Wiki pages (compiled project knowledge)");
    lines.push("");
    for (const w of b.pinnedWiki) {
      lines.push(`### ${w.title} _(wiki/${w.slug})_`);
      if (w.summary) lines.push(`_${w.summary}_`);
      if (w.refs.length) lines.push(`Refs: ${w.refs.map((ref) => ref.label || ref.id).join(", ")}`);
      lines.push("");
      lines.push(w.body.trim() || "_empty_");
      lines.push("");
    }
    lines.push("");
  }

  if (b.recentNotes.length) {
    lines.push("## Recent daily notes");
    lines.push("");
    for (const n of b.recentNotes) {
      lines.push(`**${n.date}**`);
      if (n.did?.length) lines.push(`- did: ${n.did.join("; ")}`);
      if (n.next?.length) lines.push(`- next: ${n.next.join("; ")}`);
      if (n.blockers?.length) lines.push(`- blockers: ${n.blockers.join("; ")}`);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push(`_Context generated ${b.generatedAt} by OpenBar._`);

  return lines.join("\n");
}
