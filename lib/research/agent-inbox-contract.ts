export type InboxNotification = {
  id: string
  project: string
  mapId: string
  nodeId: string
  todoId?: string | null
  text: string
  fields: string[]
  href: string
  acknowledged: boolean
}

export type AgentInbox = {
  count: number
  notifications: InboxNotification[]
  hasMore: boolean
}

export const INBOX_GUIDANCE = 'When the user says "check updates" or "check inbox", call check_inbox. Tool responses can prefix pending OpenBar requests. Read each linked card and its current context, respond there within the user’s instructions, then acknowledge the exact notification IDs. Repeated IDs refer to the same request. Changed request text receives a new ID. Acknowledgement records delivery handling. Paper TODO completion remains a separate research decision.'

export const INBOX_TOOL_DESCRIPTIONS = {
  check_inbox: 'Check updates from human @agent mentions on OpenBar mindmap cards. Returns pending request IDs, text and card links. includeAcknowledged also shows handled requests. Read the linked context, reply there, then acknowledge the exact IDs.',
  acknowledge_inbox: 'Mark exact OpenBar notification IDs as handled after replying on their cards. Set acknowledged=false to reopen them. The original request text and paper TODO completion are preserved.',
}

export function formatInboxPrefix(inbox: AgentInbox): string {
  if (inbox.count === 0) return ''
  return `OpenBar inbox: ${inbox.count} pending request${inbox.count === 1 ? '' : 's'}. Read the linked context, reply on the card, then use acknowledge_inbox with the exact IDs.\n${JSON.stringify(inbox.notifications)}${inbox.hasMore ? '\nCall check_inbox for more requests.' : ''}`
}
