import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes with correct conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** ISO week key like 2026-W27 for a given date. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Deterministic short id (no crypto dependency, fine for content ids). */
export function shortId(prefix = "n"): string {
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 1e6).toString(36);
  return `${prefix}_${t}${r}`;
}

/** Slugify arbitrary text. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [60_000, "s"],
    [3_600_000, "m"],
    [86_400_000, "h"],
    [604_800_000, "d"],
    [2_592_000_000, "w"],
    [Infinity, "mo"],
  ];
  const divisors = [1000, 60_000, 3_600_000, 86_400_000, 604_800_000, 2_592_000_000];
  for (let i = 0; i < units.length; i++) {
    if (abs < units[i][0]) {
      const v = Math.round(abs / divisors[i]);
      return diff >= 0 ? `${v}${units[i][1]} ago` : `in ${v}${units[i][1]}`;
    }
  }
  return formatWorkspaceDate(iso);
}

export function formatWorkspaceDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: process.env.OPENBAR_TZ || undefined,
  }).format(d);
}
