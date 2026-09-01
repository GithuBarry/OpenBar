"use client";

import { Moon, Sun, BookOpen } from "lucide-react";
import { useTheme } from "@/components/theme";
import { cn } from "@/lib/utils";

/** Cycles light → dark → paper. Icon reflects the current theme. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, cycle } = useTheme();
  const Icon = theme === "dark" ? Moon : theme === "paper" ? BookOpen : Sun;
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${theme} (click to cycle)`}
      title={`Theme: ${theme} (click to cycle)`}
      className={cn(
        "ob-press grid h-7 w-7 place-items-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-ink",
        className,
      )}
    >
      <Icon size={15} />
    </button>
  );
}
