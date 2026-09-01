/** Allow only http(s) URLs. Protocol-relative values are remote URLs. */
export function safeUrl(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const candidate = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
    const url = new URL(candidate);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return undefined;
  }
  return undefined;
}
