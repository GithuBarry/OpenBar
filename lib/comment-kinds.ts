/** Comment vocabulary stays project-defined. These are convenient starting points. */
export const DEFAULT_COMMENT_KINDS = [
  { value: "", label: "Comment", tone: "slate" },
  { value: "question", label: "Question", tone: "blue" },
  { value: "claim", label: "Claim", tone: "violet" },
  { value: "hypothesis", label: "Hypothesis", tone: "amber" },
  { value: "reviewer", label: "Reviewer", tone: "rose" },
] as const;

export function commentKindAppearance(kind = ""): { label: string; tone: string } {
  const value = kind.trim();
  const normalized = value.toLowerCase();
  const preset = DEFAULT_COMMENT_KINDS.find((item) => item.value === normalized);
  if (preset) return preset;
  const tones = ["teal", "blue", "violet", "amber", "rose"];
  let hash = 0;
  for (const char of normalized) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return { label: value, tone: tones[hash % tones.length] };
}
