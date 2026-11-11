import fs from "node:fs";

import type { BibEntry, BibliographyImportResult } from "@/lib/bibtex";
import { parseBibtexCitationJs } from "@/lib/citation";
import { sha256, writeTextAtomic } from "@/lib/tex-project/codec";
import { bibliographyInputWrites, bibliographySourceFiles, parseBibliography, readBibliographyRaw, writeBibliographyRaw } from "@/lib/tex-project/project";
import { failResult, okResult, type OperationResult } from "./operation-result";
import { withProjectWriteLock } from "./project-lock";

/** Citation.js stays on the server while the browser receives a small preview. */
export function previewBibtexImport(raw: string, bibtex: string): OperationResult<BibEntry[]> {
  if (typeof bibtex !== "string" || !bibtex.trim()) return failResult("invalid_arguments", "Paste the BibTeX copied from Google Scholar or another reference source.");
  if (bibtex.length > 200_000) return failResult("invalid_arguments", "Import up to 200,000 characters of BibTeX at a time.");
  const entries = parseBibtexCitationJs(bibtex);
  if (!entries?.length) return failResult("invalid_arguments", "Check the BibTeX entry, including its @type, citation key, and closing braces.");
  const existing = raw.trim() ? parseBibtexCitationJs(raw) : [];
  if (!existing) return failResult("invalid_arguments", "Repair the existing bibliography's BibTeX before adding references.");
  const seen = new Set(existing.map(entry => entry.key));
  for (const entry of entries) {
    if (!/^[^\s,{}\\%#$&^~]+$/.test(entry.key)) return failResult("invalid_arguments", `Use a citation key with letters, numbers, and ordinary punctuation for "${entry.key}".`);
    if (seen.has(entry.key)) return failResult("conflict", `Citation key "${entry.key}" already exists. Use its existing citation or give the pasted entry a new key.`);
    seen.add(entry.key);
  }
  return okResult(entries);
}

/** Append under the project lock so the hash and active writing lease fence writes. */
export function importBibtex(projectDir: string, bibtex: string, expectedHash: string): OperationResult<BibliographyImportResult> {
  return withProjectWriteLock(projectDir, () => {
    const raw = readBibliographyRaw(projectDir);
    const currentHash = sha256(raw);
    if (expectedHash !== currentHash) return failResult("stale_disk_state", "The bibliography changed. Read its latest entries and try adding the reference again.", { currentHash, retryable: true });
    const preview = previewBibtexImport(raw, bibtex);
    if (!preview.ok) return preview;
    const append = (previous: string) => `${previous}${previous ? (previous.endsWith("\n") ? "\n" : "\n\n") : ""}${bibtex.trim()}\n`;
    try { bibliographyInputWrites(projectDir, append(raw)); }
    catch (error) { return failResult("conflict", error instanceof Error ? error.message : "Prepare the bibliography's generated file before adding references."); }
    const declared = bibliographySourceFiles(projectDir);
    if (declared.length) {
      const target = declared[0]!;
      writeTextAtomic(target, append(fs.readFileSync(target, "utf8")));
      writeBibliographyRaw(projectDir, readBibliographyRaw(projectDir));
    } else {
      writeBibliographyRaw(projectDir, append(raw));
    }
    const saved = readBibliographyRaw(projectDir);
    return okResult({ raw: saved, entries: parseBibliography(saved), hash: sha256(saved), addedKeys: preview.value.map(entry => entry.key) });
  });
}
