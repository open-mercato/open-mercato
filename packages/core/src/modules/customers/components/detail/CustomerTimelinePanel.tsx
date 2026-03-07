"use client"

import * as React from 'react'
import Link from 'next/link'
import {
  ChevronDown,
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

type DealOption = { id: string; title: string }

type CustomerTimelineResponse = {
  items: TimelineEntry[]
  nextCursor: string | null
  deals: DealOption[]
}

export type CustomerTimelinePanelProps = {
  entityId: string
  entityType: 'company' | 'person'
  open: boolean
  onOpenChange: (open: boolean) => void
  t: TranslateFn
}

const PAGE_SIZE = 30

function DealFilterDropdown({
  deals,
  selectedDealId,
  onChange,
  t,
}: {
  deals: DealOption[]
  selectedDealId: string | null
  onChange: (dealId: string | null) => void
  t: TranslateFn
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (deals.length === 0) return null

  const selectedLabel = selectedDealId
    ? deals.find((deal) => deal.id === selectedDealId)?.title ?? selectedDealId
    : t('customers.timeline.allDeals', 'All deals')

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs max-w-[160px]"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className={`ml-1 h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border bg-card p-2 shadow-lg">
          <Button
            type="button"
            variant={selectedDealId === null ? 'secondary' : 'ghost'}
            size="sm"
            className="w-full justify-start text-xs h-auto py-1.5"
            onClick={() => { onChange(null); setOpen(false) }}
          >
            {t('customers.timeline.allDeals', 'All deals')}
          </Button>
          <div className="my-1 border-t" />
          {deals.map((deal) => (
            <Button
              key={deal.id}
              type="button"
              variant={selectedDealId === deal.id ? 'secondary' : 'ghost'}
              size="sm"
              className="w-full justify-start text-xs h-auto py-1.5 truncate"
              onClick={() => { onChange(deal.id); setOpen(false) }}
            >
              {deal.title}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function CustomerTimelinePanel({ entityId, entityType, open, onOpenChange, t }: CustomerTimelinePanelProps) {
  const [entries, setEntries] = React.useState<TimelineEntry[]>([])
  const [deals, setDeals] = React.useState<DealOption[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [filterKinds, setFilterKinds] = React.useState<FilterState>(new Set())
  const [selectedDealId, setSelectedDealId] = React.useState<string | null>(null)
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
        if (selectedDealId) params.set('dealId', selectedDealId)

        const result = await readApiResultOrThrow<CustomerTimelineResponse>(
          `/api/customers/entities/${encodeURIComponent(entityId)}/timeline?${params.toString()}`,
          undefined,
          { errorMessage: t('customers.timeline.error', 'Failed to load timeline.') },
        )
        const payload = result as CustomerTimelineResponse

        if (append) {
          setEntries((prev) => [...prev, ...payload.items])
        } else {
          setEntries(payload.items)
          setDeals(payload.deals)
        }
        setNextCursor(payload.nextCursor)
      } catch (err) {
        const message = err instanceof Error ? err.message : t('customers.timeline.error', 'Failed to load timeline.')
        setError(message)
      } finally {
        setIsLoading(false)
      }
    },
    [entityId, t, typesParam, selectedDealId],
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

  const handleDealFilterChange = React.useCallback((dealId: string | null) => {
    setSelectedDealId(dealId)
  }, [])

  if (!open) return null

  const isEmpty = entries.length === 0 && !isLoading && !error
  const isInitialLoading = entries.length === 0 && isLoading
  const titleKey = entityType === 'company'
    ? 'customers.timeline.companyTitle'
    : 'customers.timeline.personTitle'
  const title = t(titleKey, 'Customer Timeline')

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        className="fixed right-0 top-0 z-50 h-full w-full max-w-2xl border-l bg-background shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <ListTodo className="h-5 w-5" />
              <h2 className="font-semibold">{title}</h2>
            </div>
            <div className="flex items-center gap-2">
              <DealFilterDropdown
                deals={deals}
                selectedDealId={selectedDealId}
                onChange={handleDealFilterChange}
                t={t}
              />
              <FilterDropdown selected={filterKinds} onChange={handleFilterChange} t={t} />
              <IconButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                aria-label={t('customers.timeline.close', 'Close')}
              >
                <X className="size-4" />
              </IconButton>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {isInitialLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="mb-2 h-8 w-8 animate-spin" />
                <p>{t('customers.timeline.loading', 'Loading timeline...')}</p>
              </div>
            ) : null}

            {error && entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                <p>{error}</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => loadTimeline(null, false)}>
                  {t('customers.timeline.retry', 'Retry')}
                </Button>
              </div>
            ) : null}

            {isEmpty ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <ListTodo className="mb-2 h-8 w-8 opacity-50" />
                <p>{t('customers.timeline.empty', 'No activity recorded yet.')}</p>
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
                    dealBadge={entry.dealContext ? (
                      <Link
                        href={`/backend/customers/deals/${entry.dealContext.dealId}`}
                        className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50 transition-colors shrink-0"
                      >
                        {entry.dealContext.dealTitle}
                      </Link>
                    ) : null}
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
                  {t('customers.timeline.loadMore', 'Load more')}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
}
