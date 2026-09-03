import { GitBranch } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/** Shared workspace lockup: the purple mark, serif name, and optional tagline. */
export function WorkspaceMark({
  name,
  tagline,
  compactTagline,
  href = "/",
  className,
  compact = false,
}: {
  name?: string;
  tagline?: string;
  compactTagline?: string;
  href?: string;
  className?: string;
  compact?: boolean;
}) {
  const tile = (
    <span
      className={cn(
        "ob-workspace-mark-tile grid shrink-0 place-items-center rounded-[24px] bg-accent text-accent-ink",
        compact && "ob-workspace-mark-tile-compact rounded-[15px]",
      )}
      aria-hidden="true"
    >
      <GitBranch size={compact ? 22 : 34} strokeWidth={2.35} />
    </span>
  );
  if (!name) return tile;

  const content = (
    <>
      {tile}
      <span className="ob-workspace-mark-copy min-w-0">
        <span className="ob-workspace-mark-name truncate">{name}</span>
        {tagline && (
          <span className="ob-workspace-mark-tagline ob-workspace-mark-tagline-full truncate">
            {tagline}
          </span>
        )}
        {compactTagline && (
          <span className="ob-workspace-mark-tagline ob-workspace-mark-tagline-compact truncate">
            {compactTagline}
          </span>
        )}
      </span>
    </>
  );

  return (
    <Link
      href={href}
      className={cn(
        "ob-workspace-mark flex min-w-0 items-center gap-6",
        compact && "ob-workspace-mark-compact gap-3",
        compactTagline && "ob-workspace-mark-has-compact-tagline",
        className,
      )}
    >
      {content}
    </Link>
  );
}
