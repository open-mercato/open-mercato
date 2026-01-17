'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage, LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type SalesHistoryEntry = {
  id: string
  kind: 'status' | 'action' | 'comment'
  occurredAt: string
  actionLabel: string | null
  actor: {
    id: string | null
    label: string | null
    kind: 'user' | 'api_key' | 'system'
  }
  source: 'action_log' | 'note'
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

type HistoryResponse = {
  items: SalesHistoryEntry[]
}

type HistoryFilter = 'all' | 'status' | 'action' | 'comment'

const FILTER_TYPES: Array<{ id: HistoryFilter; type?: SalesHistoryEntry['kind']; labelKey: string }> = [
  { id: 'all', labelKey: 'sales.documents.history.filter.all' },
  { id: 'status', type: 'status', labelKey: 'sales.documents.history.filter.status' },
  { id: 'action', type: 'action', labelKey: 'sales.documents.history.filter.actions' },
  { id: 'comment', type: 'comment', labelKey: 'sales.documents.history.filter.comments' },
]

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

function resolveActorLabel(entry: SalesHistoryEntry, t: (key: string, fallback?: string, vars?: Record<string, string>) => string): string {
  const actorLabel = entry.actor.label ?? entry.actor.id
  if (entry.actor.kind === 'api_key') {
    return t('sales.documents.history.by_api_key', 'by API key: {name}', { name: actorLabel ?? 'unknown' })
  }
  if (actorLabel) {
    return t('sales.documents.history.by_actor', 'by {actor}', { actor: actorLabel })
  }
  return t('sales.documents.history.by_system', 'by system')
}

function resolveEntryTitle(entry: SalesHistoryEntry, t: (key: string, fallback?: string, vars?: Record<string, string>) => string): string {
  if (entry.kind === 'status') {
    const fallbackStatus = t('sales.documents.history.status_empty', 'unset')
    const fromValue = entry.metadata?.statusFrom ?? fallbackStatus
    const toValue = entry.metadata?.statusTo ?? fallbackStatus
    return t('sales.documents.history.status_changed', 'Status changed from {from} to {to}', {
      from: fromValue,
      to: toValue,
    })
  }
  if (entry.kind === 'comment') {
    return t('sales.documents.history.comment', 'Comment')
  }
  return entry.actionLabel ?? t('sales.documents.history.action', 'Activity')
}

function resolveEntrySummary(entry: SalesHistoryEntry, t: (key: string, fallback?: string, vars?: Record<string, string>) => string): string | null {
  if (entry.kind === 'comment') {
    return entry.note?.body ?? null
  }
  if (entry.kind === 'status') {
    return null
  }
  return null
}

export function SalesDocumentHistorySection({
  documentId,
  kind,
  limit = 50,
}: {
  documentId: string
  kind: 'order' | 'quote'
  limit?: number
}) {
  const t = useT()
  const [filter, setFilter] = React.useState<HistoryFilter>('all')
  const [entries, setEntries] = React.useState<SalesHistoryEntry[]>([])
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadHistory = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        kind,
        id: documentId,
        limit: String(limit),
      })
      const filterType = FILTER_TYPES.find((item) => item.id === filter)?.type
      if (filterType) params.set('types', filterType)
      const payload = await readApiResultOrThrow<HistoryResponse>(
        `/api/sales/document-history?${params.toString()}`,
        undefined,
        { errorMessage: t('sales.documents.history.error', 'Failed to load document history.') }
      )
      const items = Array.isArray(payload?.items) ? payload.items : []
      setEntries(items)
      setSelectedId((prev) => {
        if (prev && items.some((item) => item.id === prev)) return prev
        return items[0]?.id ?? null
      })
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t('sales.documents.history.error', 'Failed to load document history.')
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [documentId, filter, kind, limit, t])

  React.useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const selectedEntry = React.useMemo(() => entries.find((entry) => entry.id === selectedId) ?? null, [entries, selectedId])

  if (loading) {
    return <LoadingMessage label={t('sales.documents.history.loading', 'Loading history…')} />
  }

  if (error) {
    return (
      <ErrorMessage
        label={error}
        action={(
          <Button size="sm" variant="ghost" onClick={() => void loadHistory()}>
            {t('sales.documents.history.retry', 'Retry')}
          </Button>
        )}
      />
    )
  }

  if (!entries.length) {
    return (
      <TabEmptyState
        title={t('sales.documents.history.empty', 'No history entries yet.')}
      />
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(260px,320px)_1fr]">
      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          {FILTER_TYPES.map((option) => (
            <Button
              key={option.id}
              type="button"
              variant={filter === option.id ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setFilter(option.id)}
            >
              {t(option.labelKey, option.id)}
            </Button>
          ))}
        </div>
        <div className="max-h-[420px] overflow-y-auto p-3 space-y-2">
          {entries.map((entry) => {
            const title = resolveEntryTitle(entry, t)
            const summary = resolveEntrySummary(entry, t)
            const actor = resolveActorLabel(entry, t)
            const timestamp = formatTimestamp(entry.occurredAt)
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedId(entry.id)}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 text-left transition',
                  selectedId === entry.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                )}
              >
                <div className="text-xs text-muted-foreground">{timestamp}</div>
                <div className="mt-1 text-sm font-semibold text-foreground line-clamp-2">{title}</div>
                {summary ? <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{summary}</div> : null}
                <div className="mt-2 text-xs text-muted-foreground">{actor}</div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        {selectedEntry ? (
          <div className="space-y-4">
            <div>
              <div className="text-xs text-muted-foreground">{formatTimestamp(selectedEntry.occurredAt)}</div>
              <h3 className="mt-2 text-lg font-semibold text-foreground">
                {resolveEntryTitle(selectedEntry, t)}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {resolveActorLabel(selectedEntry, t)}
              </p>
            </div>
            {selectedEntry.kind === 'comment' ? (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm text-foreground">
                {selectedEntry.note?.body ?? t('sales.documents.history.comment_empty', 'No comment text provided.')}
              </div>
            ) : null}
            {selectedEntry.kind === 'action' ? (
              <div className="text-sm text-muted-foreground">
                {selectedEntry.actionLabel ?? t('sales.documents.history.action', 'Activity')}
              </div>
            ) : null}
            {selectedEntry.kind === 'status' ? (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm text-foreground">
                {resolveEntryTitle(selectedEntry, t)}
              </div>
            ) : null}
          </div>
        ) : (
          <TabEmptyState
            title={t('sales.documents.history.select', 'Select an event to see details.')}
          />
        )}
      </div>
    </div>
  )
}
