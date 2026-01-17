import type { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import type { SalesNote } from '../data/entities'

export type SalesHistoryEntryKind = 'status' | 'action' | 'comment'
export type SalesHistoryEntrySource = 'action_log' | 'note'
export type SalesHistoryActorKind = 'user' | 'api_key' | 'system'

export type SalesHistoryActor = {
  id: string | null
  label: string | null
  kind: SalesHistoryActorKind
}

export type SalesHistoryEntry = {
  id: string
  kind: SalesHistoryEntryKind
  occurredAt: string
  actionLabel: string | null
  actor: SalesHistoryActor
  source: SalesHistoryEntrySource
  metadata?: {
    statusFrom?: string | null
    statusTo?: string | null
    documentKind?: 'order' | 'quote'
    commandId?: string | null
  }
  note?: {
    body: string | null
    appearanceIcon?: string | null
    appearanceColor?: string | null
  }
}

type HistoryBuildOptions = {
  actionLogs: ActionLog[]
  notes: SalesNote[]
  userLabels: Record<string, string>
  includeTypes: Set<SalesHistoryEntryKind>
  documentKind: 'order' | 'quote'
}

const DEFAULT_ACTION_LABEL = 'Unknown action'

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && value.length) return value
  return new Date().toISOString()
}

function normalizeStatus(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function extractStatusFromSnapshot(snapshot: unknown): string | null {
  if (!isRecord(snapshot)) return null
  const order = snapshot.order
  if (isRecord(order)) {
    const status = normalizeStatus(order.status)
    if (status !== null) return status
  }
  const quote = snapshot.quote
  if (isRecord(quote)) {
    const status = normalizeStatus(quote.status)
    if (status !== null) return status
  }
  if ('status' in snapshot) {
    return normalizeStatus(snapshot.status)
  }
  return null
}

function extractStatusChange(log: ActionLog): { from: string | null; to: string | null; documentKind?: 'order' | 'quote' } | null {
  const context = isRecord(log.contextJson) ? log.contextJson : null
  const contextFrom = context ? normalizeStatus(context.statusFrom) : null
  const contextTo = context ? normalizeStatus(context.statusTo) : null
  const contextKind = context && (context.documentKind === 'order' || context.documentKind === 'quote')
    ? context.documentKind
    : undefined

  if (contextFrom !== null || contextTo !== null) {
    if (contextFrom === contextTo) return null
    return { from: contextFrom, to: contextTo, documentKind: contextKind }
  }

  const before = extractStatusFromSnapshot(log.snapshotBefore)
  const after = extractStatusFromSnapshot(log.snapshotAfter)
  if (before === after) return null
  if (before === null && after === null) return null
  return { from: before, to: after, documentKind: contextKind }
}

function resolveActorLabel(
  log: ActionLog,
  userLabels: Record<string, string>
): { label: string | null; kind: SalesHistoryActorKind } {
  const context = isRecord(log.contextJson) ? log.contextJson : null
  const contextLabel = context && typeof context.actorLabel === 'string' ? context.actorLabel : null
  const contextKind = context && context.actorKind === 'api_key' ? 'api_key' : null
  if (contextLabel) {
    return { label: contextLabel, kind: contextKind ?? 'user' }
  }
  if (log.actorUserId) {
    return {
      label: userLabels[log.actorUserId] ?? log.actorUserId,
      kind: contextKind ?? 'user',
    }
  }
  return { label: null, kind: 'system' }
}

function resolveNoteActorLabel(
  note: SalesNote,
  userLabels: Record<string, string>
): { label: string | null; kind: SalesHistoryActorKind } {
  if (note.authorUserId) {
    return {
      label: userLabels[note.authorUserId] ?? note.authorUserId,
      kind: 'user',
    }
  }
  return { label: null, kind: 'system' }
}

export function buildSalesHistoryEntries(options: HistoryBuildOptions): SalesHistoryEntry[] {
  const entries: SalesHistoryEntry[] = []

  if (options.includeTypes.has('action') || options.includeTypes.has('status')) {
    for (const log of options.actionLogs) {
      const occurredAt = toIso(log.createdAt)
      const actor = resolveActorLabel(log, options.userLabels)

      if (options.includeTypes.has('action')) {
        entries.push({
          id: log.id,
          kind: 'action',
          occurredAt,
          actionLabel: log.actionLabel ?? log.commandId ?? DEFAULT_ACTION_LABEL,
          actor: {
            id: log.actorUserId ?? null,
            label: actor.label,
            kind: actor.kind,
          },
          source: 'action_log',
          metadata: {
            documentKind: options.documentKind,
            commandId: log.commandId ?? null,
          },
        })
      }

      if (options.includeTypes.has('status')) {
        const statusChange = extractStatusChange(log)
        if (statusChange) {
          entries.push({
            id: `${log.id}:status`,
            kind: 'status',
            occurredAt,
            actionLabel: log.actionLabel ?? null,
            actor: {
              id: log.actorUserId ?? null,
              label: actor.label,
              kind: actor.kind,
            },
            source: 'action_log',
            metadata: {
              statusFrom: statusChange.from ?? null,
              statusTo: statusChange.to ?? null,
              documentKind: statusChange.documentKind ?? options.documentKind,
              commandId: log.commandId ?? null,
            },
          })
        }
      }
    }
  }

  if (options.includeTypes.has('comment')) {
    for (const note of options.notes) {
      const occurredAt = toIso(note.createdAt)
      const actor = resolveNoteActorLabel(note, options.userLabels)
      entries.push({
        id: note.id,
        kind: 'comment',
        occurredAt,
        actionLabel: null,
        actor: {
          id: note.authorUserId ?? null,
          label: actor.label,
          kind: actor.kind,
        },
        source: 'note',
        metadata: {
          documentKind: options.documentKind,
        },
        note: {
          body: note.body ?? null,
          appearanceIcon: note.appearanceIcon ?? null,
          appearanceColor: note.appearanceColor ?? null,
        },
      })
    }
  }

  return entries.sort((a, b) => {
    const aTs = Date.parse(a.occurredAt)
    const bTs = Date.parse(b.occurredAt)
    if (Number.isNaN(aTs) || Number.isNaN(bTs)) return 0
    return bTs - aTs
  })
}
