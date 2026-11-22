import fs from 'node:fs'
import { assertPublicDemoProject } from '@/lib/server/demo-mode'
import { getProjectMetadata, projectContentDir } from '@/lib/store'
import { sha256 } from '@/lib/tex-project/codec'
import { agentInboxReceiptFile, readAgentInboxReceipts } from './agent-reply-receipts'

function accessibleProjectDir(project: string, scope?: readonly string[]): string {
  assertPublicDemoProject(project)
  if ((scope && !scope.includes(project)) || !getProjectMetadata(project)) throw new Error('Choose an accessible OpenBar project.')
  return projectContentDir(project)
}

/** An absent cursor starts at the current head. An expired cursor asks the client to resync its inbox. */
export function readInboxEvents(project: string, after?: string, scope?: readonly string[]) {
  const state = readAgentInboxReceipts(accessibleProjectDir(project, scope))
  const journal = state.mentionJournal
  const entries = journal?.entries || []
  const stream = sha256(JSON.stringify(['mention-events', project]))
  if (after !== undefined && (!after.startsWith(stream + '.') || !/^(?:0|[a-f0-9]{64})$/.test(after.slice(stream.length + 1)))) {
    throw new RangeError('Invalid cursor for this project inbox.')
  }
  const base = journal?.previous || '0'
  const head = entries.at(-1)?.id || base
  const cursor = stream + '.' + head
  const last = after?.slice(stream.length + 1)
  const index = entries.findIndex(entry => entry.id === last)
  const reset = last !== undefined && last !== head && last !== base && index < 0
  const start = last === base ? 0 : index + 1
  const events = last === undefined || last === head || reset ? [] : entries.slice(start).map(entry => ({
    ...entry, project, cursor: stream + '.' + entry.id,
    href: `/p/${encodeURIComponent(project)}/mindmap/${encodeURIComponent(entry.mapId)}#${encodeURIComponent(entry.nodeId)}`,
  }))
  return { cursor, events, reset }
}

/** Node shares stat watchers by filename. Watching the receipt path survives atomic replacement and multiple writers. */
export function watchInboxEvents(project: string, onChange: () => void, signal: AbortSignal, scope?: readonly string[]): () => void {
  const file = agentInboxReceiptFile(accessibleProjectDir(project, scope))
  const listener = () => { if (!signal.aborted) onChange() }
  const stop = () => {
    fs.unwatchFile(file, listener)
    signal.removeEventListener('abort', stop)
  }
  if (!signal.aborted) {
    fs.watchFile(file, { persistent: false, interval: 1000 }, listener)
    signal.addEventListener('abort', stop, { once: true })
  }
  return stop
}
