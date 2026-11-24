export type InboxDisposition = 'acknowledged' | 'already_resolved' | 'reopened' | 'already_open' | 'stale' | 'missing'
export type InboxAcknowledgement = { id: string, disposition: InboxDisposition, project?: string, requestId?: string }
export type InboxClaimDisposition = 'claimed' | 'released' | 'already_resolved' | 'stale' | 'missing'
export type InboxClaimResult = { id: string, disposition: InboxClaimDisposition, project?: string, requestId?: string, workingUntil?: string }

/** Active working claims automatically expire and revert `@agent` back to `@` after 30 minutes. */
export const INBOX_CLAIM_TTL_MS = 30 * 60 * 1000

export type AgentRequestHistory = {
  id: string
  mapId: string
  nodeId: string
  question: string
  href: string
  recordedAt: string
  updatedAt: string
  disposition: 'captured' | InboxDisposition
  replies: Array<{ mapId: string, nodeId: string, href: string, responseRevision: string, repliedAt?: string, updatedAt?: string }>
}

export type AgentMentionLocation = { field: string; offset: number; sourceHash: string }

export type InboxNotification = {
  id: string
  project: string
  mapId: string
  nodeId: string
  todoId?: string | null
  text: string
  fields: string[]
  priority?: 'fast-tracked'
  href: string
  acknowledged: boolean
  /** ISO timestamp when an active working claim expires (30 minutes from claim). */
  workingUntil?: string
  workingMention?: AgentMentionLocation & { previewOffset: number }
}

export type ConflictKind = 'git' | 'mindmap' | 'paper'

export type ConflictNotification = {
  id: string
  project: string
  kind: ConflictKind
  code: string
  message: string
  guidance: string
  href: string
  createdAt: string
  mapId?: string
  nodeIds?: string[]
  files?: string[]
  branch?: string
  ahead?: number
  behind?: number
  localCommit?: string
  remoteCommit?: string
  expectedHash?: string
  currentHash?: string
}

export type AgentInbox = {
  count: number
  notifications: InboxNotification[]
  hasMore: boolean
  revision: string
  replies: AgentReply[]
  conflicts?: ConflictNotification[]
  history?: Array<AgentRequestHistory & { project: string }>
}

export type AgentReply = {
  project: string
  mapId: string
  nodeId: string
  requestNodeId?: string
  question?: string
  requestCurrent?: boolean
  responseRevision: string
  contentHash: string
  repliedAt: string
}

export const AGENT_INBOX_ACTOR_HEADER = 'X-OpenBar-Actor'

export const ANSWER_CARD_GUIDANCE = 'Remove the @agent or @stat marker from the reader-facing answer. Write for someone who never saw the conversation, using the terms and style of neighboring cards. Replace or rephrase the visible question, or keep a concise Q&A when the question helps explain the answer. Preserve the original wording once in its owning paper or map. When replacing a map-owned ask, move it into caption (collapsed Notes) in the same patch and retain existing notes.'

export const INBOX_GUIDANCE = `At session start, call check_inbox after get_project_state; also call it on "tick", "check updates", "check inbox", or "sync" (before Git sync). Handle fast-tracked @stat ("agent STAT") requests first. Immediately before starting work on a request, call claim_inbox with its exact notification ID (or {project, all: true} only if you are immediately working on every pending mention in that project) so the card shows a spinning working indicator for 30 minutes; only claim requests you are immediately working on. Reply on the linked card or Agent draft children. ${ANSWER_CARD_GUIDANCE} After saving the reply, call acknowledge_inbox with the exact notification IDs (which also clears the working indicator). Repeated IDs identify the same request. Edited request text receives a new ID. Paper TODO completion is a separate decision.`

export const INBOX_TOOL_DESCRIPTIONS = {
  check_inbox: 'List pending human @agent and fast-tracked @stat requests with card links (fast-tracked first), plus any active Git or saved-file conflict alerts. For reply wording, see the bundled mindmap-writing skill. Set includeAcknowledged=true for handled history.',
  claim_inbox: 'Signal that you are immediately working on specific pending notification IDs (or all pending mentions in a project with {project, all: true}). Replaces @ on those mentions with a spinning indicator for 30 minutes before reverting automatically. Only claim requests you are immediately working on; set working=false to release early.',
  acknowledge_inbox: 'Mark exact notification IDs as handled after replying (set acknowledged=false to reopen). Clears active working indicators and preserves card content and paper TODO completion.',
}

export function formatInboxPrefix(inbox: AgentInbox): string {
  const sections: string[] = []
  if (inbox.conflicts?.length) {
    const conflictSummary = inbox.conflicts.map(conflict => {
      const location = conflict.kind === 'mindmap' && conflict.mapId
        ? `${conflict.project}/${conflict.mapId}${conflict.nodeIds?.length ? `#${conflict.nodeIds.join(',')}` : ''}`
        : conflict.project
      const files = conflict.files?.length
        ? ` [files: ${conflict.files.slice(0, 5).join(', ')}${conflict.files.length > 5 ? ` +${conflict.files.length - 5}` : ''}]`
        : ''
      const snippet = conflict.message.replace(/\s+/g, ' ').trim().slice(0, 200)
      return `- [${conflict.kind}:${conflict.code}] ${location}${files}: ${snippet} (${conflict.href})`
    }).join('\n')
    sections.push(`OpenBar conflict alert (${inbox.conflicts.length}): inspect the conflict and resolve it if you are confident nothing will be lost; otherwise summarize what conflicted and wait for the human to tell you what to do.\n${conflictSummary}`)
  }
  if (inbox.count > 0) {
    const fastTracked = inbox.notifications.some(note => !note.acknowledged && note.priority === 'fast-tracked')
    const summary = inbox.notifications.map(note => {
      const tag = note.priority === 'fast-tracked' ? '[agent STAT] ' : ''
      const working = note.workingUntil ? '[working] ' : ''
      const snippet = note.text.replace(/\s+/g, ' ').trim().slice(0, 140)
      return `- ${tag}${working}${note.id} (${note.project}/${note.mapId}#${note.nodeId}): ${snippet}`
    }).join('\n')
    sections.push(`OpenBar inbox: ${inbox.count} pending request${inbox.count === 1 ? '' : 's'}${fastTracked ? ' (handle agent STAT first)' : ''}. Claim only the request(s) you are immediately working on with claim_inbox, reply with concise cards, then acknowledge_inbox with exact IDs.\n${summary}${inbox.hasMore ? '\nCall check_inbox for more requests.' : ''}`)
  }
  return sections.join('\n\n')
}
