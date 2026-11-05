import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownDocument({ source }: { source: string }) {
  return <article className="prose-ob max-w-3xl"><ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown></article>;
}
