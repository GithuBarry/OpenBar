# OpenBar UI follow-ups

Completed in the active UI task on 2026-09-08.

- The TODO search input has 28px left padding, leaving an 8px gap after the icon.
- Paper and Mindmap check Git every 5 seconds after the previous check finishes. A clean checkout with zero outgoing commits can pull automatically while the editor is saved and idle. Open card drafts, focused editing fields, uploads, local save failures, review dialogs, and uncommitted files defer automatic pulls.
- Background checks preserve the floating notice, pause while the page is hidden, and use exponential backoff up to 60 seconds after remote errors. The shared review remains available for divergent histories.

Browser evidence: `output/card-review-2026-09-08/automatic-git-checks.json` and `hidden-git-checks.json`.
