import { memo, type ReactNode } from "react";
import katex from "katex";
import { HtmlCardBody } from "./html-card-body";
import type { MindmapNode } from "@/lib/types";
import remarkGfm from "remark-gfm";
import styles from "./rich-text.module.css";
import ReactMarkdown, { type Components } from "react-markdown";
import { ExternalLink } from "lucide-react";
import { texClosingBrace } from "@/lib/mindmap/text-formatting";
import { AGENT_MENTION_PATTERN } from "@/lib/research/agent-mentions";
import { CardDestinationLink, CardMentionLink } from "@/features/mindmap/linked-card";
import { InlineInfoNote } from "./inline-info-note";
import { remarkInlineInfoNotes } from "@/lib/mindmap/inline-info-notes";
import { remarkLineBreaks } from "@/lib/mindmap/markdown-breaks";
import { safeUrl } from "@/lib/safe-url";

const MENTION_SPLIT_RE = new RegExp(`(${AGENT_MENTION_PATTERN.source})`, "gi");
const CARD_MENTION_RE = /\[\[([A-Za-z0-9][A-Za-z0-9._-]{0,199})(?:\|([^\]\n]+))?\]\]/g;

function RichTextLink({ href, children }: { href: string; children: ReactNode }) {
  return <CardDestinationLink className={styles.link} href={href} title={`${href} — opens in a new tab`}
    externalIcon={<ExternalLink className={styles.linkIcon} size={11} aria-hidden="true" />}>{children}</CardDestinationLink>;
}

function mentionParts(text: string): string[] {
  return text.split(MENTION_SPLIT_RE);
}

function mentionProperties(mention: string, agentWorking = false) {
  const fastTracked = /^@stat$/i.test(mention);
  return {
    className: `${styles.agentMention}${fastTracked ? ` ${styles.agentStat}` : ""}${agentWorking ? ` ${styles.agentWorking}` : ""}`,
    ...(fastTracked ? { title: agentWorking ? "Agent is working on this fast tracked request" : "Fast tracked agent request", "data-agent-priority": "fast-tracked" } : agentWorking ? { title: "Agent is working on this request" } : {}),
    ...(agentWorking ? { "data-agent-working": "true" } : {}),
  };
}

function mentionLabel(mention: string, agentWorking = false): string {
  if (/^@stat$/i.test(mention)) return "agent STAT";
  return agentWorking ? mention.replace(/^@/, "") : mention;
}

function highlightedMentions(text: string, workingMentionAt?: number): ReactNode {
  let offset = 0;
  return mentionParts(text).map((part, index) => {
    const agentWorking = offset === workingMentionAt;
    offset += part.length;
    return index % 2 === 1
      ? <mark key={index} {...mentionProperties(part, agentWorking)}>
          {agentWorking && <span className={styles.agentSpinner} aria-hidden="true" />}
          {mentionLabel(part, agentWorking)}
        </mark>
      : part;
  });
}

type MarkdownNode = { type: string; value?: string; children?: MarkdownNode[]; data?: unknown; position?: { start: { offset?: number }; end: { offset?: number } } };
function remarkAgentMentions(workingMentionAt?: number) {
  return (tree: MarkdownNode, file: { value: unknown }) => {
    const source = String(file.value);
    const visit = (node: MarkdownNode) => {
      if (!node.children || node.type === "link" || node.type === "linkReference") return;
      node.children = node.children.flatMap((child): MarkdownNode[] => {
        if (child.type !== "text" || !child.value) { visit(child); return [child]; }
        const start = child.position?.start.offset;
        const end = child.position?.end.offset;
        let workingPart = -1;
        const parts = mentionParts(child.value);
        if (workingMentionAt !== undefined && start !== undefined && end !== undefined && workingMentionAt >= start && workingMentionAt < end) {
          const raw = mentionParts(source.slice(start, end));
          // Markdown may decode escapes and entities before rendering. Only use
          // the source offset when the raw and rendered marker sequences agree.
          if (raw.filter((_, i) => i % 2).join("\0") === parts.filter((_, i) => i % 2).join("\0")) {
            let offset = start;
            workingPart = raw.findIndex((part, index) => {
              const matches = index % 2 === 1 && offset === workingMentionAt;
              offset += part.length;
              return matches;
            });
          }
        }
        return parts.flatMap((part, index): MarkdownNode[] => {
          const agentWorking = index === workingPart;
          return !part ? [] : [index % 2 === 1
            ? {
              type: "agentMention",
              data: { hName: "mark", hProperties: mentionProperties(part, agentWorking) },
              children: [
                ...(agentWorking ? [{ type: "agentSpinner", data: { hName: "span", hProperties: { className: styles.agentSpinner, "aria-hidden": "true" } }, children: [] }] : []),
                { type: "text", value: mentionLabel(part, agentWorking) },
              ],
            }
            : { type: "text", value: part }];
        });
      });
    };
    visit(tree);
  };
}

function remarkCardMentions() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children || node.type === "link" || node.type === "linkReference" || node.type === "code" || node.type === "inlineCode" || node.type === "inlineInfoNote") return;
      node.children = node.children.flatMap((child): MarkdownNode[] => {
        if (child.type !== "text" || !child.value || !child.value.includes("[[")) { visit(child); return [child]; }
        const text = child.value;
        const out: MarkdownNode[] = [];
        const pattern = new RegExp(CARD_MENTION_RE.source, "g");
        let cursor = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text))) {
          if (match.index > cursor) out.push({ type: "text", value: text.slice(cursor, match.index) });
          const id = match[1]!;
          const label = match[2]?.trim() || undefined;
          out.push({
            type: "cardMention",
            data: {
              hName: "a",
              hProperties: {
                href: `#${encodeURIComponent(id)}`,
                "data-card-mention": id,
                "data-card-mention-raw": match[0],
                ...(label ? { "data-card-mention-label": label } : {}),
              },
            },
            children: [{ type: "text", value: label || id }],
          });
          cursor = match.index + match[0].length;
        }
        if (!out.length) return [child];
        if (cursor < text.length) out.push({ type: "text", value: text.slice(cursor) });
        return out;
      });
    };
    visit(tree);
  };
}

function linkedPlainText(text: string, keyPrefix: string, workingMentionAt?: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /https?:\/\/[^\s<>]+|\[\[([A-Za-z0-9][A-Za-z0-9._-]{0,199})(?:\|([^\]\n]+))?\]\]/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(highlightedMentions(text.slice(cursor, match.index), workingMentionAt === undefined ? undefined : workingMentionAt - cursor));
    if (match[1]) {
      nodes.push(<CardMentionLink key={`${keyPrefix}-card-${match.index}`} id={match[1]} label={match[2]?.trim()} raw={match[0]} />);
    } else {
      const raw = match[0];
      const trailing = raw.match(/[.,;:!?\]\)}]+$/)?.[0] || "";
      const href = raw.slice(0, raw.length - trailing.length);
      const target = safeUrl(href);
      nodes.push(target
        ? <RichTextLink key={`${keyPrefix}-${match.index}`} href={target}>{href}</RichTextLink>
        : href);
      if (trailing) nodes.push(trailing);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) nodes.push(highlightedMentions(text.slice(cursor), workingMentionAt === undefined ? undefined : workingMentionAt - cursor));
  return nodes;
}

const REMARK_PLUGINS = [remarkGfm, remarkLineBreaks, remarkInlineInfoNotes, remarkCardMentions] as const;

function markdownComponents(tableLayout: "wide" | "scroll"): Components {
  return {
    table: ({ children }) => <div
      className={`${styles.tableScroll} ${tableLayout === "scroll" ? `${styles.tableCompact} nowheel nodrag nopan` : styles.tableWide}`}
      tabIndex={0}
      role="region"
      aria-label="Table"
      onPointerDown={(event) => event.stopPropagation()}
      onWheelCapture={(event) => {
        if (tableLayout !== "scroll" || event.ctrlKey) return;
        event.stopPropagation();
        if (!event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
        event.preventDefault();
        event.currentTarget.scrollLeft += event.deltaY;
      }}
    ><table>{children}</table></div>,
    span: ({ children, ...props }) => {
      const info = (props as Record<string, unknown>)["data-inline-info"];
      if (typeof info === "string" && info) return <InlineInfoNote label={info}>{children}</InlineInfoNote>;
      return <span {...props}>{children}</span>;
    },
    a: ({ href, children, ...props }) => {
      const mentionId = (props as Record<string, unknown>)["data-card-mention"];
      if (typeof mentionId === "string" && mentionId) {
        const raw = String((props as Record<string, unknown>)["data-card-mention-raw"] || `[[${mentionId}]]`);
        const label = (props as Record<string, unknown>)["data-card-mention-label"];
        return <CardMentionLink id={mentionId} label={typeof label === "string" ? label : undefined} raw={raw} />;
      }
      const target = href && (safeUrl(href) || (/^(?:#[^\s]+|\/p\/[^/\\?#]+\/mindmap(?:\/[^/\\?#]+)?#[^\s]+)$/.test(href) ? href : undefined));
      return target ? <RichTextLink href={target}>{children}</RichTextLink> : <span>{children}</span>;
    },
  };
}

const MARKDOWN_COMPONENTS_WIDE = markdownComponents("wide");
const MARKDOWN_COMPONENTS_SCROLL = markdownComponents("scroll");

export const RichText = memo(function RichText({ text, format = "plain", tableLayout = "wide", workingMentionAt }: { text: string; format?: MindmapNode["contentFormat"]; tableLayout?: "wide" | "scroll"; workingMentionAt?: number }) {
  if (format === "html") return <HtmlCardBody text={text} workingMentionAt={workingMentionAt} />;
  if (format === "plain") return <>{linkedPlainText(text, "text", workingMentionAt)}{text.endsWith("\n") && <span aria-hidden="true">{"\u200b"}</span>}</>;
  if (format === "markdown") return (
    <div className={`mindmap-rich-text ${styles.markdown}`}>
      <ReactMarkdown remarkPlugins={[...REMARK_PLUGINS, [remarkAgentMentions, workingMentionAt]]} components={tableLayout === "scroll" ? MARKDOWN_COMPONENTS_SCROLL : MARKDOWN_COMPONENTS_WIDE}>{text}</ReactMarkdown>
    </div>
  );
  const parts: ReactNode[] = [];
  const pattern = /\\(?:textbf|emph|textit)\{|\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\\\[[\s\S]*?\\\]|\\\([^\n]*?\\\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > 0 && text[match.index - 1] === "\\") continue;
    if (match.index > last) parts.push(...linkedPlainText(text.slice(last, match.index), `part-${last}`, workingMentionAt === undefined ? undefined : workingMentionAt - last));
    const key = match.index;
    if (match[0].endsWith("{")) {
      const closing = texClosingBrace(text, match.index + match[0].length - 1);
      if (closing !== null) {
        const inner = <RichText text={text.slice(pattern.lastIndex, closing)} format="tex" workingMentionAt={workingMentionAt === undefined ? undefined : workingMentionAt - pattern.lastIndex} />;
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
  if (last < text.length) parts.push(...linkedPlainText(text.slice(last), `part-${last}`, workingMentionAt === undefined ? undefined : workingMentionAt - last));
  return <>{parts}{text.endsWith("\n") && <span aria-hidden="true">{"\u200b"}</span>}</>;
});
