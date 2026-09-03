import { BookOpenText, Bot, FileText, Network } from "lucide-react";

export const ABOUT_FEATURES = [
  {
    icon: FileText,
    title: "One living manuscript",
    body: "Edit the real TeX include graph in one continuous workspace. TODOs and comments stay next to the relevant prose.",
  },
  {
    icon: BookOpenText,
    title: "Research state in the repository",
    body: "Paper, annotations, mindmaps, and project skills live in ordinary files. Browser storage is only for personal layout preferences.",
  },
  {
    icon: Network,
    title: "A flexible research map",
    body: "Free-form topics can point at paper sections and shared TODOs. Descendant TODOs show progress from TeX completion, with Unplaced work waiting in the tray.",
  },
  {
    icon: Bot,
    title: "People and browser agents together",
    body: "A fresh agent calls get_project_state, navigates on its own, and edits through the same live paper the human is looking at.",
  },
] as const;

export function AboutFeatureGrid() {
  return (
    <div className="mx-auto grid max-w-6xl gap-px overflow-hidden sm:grid-cols-2">
      {ABOUT_FEATURES.map(({ icon: Icon, title, body }) => (
        <article key={title} className="border-line bg-canvas/50 p-6 sm:border-r [&:nth-child(2n)]:border-r-0">
          <Icon size={18} className="text-accent" />
          <h2 className="mt-4 text-base font-semibold">{title}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted">{body}</p>
        </article>
      ))}
    </div>
  );
}
