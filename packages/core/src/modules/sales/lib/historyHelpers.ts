import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import type { SalesNote } from '../data/entities'

export type HistoryEntry = {
  id: string
  occurredAt: string
  kind: 'status' | 'action' | 'comment'
  action: string
  actor: { id: string | null; label: string }
  source: 'action_log' | 'note'
  metadata?: {
    statusFrom?: string | null
    statusTo?: string | null
    documentKind?: 'order' | 'quote'
    commandId?: string
  }
}

function extractStatusFromSnapshot(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== 'object') return null
  const s = snapshot as Record<string, unknown>
  // Dedicated logStatusChange entries: { status: "value" }
  if (typeof s.status === 'string') return s.status
  // Regular update snapshots: { order: { status: "value", ... } }
  if (s.order && typeof s.order === 'object') {
    const order = s.order as Record<string, unknown>
    if (typeof order.status === 'string') return order.status
  }
  // Regular update snapshots: { quote: { status: "value", ... } }
  if (s.quote && typeof s.quote === 'object') {
    const quote = s.quote as Record<string, unknown>
    if (typeof quote.status === 'string') return quote.status
  }
  return null
}

export function detectStatusChange(log: ActionLog): {
  statusFrom: string | null
  statusTo: string | null
} | null {
  // Skip creations — no previous state means no transition
  if (!log.snapshotBefore) return null
  const before = extractStatusFromSnapshot(log.snapshotBefore)
  const after = extractStatusFromSnapshot(log.snapshotAfter)
  if (before !== after && (before !== null || after !== null)) {
    return { statusFrom: before, statusTo: after }
  }
  return null
}

/**
 * Normalizes ActionLog to HistoryEntry (status/action/comment).
 */
export function normalizeActionLogToHistoryEntry(
  log: ActionLog,
  kind: 'order' | 'quote',
  displayUsers?: Record<string, string>,
): HistoryEntry {
  const statusChange = detectStatusChange(log)
  let entryKind: 'status' | 'action' = 'action'
  let action = log.actionLabel || log.commandId
  let metadata: HistoryEntry['metadata'] = { documentKind: kind, commandId: log.commandId }
  if (statusChange) {
    entryKind = 'status'
    action = statusChange.statusTo ?? 'unknown'
    metadata = { ...metadata, statusFrom: statusChange.statusFrom, statusTo: statusChange.statusTo }
  }
  const actorLabel = log.actorUserId
    ? (displayUsers?.[log.actorUserId] ?? log.actorUserId)
    : 'system'
  return {
    id: log.id,
    occurredAt: log.createdAt.toISOString(),
    kind: entryKind,
    action,
    actor: { id: log.actorUserId, label: actorLabel },
    source: 'action_log',
    metadata,
  }
}

export function normalizeNoteToHistoryEntry(
  note: SalesNote,
  kind: 'order' | 'quote',
  displayUsers?: Record<string, string>,
): HistoryEntry {
  const actorLabel = note.authorUserId
    ? (displayUsers?.[note.authorUserId] ?? note.authorUserId)
    : 'system'
  return {
    id: note.id,
    occurredAt: note.createdAt.toISOString(),
    kind: 'comment',
    action: note.body,
    actor: { id: note.authorUserId ?? null, label: actorLabel },
    source: 'note',
    metadata: { documentKind: kind },
  }
}

export type HistoryBuilderInput = {
  actionLogs: ActionLog[]
  notes?: SalesNote[]
  kind: 'order' | 'quote'
  displayUsers?: Record<string, string>
}

export function buildHistoryEntries(input: HistoryBuilderInput): HistoryEntry[] {
  const logEntries = input.actionLogs.map((log) =>
    normalizeActionLogToHistoryEntry(log, input.kind, input.displayUsers)
  )
  const noteEntries = (input.notes ?? []).map((note) =>
    normalizeNoteToHistoryEntry(note, input.kind, input.displayUsers)
  )
  return [...logEntries, ...noteEntries].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  )
}
