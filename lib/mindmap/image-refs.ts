import type { ArtifactRef } from "@/lib/types";

function isImage(ref: ArtifactRef): boolean {
  return ref.kind === "figure";
}

export function attachMindmapImage(refs: ArtifactRef[], ref: ArtifactRef): ArtifactRef[] {
  if (!isImage(ref)) throw new Error("Mindmap image references must use the figure artifact kind.");
  const index = refs.findIndex((item) => item.kind === ref.kind && item.id === ref.id);
  if (index < 0 && refs.some(isImage)) throw new Error("Each card holds one image. Add a child card for another image.");
  if (index < 0) return [...refs, ref];
  return refs.map((item, itemIndex) => itemIndex === index ? { ...item, ...ref } : item);
}

export function detachMindmapImage(refs: ArtifactRef[], id: string): ArtifactRef[] {
  return refs.filter((ref) => !(isImage(ref) && ref.id === id));
}

export function captionMindmapImage(refs: ArtifactRef[], id: string, label: string): ArtifactRef[] {
  return refs.map((ref) => ref.kind === "figure" && ref.id === id
    ? { ...ref, ...(label.trim() ? { label } : { label: undefined }) }
    : ref);
}
