# Markdown manuscripts

In a private project, open **Markdown** in the project sidebar. Enter a project-relative `.md` path or select an existing post. **Save** writes the source, not the rendered HTML. **File → Use as primary manuscript** makes the Paper tab open that file. Switch back under **File**; switching does not convert or delete either file.

The editor uses CodeMirror’s Markdown language, search and undo. OpenBar preserves front matter, unrecognized template syntax and untouched line endings. Unsaved edits are recoverable in the browser. A stale file hash prevents a browser or agent from overwriting a newer save. Use **Refresh from disk** after an external change. If both copies changed, download the local draft before discarding it.

## Annotating a passage

Put the cursor beside a passage, open **Annotations**, enter the note, then choose **Add TODO** or **Add comment**. The post stores only `<!--ob:todo:ID-->` or `<!--ob:comment:ID-->`. Copy the ID with a moved passage; do not reuse it at two locations. The preview marker opens the annotations. Click a note to edit it. Complete or reopen TODOs here or on a bound map card.

Private records live once in `openbar-blog-notes.tex`, included from the project's TeX root on first annotation. Adding the anchor, record, and first include is one hash-checked transaction. This keeps existing Primary Unplaced, secondary-map bindings, inbox receipts, and completion semantics. No second copy of the article is generated. Removing an anchor does not delete a research record.

Agents read `project.markdownFile` in `get_project_state`, then use `read_project_files` / `apply_project_edits` with the returned file hash. Keep existing anchor comments attached to the relevant prose. The browser's `get_paper_state` describes the open Markdown draft. Use the annotation file hash for record edits, not the post hash. Git sync uses the existing project repository.

## Publishing

**Download publication Markdown** strips annotation IDs without serializing the document. For the [ICLR 2027 track](https://iclr-blogposts.github.io/2027/submitting/), open `_posts/2027-04-30-your-title.md`. **Download ICLR submission ZIP** includes that post, the matching bibliography and the post’s image/widget directories. It checks basic review front matter; authors still review the actual text and assets for anonymity.

The editor preview supports Markdown tables, links, images and `$$` math. Arbitrary Liquid, Distill citations/layout and interactive HTML widgets belong to the conference’s Jekyll renderer. Extract the ZIP into your fork, build with the official template, and check its preview before submitting the PR and OpenReview entry. Keep the OpenBar workspace and its Git history separate from that submission checkout.
