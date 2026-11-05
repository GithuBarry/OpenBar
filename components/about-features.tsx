import { BookOpenText, Bot, FileText, Network } from "lucide-react";

export const ABOUT_FEATURES = [
  {
    icon: FileText,
    title: "Write across TeX files",
    body: "Edit connected TeX files in one workspace. Read the PDF, inspect citations, and keep comments beside the relevant prose.",
  },
  {
    icon: BookOpenText,
    title: "Keep research in Git",
    body: "Store the paper, maps, notes, and instructions in ordinary repository files. Review incoming changes, resolve conflicts, and sync your work.",
  },
  {
    icon: Network,
    title: "Plan with shared TODOs",
    body: "Use the same paper TODOs across multiple maps. Each map keeps its own layout, labels, and progress, with completion from TeX.",
  },
  {
    icon: Bot,
    title: "Work with agents",
    body: "Give agents project context and structured tools to read and edit the same paper, maps, and notes you use.",
  },
] as const;

export function AboutFeatureGrid() {
  return (
    <div className="mx-auto grid max-w-6xl gap-y-7 px-6 sm:grid-cols-2 sm:gap-x-16">
      {ABOUT_FEATURES.map(({ icon: Icon, title, body }) => (
        <article key={title}>
          <Icon size={18} className="text-accent" />
          <h2 className="mt-2 text-base font-semibold">{title}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted">{body}</p>
        </article>
      ))}
    </div>
  );
}
