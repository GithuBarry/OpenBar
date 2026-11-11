import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./markdown-document.module.css";

export function MarkdownDocument({ source }: { source: string }) {
  return <article className={`prose-ob max-w-3xl ${styles.document}`}><ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown></article>;
}
