const COMPLEX_TABLE_HINT = /\\(?:multicolumn|multirow|cline|cmidrule)\b/;

/** Keep one conservative complexity rule for editors, previews, and agents. */
export function isComplexTableSource(source: string, environment = "tabular"): boolean {
  if (environment === "tabular*" || environment === "tabularx" || environment === "longtable") return true;
  return COMPLEX_TABLE_HINT.test(source);
}
