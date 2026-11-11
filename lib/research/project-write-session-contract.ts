export const PROJECT_WRITE_SESSION_TTL_MS = 45_000;
export const PROJECT_WRITE_SESSION_HEARTBEAT_MS = 10_000;
export const PROJECT_WRITE_SESSION_IDLE_MS = 120_000;
export const PROJECT_WRITE_SESSION_HEADER = "X-OpenBar-Write-Session";

export type ProjectWriteSessionCredential = {
  sessionId: string;
  token: string;
  generation: string;
};

export type ProjectWriteSessionStatus = {
  state: "available" | "occupied";
  writable: boolean;
  ownerLabel: string | null;
  ownerGeneration: string | null;
  expiresAt: number | null;
  serverTime: number;
};

export type ProjectWriteSessionResult =
  | { ok: true; status: ProjectWriteSessionStatus; credential?: ProjectWriteSessionCredential }
  | { ok: false; code: string; message: string; status: ProjectWriteSessionStatus };
