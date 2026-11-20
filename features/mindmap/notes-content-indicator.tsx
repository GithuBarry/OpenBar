import { hasNoteText } from "@/lib/mindmap/caution";

const CONTENT_THRESHOLDS = [128, 512, 2048, 4096];

export function notesContentDescription(text: string): string {
  const bars = CONTENT_THRESHOLDS.reduce((total, threshold) => total + Number(text.length > threshold), 0);
  return `${hasNoteText(text) ? "Has content" : "Empty"}, ${text.length} characters, ${bars} of 4 bars`;
}

export function NotesContentIndicator({ text, className }: { text: string; className?: string }) {
  if (!hasNoteText(text)) return null;
  return <svg className={className} width={15} height={12} viewBox="0 0 15 12" fill="currentColor" aria-hidden="true">
    {CONTENT_THRESHOLDS.map((threshold, index) => <rect key={threshold} x={index * 4} y={9 - index * 3} width={2.5} height={3 + index * 3} rx={0.7} opacity={text.length > threshold ? 1 : 0.2} />)}
  </svg>;
}
