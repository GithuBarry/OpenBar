import {
  getDraft,
  listChallenges,
  listClaims,
  listDrafts,
  listEvidence,
  listMonthlyReviews,
  listNotes,
  listProjects,
  listSourceManifest,
} from "./store";
import { claimFromRecord, evaluateClaimForPurpose } from "./research/claim-model";
import type { Project } from "./types";

export type WeeklyReviewKind =
  | "claim"
  | "evidence"
  | "source"
  | "challenge"
  | "draft"
  | "note"
  | "review";

export interface WeeklyReviewItem {
  project: Pick<Project, "slug" | "title" | "icon" | "mode">;
  kind: WeeklyReviewKind;
  title: string;
  detail: string;
  at: string;
  href: string;
  needsAttention?: boolean;
}

export interface WeeklyReviewPacket {
  since: string;
  generatedAt: string;
  items: WeeklyReviewItem[];
  changes: WeeklyReviewItem[];
  sourceRegistrations: WeeklyReviewItem[];
  attention: WeeklyReviewItem[];
}

export function buildWeeklyReview({
  since,
  days = 7,
  now = new Date(),
}: {
  since?: string;
  days?: number;
  now?: Date;
} = {}): WeeklyReviewPacket {
  const sinceDate = since ? new Date(since) : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const sinceIso = sinceDate.toISOString();
  const items: WeeklyReviewItem[] = [];

  for (const project of listProjects()) {
    const projectRef = {
      slug: project.slug,
      title: project.title,
      icon: project.icon,
      mode: project.mode,
    };

    for (const claim of listClaims(project.slug)) {
      const evaluation = evaluateClaimForPurpose(claimFromRecord(claim), "paper-synthesis");
      addIfRecent(items, sinceDate, {
        project: projectRef,
        kind: "claim",
        title: claim.title,
        detail: `${evaluation.assessment} for ${evaluation.purpose}${claim.nextAction ? ` · next: ${claim.nextAction}` : ""}`,
        at: claim.updatedAt || claim.lastCheckedAt || "",
        href: `/p/${project.slug}/mindmap`,
        needsAttention: evaluation.assessment === "needs-work",
      });
    }

    for (const evidence of listEvidence(project.slug)) {
      const rawCount =
        (evidence.rawInputRefs?.length ?? 0) +
        (evidence.intermediateRefs?.length ?? 0) +
        (evidence.outputRefs?.length ?? 0);
      addIfRecent(items, sinceDate, {
        project: projectRef,
        kind: "evidence",
        title: evidence.title,
        detail: `${evidence.verdict || "no verdict"} · samples ${evidence.sampleCount ?? 0} · raw refs ${rawCount}`,
        at: evidence.updatedAt,
        href: `/p/${project.slug}/mindmap`,
        needsAttention: rawCount === 0 || (evidence.sampleCount ?? 0) < 10 || evidence.verdict === "inconclusive",
      });
    }

    for (const source of listSourceManifest(project.slug)) {
      addIfRecent(items, sinceDate, {
        project: projectRef,
        kind: "source",
        title: source.label,
        detail: `${source.kind}${source.sha256 ? " · hashed" : ""}${source.selectedExcerpt ? " · excerpt" : ""}`,
        at: source.fetchedAt || source.mtime || "",
        href: `/p/${project.slug}/wiki/artifact-map`,
        needsAttention: !source.sha256 || !source.selectedExcerpt,
      });
    }

    for (const challenge of listChallenges(project.slug)) {
      addIfRecent(items, sinceDate, {
        project: projectRef,
        kind: "challenge",
        title: challenge.question,
        detail: `${challenge.severity}, ${challenge.status} · ${challenge.expectedArtifact}`,
        at: challenge.lastRaisedAt || challenge.createdAt,
        href: `/p/${project.slug}`,
        needsAttention: challenge.status === "active" && challenge.severity === "gate",
      });
    }

    for (const note of listNotes(project.slug)) {
      addIfRecent(items, sinceDate, {
        project: projectRef,
        kind: "note",
        title: note.date,
        detail: [...(note.did || []), ...(note.next || []), ...(note.blockers || [])].slice(0, 2).join(" · ") || "daily note updated",
        at: note.updatedAt || note.date,
        href: `/p/${project.slug}`,
        needsAttention: Boolean(note.blockers?.length),
      });
    }

    for (const draftSlug of listDrafts(project.slug)) {
      const draft = getDraft(project.slug, draftSlug);
      if (!draft) continue;
      addIfRecent(items, sinceDate, {
        project: projectRef,
        kind: "draft",
        title: draft.title,
        detail: `${draft.overallMaturity} · ${Math.round(draft.completion * 100)}% mature`,
        at: draft.updatedAt,
        href: `/p/${project.slug}/paper`,
        needsAttention: draft.overallMaturity !== "final",
      });
    }

    for (const review of listMonthlyReviews(project.slug)) {
      addIfRecent(items, sinceDate, {
        project: projectRef,
        kind: "review",
        title: `${project.title} ${review.month}`,
        detail: review.whatChanged || review.nextBets[0] || review.discussionAsk || "postmortem packet updated",
        at: review.updatedAt,
        href: "/review",
        needsAttention: review.nextBets.length > 0,
      });
    }
  }

  const sorted = items.sort(compareWeeklyItems);
  const changes = sorted.filter((item) => item.kind !== "source");
  const sourceRegistrations = sorted.filter((item) => item.kind === "source");
  return {
    since: sinceIso,
    generatedAt: now.toISOString(),
    items: sorted,
    changes,
    sourceRegistrations,
    attention: sorted.filter((item) => item.needsAttention && item.kind !== "review").sort(compareAttentionItems),
  };
}

export function renderWeeklyReviewMarkdown(packet: WeeklyReviewPacket, maxItems = 24): string {
  return [
    "# Weekly review packet",
    "",
    `- since: ${packet.since.slice(0, 10)}`,
    `- generated: ${packet.generatedAt}`,
    `- research changes: ${packet.changes.length}`,
    `- source registrations: ${packet.sourceRegistrations.length}`,
    `- needs attention: ${packet.attention.length}`,
    "",
    "## What changed",
    "",
    packet.changes.length
      ? packet.changes
          .slice(0, maxItems)
          .map((item) => `- **${item.project.title}** [${item.kind}] ${item.title} — ${item.detail}`)
          .join("\n")
      : "- No claim, evidence, review, note, draft, or challenge changes recorded in this window.",
    packet.changes.length > maxItems ? `\n- ... ${packet.changes.length - maxItems} more change(s) omitted` : undefined,
    "",
    "## Advisor attention",
    "",
    packet.attention.length
      ? packet.attention
          .slice(0, maxItems)
          .map((item) => `- **${item.project.title}** [${item.kind}] ${item.title} — ${item.detail}`)
          .join("\n")
      : "- No attention items found in this window.",
    "",
    "## Source registrations",
    "",
    packet.sourceRegistrations.length
      ? packet.sourceRegistrations
          .slice(0, maxItems)
          .map((item) => `- **${item.project.title}** ${item.title} — ${item.detail}`)
          .join("\n")
      : "- No source registrations in this window.",
  ]
    .filter((part) => part !== undefined)
    .join("\n");
}

function compareAttentionItems(a: WeeklyReviewItem, b: WeeklyReviewItem): number {
  const priority = (item: WeeklyReviewItem) => {
    const order: Record<WeeklyReviewKind, number> = {
      evidence: 0,
      claim: 1,
      challenge: 2,
      draft: 3,
      note: 4,
      source: 5,
      review: 6,
    };
    return order[item.kind];
  };
  const byPriority = priority(a) - priority(b);
  if (byPriority !== 0) return byPriority;
  return b.at.localeCompare(a.at);
}

function compareWeeklyItems(a: WeeklyReviewItem, b: WeeklyReviewItem): number {
  const priority = (item: WeeklyReviewItem) => {
    const order: Record<WeeklyReviewKind, number> = {
      review: 0,
      evidence: 1,
      claim: 2,
      draft: 3,
      note: 4,
      challenge: 5,
      source: 6,
    };
    return order[item.kind] + (item.needsAttention ? -0.25 : 0);
  };
  const byPriority = priority(a) - priority(b);
  if (byPriority !== 0) return byPriority;
  return b.at.localeCompare(a.at);
}

function addIfRecent(items: WeeklyReviewItem[], since: Date, item: WeeklyReviewItem) {
  const at = parseDate(item.at);
  if (!at || at < since) return;
  items.push({ ...item, at: at.toISOString() });
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
