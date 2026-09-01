import { z } from "zod";

/** Open-ended claim tags. Not an evidence-quality enum. */
export const CLAIM_TAG_PATTERN = /^[a-z0-9][a-z0-9:_-]*$/i;
export const CLAIM_TAG_MAX = 64;

export const tagSchema = z
  .string()
  .min(1)
  .max(CLAIM_TAG_MAX)
  .regex(CLAIM_TAG_PATTERN);

export type ClaimTag = z.infer<typeof tagSchema>;

export function isClaimTag(value: string): boolean {
  return value.length >= 1 && value.length <= CLAIM_TAG_MAX && CLAIM_TAG_PATTERN.test(value);
}

/** Split a comma/whitespace tag list and validate each entry. */
export function parseClaimTags(raw: string | string[] | undefined | null): string[] {
  const parts = Array.isArray(raw)
    ? raw
    : (raw ?? "")
        .split(/[,\s]+/)
        .map((part) => part.trim())
        .filter(Boolean);
  return [...new Set(parts.map((part) => tagSchema.parse(part)))];
}
