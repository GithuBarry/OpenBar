/**
 * Native Markdown document view. `%` is ordinary text, not a TeX comment.
 */

import { parseMarkdownBlocks } from "@/lib/markdown-lite";

function Inline({ text }: { text: string }) {
  return <>{text}</>;
}

export function MarkdownDocument({ source }: { source: string }) {
  const blocks = parseMarkdownBlocks(source);
  return (
    <article className="prose-ob max-w-3xl">
      <div className="mb-2 text-[11px] text-muted">Markdown · `%` is ordinary text</div>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Tag = (`h${Math.min(block.level, 4)}` as "h1" | "h2" | "h3" | "h4");
          return <Tag key={index} className="mt-4 font-semibold text-ink"><Inline text={block.text} /></Tag>;
        }
        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={index} className="my-2 list-inside pl-1 text-sm">
              {block.items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} /></li>)}
            </List>
          );
        }
        if (block.type === "code") {
          return <pre key={index} className="my-3 overflow-auto rounded-md border border-line bg-surface-2 p-3 text-xs">{block.text}</pre>;
        }
        return <p key={index} className="my-2 text-sm leading-relaxed text-ink"><Inline text={block.text} /></p>;
      })}
    </article>
  );
}
