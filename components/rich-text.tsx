import type { ReactNode } from "react";
import katex from "katex";
import remarkGfm from "remark-gfm";
import styles from "./rich-text.module.css";
import ReactMarkdown from "react-markdown";
import { texClosingBrace } from "@/lib/mindmap/text-formatting";
import { safeUrl } from "@/lib/safe-url";

function highlightedMentions(text: string): ReactNode {
  return text.split(/(?<![\w@])(@agents?)(?![\w])/gi).map((part, index) =>
    /^@agents?$/i.test(part) ? <mark key={index} className={styles.agentMention}>{part}</mark> : part,
  );
}

type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[]; data?: unknown };
function remarkAgentMentions() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || node.type === "link" || node.type === "linkReference") return;
      node.children = node.children.flatMap((child): MarkdownNode[] => {
        if (child.type !== "text" || !child.value) { visit(child); return [child]; }
        return child.value.split(/(?<![\w@])(@agents?)(?![\w])/gi).filter(Boolean).map((part) =>
          /^@agents?$/i.test(part)
            ? { type: "agentMention", data: { hName: "mark", hProperties: { className: styles.agentMention } }, children: [{ type: "text", value: part }] }
            : { type: "text", value: part },
        );
      });
    };
    visit(tree);
  };
}

function linkedPlainText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /https?:\/\/[^\s<>]+/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(highlightedMentions(text.slice(cursor, match.index)));
    const raw = match[0];
    const trailing = raw.match(/[.,;:!?\]\)}]+$/)?.[0] || "";
    const href = raw.slice(0, raw.length - trailing.length);
    const target = safeUrl(href);
    nodes.push(target
      ? <a key={`${keyPrefix}-${match.index}`} href={target} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{href}</a>
      : href);
    if (trailing) nodes.push(trailing);
    cursor = match.index + raw.length;
  }
  if (cursor < text.length) nodes.push(highlightedMentions(text.slice(cursor)));
  return nodes;
}

export function RichText({ text, format = "plain", tableLayout = "wide" }: { text: string; format?: "plain" | "markdown" | "tex"; tableLayout?: "wide" | "scroll" }) {
  if (format === "plain") return <>{linkedPlainText(text, "text")}{text.endsWith("\n") && <span aria-hidden="true">{"\u200b"}</span>}</>;
  if (format === "markdown") return (
    <div className={`mindmap-rich-text ${styles.markdown}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkAgentMentions]} components={{
        table: ({ children }) => <div
          className={`${styles.tableScroll} ${tableLayout === "scroll" ? `${styles.tableCompact} nowheel nodrag nopan` : styles.tableWide}`}
          tabIndex={0}
          role="region"
          aria-label="Table"
          onPointerDown={(event) => event.stopPropagation()}
          onWheelCapture={(event) => {
            if (tableLayout !== "scroll") return;
            event.stopPropagation();
            if (!event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
            event.preventDefault();
            event.currentTarget.scrollLeft += event.deltaY;
          }}
        ><table>{children}</table></div>,
        a: ({ href, children }) => {
          const target = href && safeUrl(href);
          return target ? <a href={target} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{children}</a> : <span>{children}</span>;
        },
      }}>{text}</ReactMarkdown>
    </div>
  );
  const parts: ReactNode[] = [];
  const pattern = /\\(?:textbf|emph|textit)\{|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\[[\s\S]*?\\\]|\\\([^\n]*?\\\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > 0 && text[match.index - 1] === "\\") continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    const key = match.index;
    if (match[0].endsWith("{")) {
      const closing = texClosingBrace(text, match.index + match[0].length - 1);
      if (closing !== null) {
        const inner = <RichText text={text.slice(pattern.lastIndex, closing)} format="tex" />;
        parts.push(match[0] === "\\textbf{" ? <strong key={key}>{inner}</strong> : <em key={key}>{inner}</em>);
        pattern.lastIndex = closing + 1;
      } else parts.push(match[0]);
    } else {
      const displayMode = match[0].startsWith("$$") || match[0].startsWith("\\[");
      const delimited = match[0].startsWith("\\(") || match[0].startsWith("\\[") || displayMode;
      const source = delimited ? match[0].slice(2, -2) : match[0].slice(1, -1);
      parts.push(<span key={key} className={displayMode ? "block" : undefined} dangerouslySetInnerHTML={{ __html: katex.renderToString(source, { throwOnError: false, displayMode }) }} />);
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  const rendered = parts.length
    ? parts.flatMap((part, index) => typeof part === "string" ? linkedPlainText(part, `part-${index}`) : [part])
    : linkedPlainText(text, "text");
  return <>{rendered}{text.endsWith("\n") && <span aria-hidden="true">{"\u200b"}</span>}</>;
}
