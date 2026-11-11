# OpenBar UI task checklist

Active task, 2026-09-08. Items are completed sequentially and verified in the running app.

- [x] Replace expanding extended notes with floating windows.
- [x] Persist agent-created cards as drafts until explicit human Save or Delete. Use compact, muted upper-right controls.
- [x] Make New card an empty-state placeholder.
- [x] Align Node.js requirements and container runtime with 26.8.1.
- [x] Describe visible, collapsed notes, and hover fields directly in native tool schemas.
- [x] Finish the universal floating conflict design in Paper and Mindmap, using #ffb000, hover menus, change details, Copy error for agent, stable status checks, and edit locks.
- [x] Verify inspector opening/collapse animations, reopening after blank-canvas deselection, and the slightly wider rendered-document right margin.
- [x] Fix PDF rendering's readableStream compatibility error.
- [x] Benchmark and apply focused large-mindmap performance improvements and zoomed-text clarity.
- [x] Fix the TODO search icon/placeholder overlap.
- [x] Use Git consistently throughout visible synchronization and setup text.
- [x] Add frequent automatic Git checks and safe automatic pulls.
- [x] Soft-wrap Markdown table cells and minimize spare width while preserving full-width height.
- [x] Move Markdown bullets farther inside cards and accent the Agent draft label.
- [x] Add a saved map font-size slider and match Paper Appearance with pixel-size sliders.
- [x] Run final domain, type, build, and browser checks.

Verification: domain invariants, TypeScript, production build, agent writes and transport, card draft and image checks passed. Live browser checks covered draft Save/Delete, floating notes and conflicts, phone layout, inspector behavior, safe automatic Git pulls, PDF streaming, Markdown tables, and font-size persistence. A 501-card map kept its card geometry through zoom changes and measured a 16.8 ms 95th-percentile frame interval while panning at Retina resolution. Browser artifacts stay under `output/card-review-2026-09-08/` locally.
