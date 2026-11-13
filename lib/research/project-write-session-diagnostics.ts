import type { ProjectWriteSessionCredential, ProjectWriteSessionStatus } from "./project-write-session-contract";

/** Present this tab's access alongside the server's lease state for diagnostic reports. */
export function projectWriteSessionDiagnosticAccess({ status, credential, writable, publicDemo, reason }: {
  status: ProjectWriteSessionStatus | null;
  credential: Pick<ProjectWriteSessionCredential, "generation"> | null;
  writable: boolean;
  publicDemo: boolean;
  reason: string;
}) {
  const ownsLease = Boolean(credential && status?.state === "occupied" && status.writable && credential.generation === status.ownerGeneration);
  const editingHere = writable && ownsLease;
  return {
    state: publicDemo ? "public-demo" : editingHere ? "editing" : status?.state || "checking",
    leaseState: status?.state || null,
    ownsLease,
    reason: publicDemo ? "Public demo editing is available." : editingHere ? "Editing in this tab." : reason,
  };
}
