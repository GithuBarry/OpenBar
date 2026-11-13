"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { requestInbox } from "@/features/use-inbox-webmcp"
import type { AgentInbox } from "@/lib/research/agent-inbox-contract"
import { answeredAgentRequestNodeIds } from "@/lib/research/agent-reply-state"

type Reply = AgentInbox["replies"][number]
type ReplyState = { scope: string, replies: Reply[], seen: Record<string, string> }

function seenPrefix(project: string, mapId: string) {
  return `openbar:agent-reply-seen:v1:${encodeURIComponent(project)}:${encodeURIComponent(mapId)}:`
}

function seenKey(prefix: string, reply: Reply) {
  return prefix + encodeURIComponent(reply.nodeId) + ":" + encodeURIComponent(reply.responseRevision)
}

function storedSeen(prefix: string, replies: Reply[]): Record<string, string> {
  const seen: Record<string, string> = {}
  try {
    for (const reply of replies) {
      if (window.localStorage.getItem(seenKey(prefix, reply)) === "1") seen[reply.nodeId] = reply.responseRevision
    }
  } catch { /* Read state remains available in this tab when storage is unavailable. */ }
  return seen
}

/** Reply delivery uses the existing session revision and inbox endpoint. */
export function useAgentReplies(project: string, mapId: string, inboxRevision?: string, diskHash?: string) {
  const prefix = seenPrefix(project, mapId)
  const [state, setState] = useState<ReplyState>({ scope: prefix, replies: [], seen: {} })
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    let stopped = false
    let controller: AbortController | undefined
    const publish = (next: ReplyState) => { stateRef.current = next; setState(next) }
    const refresh = async () => {
      controller?.abort()
      const request = new AbortController()
      controller = request
      const result = await requestInbox<AgentInbox>("GET", project, {}, request.signal)
      if (stopped || request.signal.aborted || !result.ok || !Array.isArray(result.value?.replies)) return
      const replies = result.value.replies.filter(reply => reply.project === project && reply.mapId === mapId)
      const previous = stateRef.current
      publish({ scope: prefix, replies, seen: { ...(previous.scope === prefix ? previous.seen : {}), ...storedSeen(prefix, replies) } })
    }
    const storage = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith(prefix)) return
      const current = stateRef.current
      if (current.scope === prefix) publish({ ...current, seen: { ...current.seen, ...storedSeen(prefix, current.replies) } })
    }
    void refresh()
    window.addEventListener("openbar-inbox-updated", refresh)
    window.addEventListener("storage", storage)
    return () => {
      stopped = true
      controller?.abort()
      window.removeEventListener("openbar-inbox-updated", refresh)
      window.removeEventListener("storage", storage)
    }
  }, [project, mapId, inboxRevision, diskHash, prefix])

  const markRead = useCallback((nodeId: string, contentHash: string) => {
    const current = stateRef.current
    const reply = current.scope === prefix ? current.replies.find(item => item.nodeId === nodeId) : undefined
    if (!reply || reply.contentHash !== contentHash || current.seen[nodeId] === reply.responseRevision) return
    const next = { ...current, seen: { ...current.seen, [nodeId]: reply.responseRevision } }
    stateRef.current = next
    setState(next)
    try { window.localStorage.setItem(seenKey(prefix, reply), "1") }
    catch { /* The current tab retains its read state. */ }
  }, [prefix])

  const replies = useMemo(() => state.scope === prefix ? state.replies : [], [state.scope, state.replies, prefix])
  const unreadNodeIds = useMemo(() => new Set(replies
    .filter(reply => state.seen[reply.nodeId] !== reply.responseRevision).map(reply => reply.nodeId)), [replies, state.seen])
  const answeredRequestNodeIds = useMemo(() => answeredAgentRequestNodeIds(replies), [replies])
  return { replies, unreadNodeIds, answeredRequestNodeIds, markRead }
}
