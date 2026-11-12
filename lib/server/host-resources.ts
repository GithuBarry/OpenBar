import "server-only";
import os from "node:os";
import type { HostResources } from "@/lib/host-resources";

type Reading = { cpu: { idle: number; total: number }; totalBytes: number; availableBytes: number };
type Pressure = { active: boolean; since: number | null };
const SAMPLE_MS = 5_000;
const MAX_GAP_MS = 45_000;

function advance(pressure: Pressure, value: number | null, now: number, high: number, low: number, enterMs: number): Pressure {
  if (value === null) return { active: pressure.active, since: null };
  const sustained = pressure.active ? value <= low : value >= high;
  if (!sustained) return { active: pressure.active, since: null };
  const since = pressure.since ?? now;
  return now - since >= (pressure.active ? 15_000 : enterMs)
    ? { active: !pressure.active, since: null }
    : { active: pressure.active, since };
}

function readHost(): Reading {
  const cpu = os.cpus().reduce((sum, core) => ({
    idle: sum.idle + core.times.idle,
    total: sum.total + Object.values(core.times).reduce((total, value) => total + value, 0),
  }), { idle: 0, total: 0 });
  const physical = os.totalmem();
  const constraint = process.constrainedMemory();
  const totalBytes = Number.isFinite(constraint) && constraint > 0 ? Math.min(physical, constraint) : physical;
  const available = process.availableMemory();
  const availableBytes = Math.max(0, Math.min(totalBytes, os.freemem(), Number.isFinite(available) && available >= 0 ? available : os.freemem()));
  return { cpu, totalBytes, availableBytes };
}

/** One lazy sampler serves every project and browser without a background timer. */
export function createHostResourceSampler(read: () => Reading = readHost, clock: () => number = () => performance.now()) {
  let previous: { at: number; reading: Reading } | null = null;
  let cached: HostResources | null = null;
  let cpuPressure: Pressure = { active: false, since: null };
  let memoryPressure: Pressure = { active: false, since: null };
  return (): HostResources => {
    const now = clock();
    if (previous && cached && now >= previous.at && now - previous.at < SAMPLE_MS) return cached;
    if (previous && (now < previous.at || now - previous.at > MAX_GAP_MS)) {
      previous = null;
      cpuPressure = { active: false, since: null };
      memoryPressure = { active: false, since: null };
    }
    const reading = read();
    const deltaTotal = previous ? reading.cpu.total - previous.reading.cpu.total : 0;
    const deltaIdle = previous ? reading.cpu.idle - previous.reading.cpu.idle : 0;
    const cpuPercent = Number.isFinite(deltaTotal) && Number.isFinite(deltaIdle) && deltaTotal > 0 && deltaIdle >= 0 && deltaIdle <= deltaTotal
      ? Math.round(1000 * (1 - deltaIdle / deltaTotal)) / 10 : null;
    const totalBytes = Number.isFinite(reading.totalBytes) && reading.totalBytes > 0 ? reading.totalBytes : 0;
    const availableBytes = totalBytes && Number.isFinite(reading.availableBytes)
      ? Math.max(0, Math.min(totalBytes, reading.availableBytes)) : 0;
    const usedPercent = totalBytes ? Math.round(1000 * (1 - availableBytes / totalBytes)) / 10 : 0;
    cpuPressure = advance(cpuPressure, cpuPercent, now, 90, 75, 20_000);
    memoryPressure = advance(memoryPressure, totalBytes ? usedPercent : null, now, 92, 88, 10_000);
    previous = { at: now, reading };
    cached = {
      sampledAt: Date.now(), cpuPercent,
      memory: { availableBytes, totalBytes, usedPercent },
      pressure: { cpu: cpuPressure.active, memory: memoryPressure.active },
    };
    return cached;
  };
}

const sample = createHostResourceSampler();

export function getHostResources(): HostResources | null {
  try { return sample(); }
  catch { return null; }
}
