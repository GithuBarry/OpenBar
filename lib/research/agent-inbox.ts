import fs from 'node:fs'
import path from 'node:path'

import { openBarPaths } from '@/lib/config/openbar-paths'
import { listProjects, getProject, projectContentDir } from '@/lib/store'
import { sha256, withWriteLockAsync, writeTextAtomic } from '@/lib/tex-project/codec'
import { getProjectAgentMentions } from './project-state'
import type { AgentInbox, InboxNotification } from './agent-inbox-contract'

type InboxQuery = { project?: string, limit?: number, includeAcknowledged?: boolean }

function projects(project?: string, scope?: readonly string[]): string[] {
  if (project !== undefined && (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project) || !getProject(project))) throw new Error('Choose an existing OpenBar project.')
  const selected = project === undefined ? listProjects().map(item => item.slug) : [project]
  return scope ? selected.filter(slug => scope.includes(slug)) : selected
}

function receiptFile(project: string): string {
  return path.join(openBarPaths().runtimeRoot, 'agent-inbox', `${sha256(projectContentDir(project))}.json`)
}

function receipts(project: string): Set<string> {
  let source: string
  try { source = fs.readFileSync(receiptFile(project), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set()
    throw error
  }
  const ids: unknown = JSON.parse(source)
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) throw new Error('OpenBar inbox receipts need recovery.')
  return new Set(ids)
}

function notifications(project: string): InboxNotification[] {
  const handled = receipts(project)
  return getProjectAgentMentions(project, Infinity).notes.map(note => ({
    ...note, project, acknowledged: handled.has(note.id),
  }))
}

export function readAgentInbox(query: InboxQuery = {}, scope?: readonly string[]): AgentInbox {
  const all = projects(query.project, scope).flatMap(notifications)
  const pending = all.filter(note => !note.acknowledged)
  const visible = query.includeAcknowledged ? [...pending, ...all.filter(note => note.acknowledged)] : pending
  const limit = Math.max(1, Math.min(50, query.limit ?? 8))
  return { count: pending.length, notifications: visible.slice(0, limit), hasMore: visible.length > limit }
}

export async function acknowledgeAgentInbox(input: { project?: string, ids: string[], acknowledged?: boolean }, scope?: readonly string[]) {
  const ids = new Set(input.ids)
  const acknowledged: string[] = []
  for (const project of projects(input.project, scope)) {
    const relevant = getProjectAgentMentions(project, Infinity).notes.filter(note => ids.has(note.id))
    if (relevant.length === 0) continue
    await withWriteLockAsync(receiptFile(project), () => {
      const handled = receipts(project)
      for (const note of relevant) {
        if (input.acknowledged === false) handled.delete(note.id)
        else handled.add(note.id)
        acknowledged.push(note.id)
      }
      // Receipts contain delivery IDs. Request text stays in its paper or map.
      const currentIds = new Set(getProjectAgentMentions(project, Infinity).notes.map(note => note.id))
      writeTextAtomic(receiptFile(project), `${JSON.stringify([...handled].filter(id => currentIds.has(id)))}\n`)
    })
  }
  return { acknowledged, inbox: readAgentInbox({ project: input.project }, scope) }
}
