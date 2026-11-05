import type { PaperCompileStatus } from "@/lib/tex-project/compile";

/**
 * The PDF currently shown by the editor is independent from the compile job
 * that is being requested. Keeping this small record beside the latest job
 * status lets source edits and failed builds leave the last addressable PDF
 * available to the reader.
 */
export type LastSuccessfulPdfArtifact = {
  artifactId: string;
  artifactSourceHash?: string;
  artifactBuildInputHash?: string;
  pageBudget?: PaperCompileStatus["pageBudget"];
};

/** Client-only state layered on top of the server compile status. */
export type PaperCompileViewState = PaperCompileStatus & {
  lastSuccessfulArtifact?: LastSuccessfulPdfArtifact;
  /** The server job remains running while browser observation is paused. */
  observationDelayed?: boolean;
};

export const COMPILE_POLL_MS = 400;
export const COMPILE_POLL_MAX_MS = 120_000;
export const COMPILE_POLL_MAX_DELAY_MS = 4_000;

export type CompilePollDecision =
  | { kind: "poll"; delayMs: number }
  | { kind: "observation-delayed"; message: string };

/** Keep polling backoff deterministic so transitions can be tested directly. */
export function nextCompilePollDelay(delayMs: number): number {
  return Math.min(Math.round(delayMs * 1.5), COMPILE_POLL_MAX_DELAY_MS);
}

/**
 * Decide whether a running job is still inside the browser observation window.
 * A deadline changes observation state only. The server remains authoritative
 * for the job's terminal success, failure, or five-minute timeout.
 */
export function compilePollDecision(elapsedMs: number, delayMs: number): CompilePollDecision {
  if (elapsedMs >= COMPILE_POLL_MAX_MS) {
    return {
      kind: "observation-delayed",
      message: "The compile is still running. Polling paused after 120 seconds. Resume polling to check the same job.",
    };
  }
  return { kind: "poll", delayMs: nextCompilePollDelay(delayMs) };
}

function artifactFromStatus(status: Partial<PaperCompileViewState>): LastSuccessfulPdfArtifact | undefined {
  if (!status.artifactId || status.pdfAvailable === false) return undefined;
  return {
    artifactId: status.artifactId,
    ...(status.artifactSourceHash ? { artifactSourceHash: status.artifactSourceHash } : {}),
    ...(status.artifactBuildInputHash ? { artifactBuildInputHash: status.artifactBuildInputHash } : {}),
    ...(status.pageBudget ? { pageBudget: status.pageBudget } : {}),
  };
}

function artifactMatchesTarget(
  artifact: LastSuccessfulPdfArtifact,
  status: Partial<PaperCompileViewState>,
): boolean {
  if (artifact.artifactBuildInputHash && status.buildInputHash) {
    return artifact.artifactBuildInputHash === status.buildInputHash;
  }
  if (artifact.artifactSourceHash && status.sourceHash) {
    return artifact.artifactSourceHash === status.sourceHash;
  }
  // A terminal success with incomplete identity metadata is still the
  // server's authoritative success. The next status refresh can add hashes.
  return true;
}

/**
 * Apply a server or local compile transition while preserving the latest
 * successful, addressable artifact. Incoming success metadata atomically
 * replaces the retained record. All other states retain it and become stale
 * until a matching successful build arrives.
 */
export function transitionCompileStatus(
  current: PaperCompileViewState,
  next: Partial<PaperCompileViewState>,
): PaperCompileViewState {
  const incomingArtifact = artifactFromStatus(next);
  const currentArtifact = current.lastSuccessfulArtifact || artifactFromStatus(current);
  const retainedArtifact = next.pdfAvailable === false
    ? undefined
    : incomingArtifact && currentArtifact && incomingArtifact.artifactId === currentArtifact.artifactId
      ? { ...currentArtifact, ...incomingArtifact }
      : incomingArtifact || currentArtifact;
  const merged: PaperCompileViewState = { ...current, ...next };

  if (retainedArtifact) {
    merged.lastSuccessfulArtifact = retainedArtifact;
    // Keep the flat fields consumed by the existing PDF viewer and API-facing
    // snapshot while the nested record remains the independent source of truth.
    merged.pdfAvailable = next.pdfAvailable ?? current.pdfAvailable ?? true;
    merged.artifactId = next.artifactId ?? retainedArtifact.artifactId;
    merged.artifactSourceHash = next.artifactSourceHash ?? retainedArtifact.artifactSourceHash;
    merged.artifactBuildInputHash = next.artifactBuildInputHash ?? retainedArtifact.artifactBuildInputHash;
    if (merged.pageBudget === undefined && retainedArtifact.pageBudget !== undefined) {
      merged.pageBudget = retainedArtifact.pageBudget;
    }
  } else if (next.pdfAvailable === false) {
    delete merged.lastSuccessfulArtifact;
    delete merged.artifactId;
    delete merged.artifactSourceHash;
    delete merged.artifactBuildInputHash;
  }

  if (next.state && next.state !== "running") {
    delete merged.observationDelayed;
  }
  if (next.state === "success" && next.message === undefined) delete merged.message;

  const targetMismatch = retainedArtifact && (next.buildInputHash || next.sourceHash)
    ? !artifactMatchesTarget(retainedArtifact, next)
    : false;
  if (targetMismatch) {
    merged.stale = true;
  } else if (next.stale !== undefined) {
    merged.stale = next.stale;
  } else if (retainedArtifact) {
    const state = next.state || current.state;
    merged.stale = state === "success"
      ? (incomingArtifact ? !artifactMatchesTarget(retainedArtifact, next) : current.stale)
      : true;
  }

  return merged;
}

/** Mark the browser observation window as paused without changing job state. */
export function markCompileObservationDelayed(current: PaperCompileViewState, message: string): PaperCompileViewState {
  if (current.state !== "running") return current;
  return transitionCompileStatus(current, {
    state: "running",
    observationDelayed: true,
    message,
  });
}

/** Resume polling the same server job while retaining its PDF and metadata. */
export function resumeCompilePolling(current: PaperCompileViewState): PaperCompileViewState {
  if (current.state !== "running") return current;
  const resumed = transitionCompileStatus(current, {
    state: "running",
    observationDelayed: false,
    message: undefined,
  });
  delete resumed.observationDelayed;
  return resumed;
}

/** Surface a transient observation problem without replacing compile state. */
export function recordCompileObservationError(current: PaperCompileViewState, message: string): PaperCompileViewState {
  if (current.state !== "running") return current;
  return transitionCompileStatus(current, {
    state: current.state,
    message,
  });
}
