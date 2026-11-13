import { RichText } from "@/components/rich-text"
import { cleanAgentReplyDisplay, type AgentReplyPresentation } from "@/lib/research/agent-reply-state"
import styles from "./card-question-answer.module.css"

/** Q&A is a display of saved replies. Editing continues to use the authored text. */
export function CardQuestionAnswer({ presentation, title, body, format = "plain", tableLayout }: {
  presentation: AgentReplyPresentation
  title: string
  body: string
  format?: "plain" | "markdown" | "tex"
  tableLayout?: "wide" | "scroll"
}) {
  const question = cleanAgentReplyDisplay(presentation.question)
  const cleanTitle = presentation.kind === "answer" ? title.trim() : cleanAgentReplyDisplay(title)
  const cleanBody = presentation.kind === "answer" ? body.trim() : cleanAgentReplyDisplay(body)
  const answerTitle = presentation.kind === "question-answer" && cleanTitle === question ? "" : cleanTitle
  const answerBody = presentation.kind === "question-answer"
    ? cleanBody === question ? "" : cleanBody.startsWith(question) && /^\s/.test(cleanBody.slice(question.length)) ? cleanBody.slice(question.length).trim() : cleanBody
    : cleanBody
  const hasAnswer = Boolean(answerTitle || answerBody)
  return <div className={styles.content} data-agent-answer-kind={presentation.kind}>
    {presentation.kind !== "answer" && <div className={styles.question} role="group" aria-label="Question">
      <span className={styles.label} aria-hidden="true">Q</span>
      <div className={styles.copy}>
        {presentation.kind === "question" ? <>
          {cleanTitle && <div className={styles.title}><RichText text={cleanTitle} format={format} tableLayout={tableLayout} /></div>}
          {cleanBody && <div className={styles.body}><RichText text={cleanBody} format={format} tableLayout={tableLayout} /></div>}
        </> : <div className={styles.questionText}><RichText text={question} format={format} tableLayout={tableLayout} /></div>}
      </div>
    </div>}
    {presentation.kind !== "question" && hasAnswer && <div className={styles.answer} role="group" aria-label="Answer">
      <span className={styles.label} aria-hidden="true">A</span>
      <div className={styles.copy}>
        {answerTitle && <div className={styles.title}><RichText text={answerTitle} format={format} tableLayout={tableLayout} /></div>}
        {answerBody && <div className={styles.body}><RichText text={answerBody} format={format} tableLayout={tableLayout} /></div>}
      </div>
    </div>}
  </div>
}
