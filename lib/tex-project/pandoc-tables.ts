/**
 * Server-only Pandoc HTML fragments for tables the interactive HAST renderer
 * cannot faithfully display. Do not import this module from client code.
 */

import { convertWithPandoc } from "./pandoc";
import { inlineBundleIncludes } from "./source-bundle-format";
import { extractComplexTableFragments } from "./table-fragments";

const MAX_TABLES = 8;

export async function convertComplexTables(input: {
  source: string;
  cwd: string;
  macros?: string;
}): Promise<Record<string, string>> {
  const source = inlineBundleIncludes(input.source);
  const fragments = extractComplexTableFragments(source).slice(0, MAX_TABLES);
  const tables: Record<string, string> = {};
  for (const fragment of fragments) {
    const artifact = await convertWithPandoc({
      source: fragment.source,
      cwd: input.cwd,
      macros: input.macros,
    });
    const html = artifact.output.trim();
    if (!html) continue;
    tables[fragment.key] = html;
  }
  return tables;
}
