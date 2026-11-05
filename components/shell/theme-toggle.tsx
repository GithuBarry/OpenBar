"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { useTheme } from "@/components/theme";
import { MenuSurface } from "@/components/pop";
import { cn } from "@/lib/utils";

const THEMES = [
  { value: "paper", label: "Paper", background: "#f6f6f5", foreground: "#25252a" },
  { value: "light", label: "Light", background: "#ffffff", foreground: "#5568d9" },
  { value: "dark", label: "Dark", background: "#20212a", foreground: "#e5e5ec" },
] as const;

function ThemeSwatch({ theme }: { theme: typeof THEMES[number] }) {
  return <span aria-hidden="true" className="inline-block h-4 w-4 shrink-0 rounded-full border border-current/20"
    style={{ background: `linear-gradient(135deg, ${theme.background} 50%, ${theme.foreground} 50%)` }} />;
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const current = THEMES.find(option => option.value === theme) || THEMES[0];
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button type="button" aria-label={`Color theme: ${current.label}`} className={cn(
        "ob-press inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-muted transition-colors hover:bg-surface-3 hover:text-ink",
        className,
      )}>
        <ThemeSwatch theme={current} />
        <span>Color</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
    </DropdownMenu.Trigger>
    <MenuSurface align="end" className="min-w-36 p-1">
      <DropdownMenu.Label className="px-2 py-1.5 text-[11px] font-semibold text-muted">Color theme</DropdownMenu.Label>
      <DropdownMenu.RadioGroup value={theme} onValueChange={value => {
        const selected = THEMES.find(option => option.value === value);
        if (selected) setTheme(selected.value);
      }}>
        {THEMES.map(option => <DropdownMenu.RadioItem key={option.value} value={option.value} className="ob-menu-item gap-2">
          <ThemeSwatch theme={option} />
          <span className="flex-1">{option.label}</span>
          <DropdownMenu.ItemIndicator><Check size={14} aria-hidden="true" /></DropdownMenu.ItemIndicator>
        </DropdownMenu.RadioItem>)}
      </DropdownMenu.RadioGroup>
    </MenuSurface>
  </DropdownMenu.Root>;
}
