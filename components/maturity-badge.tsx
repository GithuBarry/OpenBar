import { Maturity, MATURITY_LEVELS, MATURITY_META } from "@/lib/types";
import { MATURITY_STYLE } from "@/lib/maturity-style";
import { cn } from "@/lib/utils";

/** A small pill showing a maturity level, colored consistently app-wide. */
export function MaturityBadge({
  maturity,
  size = "sm",
  showDot = true,
  className,
}: {
  maturity: Maturity;
  size?: "xs" | "sm" | "md";
  showDot?: boolean;
  className?: string;
}) {
  const style = MATURITY_STYLE[maturity];
  const meta = MATURITY_META[maturity];
  return (
    <span
      title={meta.blurb}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        style.bg,
        style.text,
        style.border,
        size === "xs" && "px-1.5 py-px text-[10px]",
        size === "sm" && "px-2 py-0.5 text-xs",
        size === "md" && "px-2.5 py-1 text-sm",
        className,
      )}
    >
      {showDot && <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />}
      {meta.label}
    </span>
  );
}

/**
 * A horizontal maturity scale meter: shows where a document sits on the
 * empty → final progression. Used on dashboards and draft headers.
 */
export function MaturityMeter({
  maturity,
  className,
}: {
  maturity: Maturity;
  className?: string;
}) {
  const currentRank = MATURITY_META[maturity].rank;
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className="flex flex-1 gap-1">
        {MATURITY_LEVELS.map((level) => {
          const style = MATURITY_STYLE[level];
          const active = MATURITY_META[level].rank <= currentRank;
          return (
            <div
              key={level}
              title={MATURITY_META[level].label}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors duration-ui",
                active ? (level === "empty" ? "bg-m-review" : style.dot) : "bg-line",
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
