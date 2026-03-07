"use client"

import * as React from 'react'
import {
  ListTodo,
  Loader2,
  X,
} from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import type { TimelineEntry } from '../../lib/timeline/types'
import {
  TimelineItem,
  FilterDropdown,
  type FilterState,
} from '../../lib/timeline/shared'

export type DealTimelinePanelProps = {
  dealId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  t: TranslateFn
}

const PAGE_SIZE = 30

export function DealTimelinePanel({ dealId, open, onOpenChange, t }: DealTimelinePanelProps) {
  const [entries, setEntries] = React.useState<TimelineEntry[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [filterKinds, setFilterKinds] = React.useState<FilterState>(new Set())
  const loadedRef = React.useRef(false)

  const typesParam = filterKinds.size > 0 ? [...filterKinds].join(',') : undefined

  const loadTimeline = React.useCallback(
    async (cursor: string | null, append: boolean) => {
      setIsLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        params.set('limit', String(PAGE_SIZE))
        if (cursor) params.set('before', cursor)
        if (typesParam) params.set('types', typesParam)

        const result = await readApiResultOrThrow<{ items: TimelineEntry[]; nextCursor: string | null }>(
          `/api/customers/deals/${encodeURIComponent(dealId)}/timeline?${params.toString()}`,
          undefined,
          { errorMessage: t('customers.deals.timeline.error', 'Failed to load timeline.') },
        )
        const payload = result as { items: TimelineEntry[]; nextCursor: string | null }

        if (append) {
          setEntries((prev) => [...prev, ...payload.items])
        } else {
          setEntries(payload.items)
        }
        setNextCursor(payload.nextCursor)
      } catch (err) {
        const message = err instanceof Error ? err.message : t('customers.deals.timeline.error', 'Failed to load timeline.')
        setError(message)
      } finally {
        setIsLoading(false)
      }
    },
    [dealId, t, typesParam],
  )

  React.useEffect(() => {
    if (!open) {
      loadedRef.current = false
      return
    }
    loadedRef.current = true
    setEntries([])
    setNextCursor(null)
    loadTimeline(null, false)
  }, [open, loadTimeline])

  React.useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        onOpenChange(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  const handleLoadMore = React.useCallback(() => {
    if (nextCursor && !isLoading) {
      loadTimeline(nextCursor, true)
    }
  }, [nextCursor, isLoading, loadTimeline])

  const handleFilterChange = React.useCallback((next: FilterState) => {
    setFilterKinds(next)
  }, [])

  if (!open) return null

  const isEmpty = entries.length === 0 && !isLoading && !error
  const isInitialLoading = entries.length === 0 && isLoading

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md border-l bg-background shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={t('customers.deals.timeline.title', 'Timeline')}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <ListTodo className="h-5 w-5" />
              <h2 className="font-semibold">
                {t('customers.deals.timeline.title', 'Timeline')}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <FilterDropdown selected={filterKinds} onChange={handleFilterChange} t={t} />
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                aria-label={t('customers.deals.timeline.close', 'Close')}
              >
                <X className="size-4" />
              </IconButton>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {isInitialLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="mb-2 h-8 w-8 animate-spin" />
                <p>{t('customers.deals.timeline.loading', 'Loading timeline...')}</p>
              </div>
            ) : null}

            {error && entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                <p>{error}</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => loadTimeline(null, false)}>
                  {t('customers.deals.timeline.retry', 'Retry')}
                </Button>
              </div>
            ) : null}

            {isEmpty ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <ListTodo className="mb-2 h-8 w-8 opacity-50" />
                <p>{t('customers.deals.timeline.empty', 'No activity recorded yet.')}</p>
              </div>
            ) : null}

            {entries.length > 0 ? (
              <div>
                {entries.map((entry, idx) => (
                  <TimelineItem
                    key={entry.id}
                    entry={entry}
                    isLast={idx === entries.length - 1}
                    t={t}
                  />
                ))}
              </div>
            ) : null}

            {error && entries.length > 0 ? (
              <div className="text-xs text-red-500 py-2">{error}</div>
            ) : null}

            {nextCursor ? (
              <div className="pt-2 pb-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={isLoading}
                >
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t('customers.deals.timeline.loadMore', 'Load more')}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
}
