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
              aria-current={active ? "page" : undefined}
              className={cn(
                "p-sidebar-row transition-colors",
                active && "p-selected",
              )}
            >
              <span className="p-sidebar-icon"><Icon size={16} aria-hidden="true" /></span>
              <span className="ob-brand-font">{item.label}</span>
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
          <p className="p-sidebar-header">More</p>
          {renderItems(more)}
        </div>
      )}
    </nav>
  );
}
