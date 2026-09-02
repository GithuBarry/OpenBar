# Task 7 report: zero-caller compatibility cleanup

## Scope

The cleanup used repository-wide caller searches for every candidate named in
the brief, followed by export scans for the listed helper modules. Deletions
were limited to symbols with zero callers in the current working tree. Current
paper storage, TODO ownership, marker parsing, mindmap records, browser tools,
and UI behavior remain unchanged.

Runtime cleanup in the isolated commit covers:

- `app/actions.ts`
- `lib/html-policy.ts`
- `lib/marker-codec.ts`
- `lib/mindmap/layout.ts`
- `lib/store.ts`
- `lib/tex-project/document-body.ts`
- `lib/tex-project/obmd.ts`
- `lib/tex-project/tex-ast.ts`
- `lib/tex-project/tex-hast.ts`

The runtime patch removes 531 lines and adds 13 lines. The additions make
formerly exported zero-caller types private and update one module comment.

## Named caller scan

| Candidate | Caller result | Decision |
|---|---:|---|
| `patchPaperSectionAction` | declaration only | deleted |
| `patchPaperSectionsAction` | declaration only | deleted |
| `renameMindmapAction` | declaration only | deleted |
| `readAgentsMdAction` | declaration only | deleted |
| `readWorkspaceAgentsMdAction` | declaration only | deleted |
| `toMindmapRecord` | declaration only in an untracked replacement module | parked from the isolated commit |
| `fromMindmapRecord` | declaration only in an untracked replacement module | parked from the isolated commit |
| `preprocessMarkers` | declaration only | deleted |
| `reconcileProjectTodos` | declaration only inside a pre-existing broad rewrite | parked from the isolated commit |
| `connectedParentPath` | declaration only | deleted |
| `buildProjectWebMcpTools` | one temporary-test caller | retained through Task 8 |

Raw final named-symbol search:

```text
### patchPaperSectionAction
### patchPaperSectionsAction
### renameMindmapAction
### readAgentsMdAction
### readWorkspaceAgentsMdAction
### toMindmapRecord
### fromMindmapRecord
### preprocessMarkers
### reconcileProjectTodos
### connectedParentPath
### buildProjectWebMcpTools
./lib/research/webmcp-shared-contract.ts:135:export const buildProjectWebMcpTools = buildSharedWebMcpTools;
./test/.tmp-webmcp-only.test.ts:7:import { buildProjectWebMcpTools, buildSharedWebMcpTools } from "../lib/research/webmcp-shared-contract";
./test/.tmp-webmcp-only.test.ts:57:  const tools = buildProjectWebMcpTools({
```

## Exported helper review

The scan covered `lib/html-policy.ts`, `lib/store.ts`,
`lib/tex-project/document-body.ts`, `lib/tex-project/obmd.ts`,
`lib/tex-project/tex-hast.ts`, and `lib/tex-project/tex-ast.ts`.

Confirmed zero-caller helpers removed from the isolated commit include the
legacy frame-policy helpers, async HTML sanitizer, content-diagnostic reader,
paper-section patch wrappers, draft writer, bibliography writer, wiki TeX
reader, TeX-to-Markdown preview pipeline, HAST conversion wrappers,
environment finder, and whole-document plain-text wrapper. Live readers,
writers, parsers, marker functions, paper services, and UI helpers remain.

## Parked candidates

- `buildProjectWebMcpTools` stays until Task 8 removes or updates its temporary
  contract check.
- `toMindmapRecord` and `fromMindmapRecord` are confirmed zero-caller code in
  the untracked `lib/mindmap/mindmap.ts` replacement. Their working-tree
  deletion remains outside this commit so the whole untracked module is not
  absorbed into Task 7.
- `reconcileProjectTodos` is confirmed zero-caller code inside a pre-existing
  broad rewrite of `lib/mindmap-derive.ts`. Its working-tree deletion remains
  outside this commit so unrelated changes stay separate.
- `listDrafts`, `getDraft`, and `getPaperSource` remain parked in the isolated
  commit because committed code still contains an older caller whose removal
  belongs to pre-existing work.
- The `dompurify` package entry has no runtime caller after removal of the dead
  async sanitizer. Package files fall outside the Task 7 file set and remain
  for a later package cleanup.

## Verification

Typecheck:

```text
$ tsc --noEmit
```

Domain checks:

```text
$ tsx scripts/check-research-invariants.ts
ok  reconcileTodos identity holds on the primary fixture
ok  Unplaced is TeX ids minus primary bound ids
ok  branch TODO count is 1/2
ok  draft map is primary
ok  primary coverage ignores secondary bindings
ok  one todoId per map: duplicate binding is a warning
ok  same todoId on two maps is OK
ok  analyzePaper keeps \obcomment[id=…]
ok  comment ids surface on project state
ok  artifactHref(paper-comment) is /paper#c-dense
ok  paper-comment href uses the comment id
ok  search labels: section hits keep the heading title
ok  search labels: TODO hits use the todo id and text
ok  search labels: comment hit has a title
ok  table cell patch via patchTabularCell does not flatten neighbor cells
ok  lintBrokenTex flags unclosed \textsc and glued \maketitle
ok  lintBrokenTex is quiet on balanced preamble

Domain checks passed.
```

Frontend smoke:

```text
$ tsx scripts/smoke-frontend.ts
Frontend smoke ok: 4 routes × 2 themes + health/assets at http://127.0.0.1:3010
```

The first smoke attempt found no listener on port 3010. Starting the existing
development server restored the expected endpoint, and the full smoke check
then passed.

## Fix round after review of `44be342`

The review compared the cleanup commit with parent `027074b` and found five
deleted public exports with active parent callers. The combined working tree
also removed or rewrote those callers, which hid the isolated commit failure.

The smallest repair restores the exact parent contracts:

- `HtmlMode`
- `htmlFrameSandbox`
- `htmlFrameCsp`
- `htmlFrameCapabilities`
- `getWikiTex`

`getWikiTex` continues to use the existing `readDocumentTex` helper. No caller,
storage, WebMCP, paper, TODO, or mindmap behavior changed in this fix round.

Temporary regression check before the repair:

```text
✖ reviewed HTML frame and wiki contracts remain callable
TypeError: (0 , import_html_policy.htmlFrameSandbox) is not a function
ℹ pass 0
ℹ fail 1
```

The same check after the repair:

```text
✔ reviewed HTML frame and wiki contracts remain callable
ℹ pass 1
ℹ fail 0
```

The temporary regression file was removed after the green run.

Fresh verification:

```text
$ tsc --noEmit
```

```text
$ tsx scripts/check-research-invariants.ts
ok  reconcileTodos identity holds on the primary fixture
ok  Unplaced is TeX ids minus primary bound ids
ok  branch TODO count is 1/2
ok  draft map is primary
ok  primary coverage ignores secondary bindings
ok  one todoId per map: duplicate binding is a warning
ok  same todoId on two maps is OK
ok  analyzePaper keeps \obcomment[id=…]
ok  comment ids surface on project state
ok  artifactHref(paper-comment) is /paper#c-dense
ok  paper-comment href uses the comment id
ok  search labels: section hits keep the heading title
ok  search labels: TODO hits use the todo id and text
ok  search labels: comment hit has a title
ok  table cell patch via patchTabularCell does not flatten neighbor cells
ok  lintBrokenTex flags unclosed \textsc and glued \maketitle
ok  lintBrokenTex is quiet on balanced preamble

Domain checks passed.
```

```text
$ tsx scripts/smoke-frontend.ts
Frontend smoke ok: 4 routes × 2 themes + health/assets at http://127.0.0.1:3010
```
