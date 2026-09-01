export const LLM_WIKI_PROTOCOL = `# OpenBar LLM Wiki Protocol

OpenBar follows the Karpathy LLM Wiki pattern: raw sources stay authoritative, and agents maintain an interlinked Markdown wiki that compiles knowledge once and keeps it current.

Source: Andrej Karpathy, "LLM Wiki", https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

## Why this exists

Karpathy's point is that retrieval from raw chunks makes the agent rebuild knowledge each time. The LLM Wiki pattern creates a compounding artifact: agents read new sources, update existing Markdown pages, maintain cross-links, record contradictions, update \`index.md\`, append \`log.md\`, and periodically lint the wiki. The human curates sources and asks strategic questions. The agent handles filing, linking, and upkeep.

For OpenBar, the research team provides source access and strategic direction. Agents read source tables, experiment logs, manuscript prose, and shared notes, then create source refs with hashes or anchors and update the project wiki and claim gates from them.

## Required Agent Behavior

1. Load \`source_grounding\` before changing research workflow.
2. Load \`project_context\` before project work.
3. Use \`source_manifest\` to find primary sources.
4. Record new primary sources with \`record_source_ref\`.
5. Use \`ingest_source_note\` after inspecting a source.
6. Update existing pages before creating new pages.
7. Keep source refs attached to wiki pages.
8. Put contradictions and stale claims directly into the affected page.
9. Update \`wiki/index\` and \`wiki/log\` through source ingestion.
10. Use \`upsert_wiki_page\` only for deliberate page replacement or repair.

## Page Types

These are common pages, not a closed schema. Create the pages that fit the project and its sources.

- \`overview\`: project why, central question, current state, advisor ask.
- \`central-claim\`: main claim, scope, belief state, strongest objection.
- \`artifact-map\`: primary source refs, run folders, experiment dashboards, manuscript files, and shared documents.
- \`method\`: protocol, implementation constraints, hidden defaults, leakage risks.
- \`evidence\`: result summaries linked to raw artifacts and limitations.
- \`failure-modes\`: concrete failures, stale assumptions, contradictions.
- \`advisor-brief\`: concise meeting packet and questions for collaborators, advisors, or reviewers.
- \`index\`: generated map of pages and source refs.
- \`log\`: chronological source ingestion log.

## Link Style

Use simple wiki links in Markdown text:

- \`[[central-claim]]\`
- \`[[artifact-map]]\`
- \`[[failure-modes]]\`

Use source ids when grounding statements:

- \`source: project-readme\`
- \`source: experiment-table\`
- \`source: gpu-run-YYYY-MM-DD\`

## Source Ref Rule

A source ref is a pointer, not a copy. It may contain:

- primary URI or local path
- hash if available
- selected excerpt
- anchors such as line ranges, table ids, W&B artifact versions, commit path/ranges
- linked wiki pages
- linked claim ids

## Stale Claim Rule

When a new source weakens or narrows old knowledge, edit the page with a visible block:

\`\`\`md
### Contradiction or stale claim
- Old belief:
- New source:
- Current belief:
- Evidence still needed:
\`\`\`

## Minimal Human Work

The research team should provide or approve sources and answer strategic why-questions. Agents should fill links, previews, hashes, wiki updates, and source-grounded summaries from the artifacts.
`;
