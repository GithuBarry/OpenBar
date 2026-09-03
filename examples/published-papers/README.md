# Published paper fixtures

This directory contains the two published-paper projects selected for the
private Cloudflare demo:

- `command-v` — Command-V, ICLR 2026
- `noveltybench` — NoveltyBench, COLM 2025

The files are copied from the corresponding projects in the local content
store. They retain the real TeX source, figures, maps, paper annotations,
project instructions, and optional wiki and skill files. The running demo
copies each project into its writable content directory before serving it.

The private demo allowlist is `command-v,noveltybench`. Other workspace
projects stay outside the container image and are unavailable in demo mode.
