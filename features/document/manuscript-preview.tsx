import type { Components } from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { Root, RootContent } from "mdast";
import { markdownAnchorMatch } from "@/lib/markdown-manuscript";
import { MarkdownDocument } from "./markdown-document";
import { InlineInfoNote } from "@/components/inline-info-note";

/** Recognize OpenBar metadata before React Markdown escapes raw HTML.
 * The official template, not the editor, executes Liquid and Distill widgets. */
function remarkManuscriptAnchors() {
  function visit(parent: Root | Extract<RootContent, { children: unknown }>) {
    for (const node of parent.children) {
      if (node.type === "html") {
        const match = markdownAnchorMatch(node.value);
        if (match) Object.assign(node, { type: "text", value: "", data: { hName: "span", hProperties: { "data-note-id": match[2] } } });
      } else if ("children" in node) visit(node);
    }
  }
  return (tree: Root) => visit(tree);
}

export function ManuscriptPreview({ source, project, file, note }: {
  source: string; project: string; file: string; note: (id: string) => { label: string; open: () => void } | undefined;
}) {
  const components: Components = {
    span: ({ node, children, ...props }) => {
      const info = node?.properties?.dataInlineInfo ?? node?.properties?.["data-inline-info"];
      if (typeof info === "string") return <InlineInfoNote label={info}>{children}</InlineInfoNote>;
      const id = node?.properties?.["data-note-id"] ?? node?.properties?.dataNoteId;
      if (typeof id !== "string") return <span {...props}>{children}</span>;
      const n = note(id);
      return <button type="button" className="mx-1 rounded px-1 align-super text-xs text-accent" title={n?.label ?? id} onClick={n?.open}>◦</button>;
    },
    img: ({ src, alt, title }) => {
      if (typeof src !== "string" || !src) return null;
      const relative = src.startsWith("assets/") ? src : file.replace(/[^/]+$/, "") + src;
      const url = /^(https?:|\/)/i.test(src) ? src : `/api/p/${encodeURIComponent(project)}/asset/${relative.split("/").map(encodeURIComponent).join("/")}`;
      return <img loading="lazy" src={url} alt={alt ?? ""} title={title} />;
    },
  };
  return <MarkdownDocument source={source} remarkPlugins={[[remarkMath, { singleDollarTextMath: false }], remarkManuscriptAnchors]}
    rehypePlugins={[[rehypeKatex, { trust: false }]]} components={components} />;
}
