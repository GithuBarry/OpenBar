import { Maturity, MATURITY_LEVELS, MATURITY_META } from "@/lib/types";

/**
 * Static Tailwind class strings for each maturity level. Using a literal lookup
 * (rather than `bg-m-${x}` template strings) guarantees the classes survive
 * Tailwind's JIT purge. Every module that colors by maturity imports from here
 * so the visual language stays identical across the app.
 */
export interface MaturityStyle {
  /** Solid text color. */
  text: string;
  /** Soft tinted background. */
  bg: string;
  /** Border color. */
  border: string;
  /** Filled pill (badge). */
  solid: string;
  /** Ring / focus. */
  ring: string;
  /** Raw CSS var reference for canvas / inline styles. */
  varName: string;
  /** Dot / swatch. */
  dot: string;
}

export const MATURITY_STYLE: Record<Maturity, MaturityStyle> = {
  empty: {
    text: "text-m-empty",
    bg: "bg-m-empty/10",
    border: "border-m-empty/40",
    solid: "bg-m-empty/15 text-m-empty",
    ring: "ring-m-empty/30",
    varName: "var(--m-empty)",
    dot: "bg-m-empty",
  },
  hypothesized: {
    text: "text-m-hypo",
    bg: "bg-m-hypo/10",
    border: "border-m-hypo/40",
    solid: "bg-m-hypo/15 text-m-hypo",
    ring: "ring-m-hypo/30",
    varName: "var(--m-hypo)",
    dot: "bg-m-hypo",
  },
  draft: {
    text: "text-m-draft",
    bg: "bg-m-draft/10",
    border: "border-m-draft/40",
    solid: "bg-m-draft/15 text-m-draft",
    ring: "ring-m-draft/30",
    varName: "var(--m-draft)",
    dot: "bg-m-draft",
  },
  review: {
    text: "text-m-review",
    bg: "bg-m-review/10",
    border: "border-m-review/40",
    solid: "bg-m-review/15 text-m-review",
    ring: "ring-m-review/30",
    varName: "var(--m-review)",
    dot: "bg-m-review",
  },
  final: {
    text: "text-m-final",
    bg: "bg-m-final/10",
    border: "border-m-final/40",
    solid: "bg-m-final/15 text-m-final",
    ring: "ring-m-final/30",
    varName: "var(--m-final)",
    dot: "bg-m-final",
  },
};

export { MATURITY_LEVELS, MATURITY_META };
export type { Maturity };
