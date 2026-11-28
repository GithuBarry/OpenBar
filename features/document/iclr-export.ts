import { zipSync, strToU8 } from "fflate";
import { parse } from "yaml";
import { cleanMarkdownExport, frontMatterEnd } from "@/lib/markdown-manuscript";
import { readProjectFilesAction } from "@/app/actions";

export function downloadFile(name: string, data: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Export only one submission's allowed files, never the project directory. */
export async function exportIclrPost(project: string, file: string, source: string) {
  const slug = /^_posts\/(2027-04-30-[a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(file)?.[1];
  if (!slug) throw new Error("ICLR export expects _posts/2027-04-30-your-title.md.");
  const header = source.slice(0, frontMatterEnd(source)).trim().split(/\r?\n/).slice(1, -1).join("\n");
  const meta = parse(header);
  if (meta?.layout !== "distill" || !meta.title || !meta.description || !Array.isArray(meta.toc) || !meta.toc.length)
    throw new Error("The ICLR review bundle needs Distill front matter with a title, abstract, and table of contents.");
  if (!Array.isArray(meta.authors) || !meta.authors.length || meta.authors.some((a: { name?: string }) => a?.name !== "Anonymous" || Object.keys(a).some(k => k !== "name")))
    throw new Error("For review, set authors to Anonymous and remove affiliations and profile links.");
  if (meta.bibliography && meta.bibliography !== `${slug}.bib`) throw new Error(`Use bibliography: ${slug}.bib for this post.`);
  const files: Record<string, Uint8Array> = { [file]: strToU8(cleanMarkdownExport(source)) };
  const allowed = [`assets/img/${slug}`, `assets/html/${slug}`];
  const bib = `assets/bibliography/${slug}.bib`;
  let total = files[file]!.length;
  const visited = new Set<string>();
  async function visit(dir: string) {
    if (visited.has(dir)) return;
    visited.add(dir);
    const r = await readProjectFilesAction(project, { paths: [dir], limit: 2000 });
    if (!r.ok || r.value.hasMore) throw new Error(r.ok ? "Too many assets to export." : r.message);
    for (const e of r.value.entries) {
      if ((e.path.slice(0, e.path.lastIndexOf("/") + 1) || "./") !== `${dir}/`) continue;
      if (!(e.path === bib || allowed.some(p => p.startsWith(e.path + "/") || p === e.path || e.path.startsWith(p + "/")) || bib.startsWith(e.path + "/"))) continue;
      if (e.kind === "directory") { await visit(e.path); continue; }
      if (e.path !== bib && !allowed.some(p => e.path.startsWith(p + "/"))) continue;
      if ((e.bytes ?? 0) > 20_000_000 || total + (e.bytes ?? 0) > 100_000_000) throw new Error("Export large asset collections from your checkout.");
      // Binary chunks always reconstruct the original bytes (including BOM).
      const parts: Uint8Array[] = [];
      let offset = 0, hash = "";
      for (;;) {
        const read = await readProjectFilesAction(project, { paths: [e.path], maxBytes: 1_000_000, offset });
        if (!read.ok) throw new Error(read.message);
        const entry = read.value.entries[0];
        if (!entry || entry.path !== e.path || !entry.hash || (hash && hash !== entry.hash)) throw new Error(`Asset changed during export: ${e.path}`);
        hash = entry.hash;
        const bytes = entry.encoding === "base64" ? Uint8Array.from(atob(entry.content!), c => c.charCodeAt(0)) : strToU8(entry.content!);
        parts.push(bytes); offset += bytes.length;
        if (!entry.truncated) break;
        if (!bytes.length || offset > 20_000_000) throw new Error(`Could not export ${e.path}.`);
      }
      total += offset;
      const data = new Uint8Array(offset);
      let pos = 0; for (const part of parts) { data.set(part, pos); pos += part.length; }
      files[e.path] = data;
    }
  }
  await visit(".");
  if (meta.bibliography && !files[bib]) throw new Error(`Missing bibliography: ${bib}.`);
  downloadFile(`${slug}.zip`, zipSync(files, { level: 0 }), "application/zip");
}
