export type HostResources = {
  sampledAt: number;
  cpuPercent: number | null;
  memory: { availableBytes: number; totalBytes: number; usedPercent: number };
  pressure: { cpu: boolean; memory: boolean };
};
