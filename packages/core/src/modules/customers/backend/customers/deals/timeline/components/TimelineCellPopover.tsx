"use client"

import * as React from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import type { DealTimelineCellResponse, DealTimelineItem } from '../../../../../lib/dealsTimelineTypes'
import {
  formatTimelineDate,
  formatTimelineValue,
  isTimelineDealOverdue,
  timelineClosedKind,
  timelineClosedLabel,
} from './TimelineDealCard'
import { TIMELINE_QUERY_ROOT } from './useRescheduleDeal'
import { formatTimelineDealCount } from './TimelineLane'

const CELL_PAGE_SIZE = 50
export const MAX_REVEAL_PAGES = 20

export type TimelineCellPopoverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  laneKey: string
  laneLabel: string
  column: number
  columnLabel: string
  baseParams: string
  todayKey: string
  focusDealId?: string | null
  onOpenDeal: (item: DealTimelineItem, element: HTMLElement) => void
  children: React.ReactNode
}

export function TimelineCellPopover({
  open,
  onOpenChange,
  laneKey,
  laneLabel,
  column,
  columnLabel,
  baseParams,
  todayKey,
  focusDealId,
  onOpenDeal,
  children,
}: TimelineCellPopoverProps): React.ReactElement {
  const t = useT()
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const listRef = React.useRef<HTMLUListElement | null>(null)
  const errorRef = React.useRef<HTMLParagraphElement | null>(null)
  const query = useInfiniteQuery({
    queryKey: [...TIMELINE_QUERY_ROOT, 'cell', `scope:${scopeVersion}`, baseParams, laneKey, column],
    enabled: open,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams(baseParams)
      params.set('cellLane', laneKey)
      params.set('cellColumn', String(column))
      params.set('page', String(pageParam))
      params.set('pageSize', String(CELL_PAGE_SIZE))
      return readApiResultOrThrow<DealTimelineCellResponse>(
        `/api/customers/deals/timeline?${params.toString()}`,
        undefined,
        {
          errorMessage: translateWithFallback(t, 'customers.deals.timeline.loadError', 'Failed to load the timeline.'),
        },
      )
    },
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  })

  const items = React.useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.items),
    [query.data],
  )
  const total = query.data?.pages[0]?.total ?? null
  const totalCapped = query.data?.pages[0]?.countsCapped === true

  const pageCount = query.data?.pages.length ?? 0
  const { hasNextPage, isError, isFetchingNextPage, isLoading, fetchNextPage } = query
  const focusedDealIdRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!open) {
      focusedDealIdRef.current = null
      return
    }
    if (!focusDealId || focusedDealIdRef.current === focusDealId || isLoading || isFetchingNextPage) return
    const target = listRef.current?.querySelector<HTMLElement>(`[data-popover-deal-id="${CSS.escape(focusDealId)}"]`)
    if (target) {
      focusedDealIdRef.current = focusDealId
      target.focus()
      return
    }
    if (hasNextPage && !isError && pageCount < MAX_REVEAL_PAGES) {
      void fetchNextPage()
      return
    }
    focusedDealIdRef.current = focusDealId
    const fallback = listRef.current ?? errorRef.current
    fallback?.focus()
  }, [fetchNextPage, focusDealId, hasNextPage, isError, isFetchingNextPage, isLoading, items, open, pageCount])

  const title = translateWithFallback(t, 'customers.deals.timeline.cell.popoverTitle', '{lane} · {column}', {
    lane: laneLabel,
    column: columnLabel,
  })

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="truncate text-sm font-semibold text-foreground">{title}</span>
          {total !== null ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatTimelineDealCount(t, locale, total, totalCapped)}
            </span>
          ) : null}
        </div>
        {query.isLoading ? (
          <div className="flex items-center justify-center p-4">
            <Spinner />
          </div>
        ) : query.isError && items.length === 0 ? (
          <p ref={errorRef} tabIndex={-1} role="alert" className="p-3 text-sm text-status-error-text">
            {translateWithFallback(t, 'customers.deals.timeline.loadError', 'Failed to load the timeline.')}
          </p>
        ) : (
          <ul ref={listRef} tabIndex={-1} className="flex max-h-80 flex-col overflow-y-auto p-1">
            {items.map((item) => {
              const overdue = isTimelineDealOverdue(item, todayKey)
              const closed = timelineClosedKind(item.status)
              const value = formatTimelineValue(item.valueAmount, item.valueCurrency, locale)
              return (
                <li key={item.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    data-popover-deal-id={item.id}
                    className="flex h-auto w-full flex-col items-stretch gap-0.5 px-2 py-1.5 text-left"
                    onClick={(event) => onOpenDeal(item, event.currentTarget)}
                  >
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.title || translateWithFallback(t, 'customers.deals.pipeline.untitled', 'Untitled deal')}
                    </span>
                    <span className="flex items-center justify-between gap-2 text-xs font-normal text-muted-foreground">
                      <span className="truncate">{[item.primaryCompany?.label, value].filter(Boolean).join(' · ')}</span>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 ${overdue ? 'text-status-error-text' : ''}`}
                      >
                        {overdue ? <AlertTriangle className="size-3" aria-hidden="true" /> : null}
                        {closed ? `${timelineClosedLabel(t, closed)} · ` : ''}
                        {formatTimelineDate(item.expectedCloseAt, locale) ?? ''}
                      </span>
                    </span>
                  </Button>
                </li>
              )
            })}
            {query.isError ? (
              <li role="alert" className="px-2 py-1.5 text-sm text-status-error-text">
                {translateWithFallback(t, 'customers.deals.timeline.loadError', 'Failed to load the timeline.')}
              </li>
            ) : null}
            {query.hasNextPage ? (
              <li className="p-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {translateWithFallback(t, 'customers.deals.timeline.cell.loadMore', 'Load more')}
                </Button>
              </li>
            ) : null}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
