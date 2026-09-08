export const MAX_MINDMAP_CAPTION_WORDS = 500;
export const MAX_VISIBLE_MINDMAP_WORDS = 100;

export function mindmapWordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

export function visibleMindmapWordCount(title: string | undefined, text: string): number {
  return mindmapWordCount(`${title || ""} ${text}`);
}

export function captionWordCount(caption: string | undefined): number {
  return mindmapWordCount(caption || "");
}

export function captionWithinLimit(caption: string | undefined): boolean {
  return captionWordCount(caption) <= MAX_MINDMAP_CAPTION_WORDS;
}
