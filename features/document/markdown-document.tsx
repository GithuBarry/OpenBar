import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { InlineInfoNote } from "@/components/inline-info-note";
import { remarkInlineInfoNotes } from "@/lib/mindmap/inline-info-notes";
import { remarkLineBreaks } from "@/lib/mindmap/markdown-breaks";
import styles from "./markdown-document.module.css";

const REMARK_PLUGINS = [remarkGfm, remarkLineBreaks, remarkInlineInfoNotes];
const COMPONENTS: Components = {
  span: ({ children, ...props }) => {
    const info = (props as Record<string, unknown>)["data-inline-info"];
    if (typeof info === "string" && info) return <InlineInfoNote label={info}>{children}</InlineInfoNote>;
    return <span {...props}>{children}</span>;
  },
};

export function MarkdownDocument({ source }: { source: string }) {
  return (
    <article className={`prose-ob max-w-3xl ${styles.document}`}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>{source}</ReactMarkdown>
    </article>
  );
}
