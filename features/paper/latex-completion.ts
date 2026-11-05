import type { CompletionContext } from "@codemirror/autocomplete";
import { findMacroMatches } from "@/lib/marker-codec";
import { splitBundleSource } from "@/lib/tex-project/source-bundle-format";

export type PaperCompletionContext = { source: string; citationKeys: string[] };

/** Project-specific names complement the external LaTeX command/environment engine. */
export function projectCompletions(read: () => PaperCompletionContext) {
  return (context: CompletionContext) => {
    const match = context.matchBefore(/\\(?:cite[a-z]*|autocite|parencite|textcite|ref|eqref|autoref|cref|Cref|input|include)\*?(?:\[[^\]]*\])?\{[^}]*$/);
    if (!match) return null;
    const { source, citationKeys } = read();
    const command = /^\\([a-zA-Z]+)/.exec(match.text)?.[1] || "";
    const suffix = /[^,{]*$/.exec(match.text)![0];
    const names = command === "input" || command === "include"
      ? splitBundleSource(source).map(part => part.filePath.replace(/\.tex$/, ""))
      : /cite/.test(command) ? citationKeys : findMacroMatches(source, ["label"]).map(label => label.body.trim());
    return { from: context.pos - suffix.length, options: [...new Set(names)].map(label => ({ label, type: "reference" })), validFor: /^[\w:./-]*$/ };
  };
}
