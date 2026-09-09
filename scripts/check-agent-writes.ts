import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbar-agent-writes-"))
  process.env.OPENBARRY_CONTENT = root
  const { writeProjectRecord, writePaperProject, writeMindmapRecord } = await import("../lib/tex-project/project")
  const { analyzePaper } = await import("../lib/research/paper-analysis")
  const { executeMcpTool } = await import("../lib/research/mcp-command-registry")
  const project = "agent-fixture"
  const dir = path.join(root, "projects", project)
  fs.mkdirSync(dir, { recursive: true })
  const now = new Date().toISOString()
  writeProjectRecord(dir, { id: project, slug: project, title: "Fixture", tagline: "", overview: "", createdAt: now, updatedAt: now, links: [] })
  const paper = writePaperProject(dir, "Fixture", [{ id: "intro", title: "Introduction", order: 0, level: 1, label: "sec-intro", tex: String.raw`Text.
\begin{tabular}{ll}
Axis & Value \\
One & \obmarker{pending} \\
\end{tabular}
\obtodo[id=todo-one]{Work to do.}
` }])
  writeMindmapRecord(dir, { projectId: project, id: "draft", role: "draft", rootId: "root", title: "Fixture", nodes: [{ id: "root", parentId: null, text: "", title: "Root" }], updatedAt: now, revision: 0 })
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await executeMcpTool(name, { project, ...args }, { actor: "test" })
    assert(result.ok, JSON.stringify({ name, result }))
    return result.value as any
  }
  try {
    const readMap = () => call("get_mindmap", { mapId: "draft" })
    const mapWrite = async (name: string, args: Record<string, unknown>) => {
      const map = await readMap()
      return call(name, { mapId: "draft", expectedRevision: map.revision, expectedDiskHash: map.diskHash, ...args })
    }
    await mapWrite("place_todo_card", { todoId: "todo-one", parentId: "root" })
    await mapWrite("place_todo_card", { todoId: "todo-one", parentId: "root" })
    let map = await readMap()
    assert.equal(map.nodes.filter((node: any) => node.todoId === "todo-one").length, 1)
    await mapWrite("set_mindmap_collapsed", { id: "root", collapsed: true })
    assert.equal((await readMap()).nodes.find((node: any) => node.id === "root").collapsed, true)
    const image = await call("upload_figure", { filename: "fixture.png", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=" })
    await mapWrite("attach_mindmap_image", { id: "root", assetId: image.path, label: "First" })
    await mapWrite("caption_mindmap_image", { id: "root", assetId: image.path, label: "Updated" })
    const attached = await call("read_mindmap_image", { mapId: "draft", id: "root", assetId: image.path })
    assert.equal(attached.ref.label, "Updated")
    assert.match(attached.url, /fixture/)
    const imageRefs = (await readMap()).nodes.find((node: any) => node.id === "root").refs
    await mapWrite("patch_mindmap_node", { id: "root", refs: imageRefs.map((ref: any) => ({ ...ref, imageWidth: 55 })) })
    assert.equal((await call("read_mindmap_image", { mapId: "draft", id: "root", assetId: image.path })).ref.imageWidth, 55)
    const invalidMap = await readMap()
    const invalidResize = await executeMcpTool("patch_mindmap_node", { project, mapId: "draft", id: "root", expectedRevision: invalidMap.revision, refs: [{ kind: "figure", id: image.path, imageWidth: 101 }] }, { actor: "test" })
    assert.equal(invalidResize.ok, false)
    const secondImage = await executeMcpTool("patch_mindmap_node", { project, mapId: "draft", id: "root", expectedRevision: invalidMap.revision, refs: [{ kind: "figure", id: image.path }, { kind: "figure", id: "figures/other.png" }] }, { actor: "test" })
    assert.equal(secondImage.ok, false)
    await mapWrite("detach_mindmap_image", { id: "root", assetId: image.path })
    const section = (await call("read_paper_section", { sectionId: paper.sections[0]!.id })).section
    await call("patch_paper_table", { sectionId: paper.sections[0]!.id, baseHash: section.hash, tableIndex: 0, row: 1, column: 1, tex: "42" })
    const patched = (await call("read_paper_section", { sectionId: paper.sections[0]!.id })).section
    assert.match(patched.tex, /Axis & Value/)
    assert.match(patched.tex, /One & 42/)
    assert.match(patched.tex, /obtodo/)
    let bundle = await call("get_source_bundle")
    const todoRange = analyzePaper(bundle.source).todos.find(todo => todo.id === "todo-one")!
    assert.equal(bundle.source.slice(todoRange.start, todoRange.end), String.raw`\obtodo[id=todo-one]{Work to do.}`)
    await call("update_todo", { id: "todo-one", title: "Updated title", expectedBundleHash: bundle.bundleHash })
    bundle = await call("get_source_bundle")
    assert.match(bundle.source, /Updated title/)
    const dry = await call("remove_paper_todo", { todoId: "todo-one", expectedBundleHash: bundle.bundleHash, dryRun: true })
    assert.equal(dry.dryRun, true)
    assert.equal((await call("get_source_bundle")).bundleHash, bundle.bundleHash)
    await call("remove_paper_todo", { todoId: "todo-one", expectedBundleHash: bundle.bundleHash })
    assert.doesNotMatch((await call("get_source_bundle")).source, /todo-one/)
    await call("inspect_repository")
    await call("lint_paper")
    const preview = await call("preview_conversion", { filePath: "paper.tex", to: "html5" })
    assert.equal(typeof preview.output, "string")
    const conversion = await call("apply_conversion", { planId: preview.id, expectedHash: preview.sourceHash, acknowledgeLoss: true, dryRun: true })
    assert.equal(conversion.dryRun, true)
    console.log("Agent write checks passed: isolated TODO placement, duplicate prevention, map collapse, figure upload/attach/caption/read/detach, single-cell table preservation, TODO update, removal preview and apply, conversion preview and dry run.")
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}
void main()
