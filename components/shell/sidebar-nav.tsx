"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenText,
  FileText,
  LayoutDashboard,
  LucideIcon,
  Network,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type NavIconKey = "overview" | "mindmap" | "drafts" | "notes";

const ICONS: Record<NavIconKey, LucideIcon> = {
  overview: LayoutDashboard,
  mindmap: Network,
  drafts: FileText,
  notes: BookOpenText,
};

export interface NavItem {
  href: string;
  label: string;
  icon: NavIconKey;
  exact?: boolean;
  group?: "primary" | "more";
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  if (items.length === 0) {
    return (
      <nav className="flex-1 px-3 py-2 text-sm text-faint">
        Select a project to begin.
      </nav>
    );
  }
  const primary = items.filter((item) => item.group !== "more");
  const more = items.filter((item) => item.group === "more");
  const renderItems = (list: NavItem[]) => (
    <ul className="space-y-0.5">
      {list.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = ICONS[item.icon];
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                active
                  ? "bg-accent-soft font-medium text-accent"
                  : "text-muted hover:bg-surface-3 hover:text-ink",
              )}
            >
              <Icon size={16} className="shrink-0" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-1">
      {renderItems(primary)}
      {more.length > 0 && (
        <div className="mt-4">
          <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">More</p>
          {renderItems(more)}
        </div>
      )}
    </nav>
  );
}
