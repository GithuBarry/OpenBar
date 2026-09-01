import { Maturity, MaturityMarkerKind } from "@/lib/types";
import { MATURITY_STYLE } from "@/lib/maturity-style";
import { cn } from "@/lib/utils";

/** Maps an inline marker kind to the maturity level it signals. */
const KIND_TO_MATURITY: Record<string, Maturity> = {
  placeholder: "hypothesized",
  hypothesized: "hypothesized",
  notfinal: "draft",
  todo: "draft",
  cite: "draft",
  "citation-needed": "draft",
  verify: "draft",
};

const KIND_GLYPH: Record<string, string> = {
  placeholder: "▦",
  hypothesized: "?",
  notfinal: "~",
  todo: "☐",
  cite: "†",
  "citation-needed": "†",
  verify: "✓?",
};

/**
 * Inline highlight for a maturity marker inside rendered prose.
 * Pure inline element that preserves natural paragraph flow with subtle background tint.
 */
export function MaturityMark({
  kind,
  children,
}: {
  kind: MaturityMarkerKind | "cite";
  children: React.ReactNode;
}) {
  const label = kind.replace("citation-needed", "cite");
  return (
    <span className={cn("ob-marker-inline", `ob-marker-${label}`)} data-marker={kind} title={label}>
      {children}
    </span>
  );
}
