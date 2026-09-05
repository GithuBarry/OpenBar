import type { ArtifactRef } from "@/lib/types";

function isImage(ref: ArtifactRef): boolean {
  return ref.kind === "figure";
}

export function attachMindmapImage(refs: ArtifactRef[], ref: ArtifactRef): ArtifactRef[] {
  if (!isImage(ref)) throw new Error("Mindmap image references must use the figure artifact kind.");
  const index = refs.findIndex((item) => item.kind === ref.kind && item.id === ref.id);
  if (index < 0) return [...refs, ref];
  return refs.map((item, itemIndex) => itemIndex === index ? { ...item, ...ref } : item);
}

export function detachMindmapImage(refs: ArtifactRef[], id: string): ArtifactRef[] {
  return refs.filter((ref) => !(isImage(ref) && ref.id === id));
}

export function reorderMindmapImage(refs: ArtifactRef[], id: string, targetIndex: number): ArtifactRef[] {
  const imageRefs = refs.filter(isImage);
  const currentIndex = imageRefs.findIndex((ref) => ref.id === id);
  if (currentIndex < 0) return refs;
  const nextIndex = Math.max(0, Math.min(imageRefs.length - 1, Math.trunc(targetIndex)));
  const [moved] = imageRefs.splice(currentIndex, 1);
  imageRefs.splice(nextIndex, 0, moved!);
  let cursor = 0;
  return refs.map((ref) => isImage(ref) ? imageRefs[cursor++]! : ref);
}

export function captionMindmapImage(refs: ArtifactRef[], id: string, label: string): ArtifactRef[] {
  return refs.map((ref) => ref.kind === "figure" && ref.id === id
    ? { ...ref, ...(label.trim() ? { label: label.trim() } : { label: undefined }) }
    : ref);
}
