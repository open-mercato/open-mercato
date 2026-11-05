"use client"

import * as React from 'react'
import { useDraggable } from '@dnd-kit/core'
import { AlertTriangle, Calendar } from 'lucide-react'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { formatCurrency } from '../../../../../components/detail/utils'
import { isLostDealStatus, isOpenDealStatus, isWonDealStatus } from '../../../../../lib/dealStatus'
import { compareDateKeys, toUtcDateKey } from '../../../../../lib/dealsTimeline'
import type { DealTimelineItem } from '../../../../../lib/dealsTimelineTypes'

type Translator = ReturnType<typeof useT>

const utcDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatTimelineDate(value: string | null | undefined): string | null {
  const key = toUtcDateKey(value ?? null)
  if (!key) return null
  return utcDateFormatter.format(new Date(`${key}T00:00:00.000Z`))
}

export function formatTimelineValue(amount: number | null, currency: string | null): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  if (currency) return formatCurrency(amount, currency)
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(amount)
}

export function isTimelineDealOverdue(item: Pick<DealTimelineItem, 'status' | 'expectedCloseAt'>, todayKey: string): boolean {
  if (!isOpenDealStatus(item.status?.toLowerCase())) return false
  const key = toUtcDateKey(item.expectedCloseAt)
  return !!key && compareDateKeys(key, todayKey) < 0
}

export type TimelineClosedKind = 'won' | 'lost' | 'closed'

export function timelineClosedKind(status: string | null): TimelineClosedKind | null {
  const normalized = status?.toLowerCase()
  if (isWonDealStatus(normalized)) return 'won'
  if (isLostDealStatus(normalized)) return 'lost'
  if (!isOpenDealStatus(normalized)) return 'closed'
  return null
}

export function timelineClosedLabel(t: Translator, kind: TimelineClosedKind): string {
  if (kind === 'won') return translateWithFallback(t, 'customers.deals.timeline.status.won', 'Won')
  if (kind === 'lost') return translateWithFallback(t, 'customers.deals.timeline.status.lost', 'Lost')
  return translateWithFallback(t, 'customers.deals.timeline.status.closed', 'Closed')
}

export function buildTimelineCardAriaLabel(
  t: Translator,
  item: DealTimelineItem,
  todayKey: string,
): string {
  const parts: string[] = []
  parts.push(item.title || translateWithFallback(t, 'customers.deals.pipeline.untitled', 'Untitled deal'))
  if (item.primaryCompany?.label) parts.push(item.primaryCompany.label)
  const value = formatTimelineValue(item.valueAmount, item.valueCurrency)
  if (value) parts.push(value)
  const date = formatTimelineDate(item.expectedCloseAt)
  if (date) {
    parts.push(translateWithFallback(t, 'customers.deals.timeline.card.closes', 'closes {date}', { date }))
  }
  if (isTimelineDealOverdue(item, todayKey)) {
    parts.push(translateWithFallback(t, 'customers.deals.timeline.card.overdue', 'overdue'))
  }
  const closed = timelineClosedKind(item.status)
  if (closed) parts.push(timelineClosedLabel(t, closed))
  return parts.join(', ')
}

function probabilityLabel(value: number | null): string | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null
  return `${Math.min(Math.max(Math.round(value), 0), 100)}%`
}

export type TimelineDealCardProps = {
  item: DealTimelineItem
  laneKey: string
  column: number
  todayKey: string
  accentClass: string
  ownerLabel?: string | null
  canDrag: boolean
  dragDisabledHint?: string | null
  canOpenInNewTab: boolean
  onOpen: (item: DealTimelineItem, element: HTMLElement) => void
}

function TimelineDealCardImpl({
  item,
  laneKey,
  column,
  todayKey,
  accentClass,
  ownerLabel,
  canDrag,
  dragDisabledHint,
  canOpenInNewTab,
  onOpen,
}: TimelineDealCardProps): React.ReactElement {
  const t = useT()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { type: 'timeline-deal', laneKey, column, item },
    disabled: !canDrag,
  })
  const overdue = isTimelineDealOverdue(item, todayKey)
  const closedKind = timelineClosedKind(item.status)
  const dateLabel = formatTimelineDate(item.expectedCloseAt)
  const valueLabel = formatTimelineValue(item.valueAmount, item.valueCurrency)
  const probability = probabilityLabel(item.probability)
  const ariaLabel = buildTimelineCardAriaLabel(t, item, todayKey)
  const title = item.title || translateWithFallback(t, 'customers.deals.pipeline.untitled', 'Untitled deal')

  const openInNewTab = () => {
    window.open(`/backend/customers/deals/${encodeURIComponent(item.id)}`, '_blank', 'noopener')
  }

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && canOpenInNewTab) {
      event.preventDefault()
      openInNewTab()
      return
    }
    onOpen(item, event.currentTarget)
  }

  const handleAuxClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 1 || !canOpenInNewTab) return
    event.preventDefault()
    openInNewTab()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && !isDragging) {
      event.preventDefault()
      onOpen(item, event.currentTarget)
      return
    }
    listeners?.onKeyDown?.(event)
  }

  const probabilityClass =
    typeof item.probability === 'number' && item.probability >= 70
      ? 'bg-muted text-foreground'
      : typeof item.probability === 'number' && item.probability >= 40
        ? 'bg-status-warning-bg text-status-warning-text'
        : 'bg-muted text-muted-foreground'

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-disabled={undefined}
      aria-label={ariaLabel}
      aria-roledescription={translateWithFallback(t, 'customers.deals.timeline.card.roledescription', 'deal card')}
      title={!canDrag && dragDisabledHint ? dragDisabledHint : undefined}
      data-timeline-card="true"
      data-deal-id={item.id}
      data-lane-key={laneKey}
      data-column={column}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
      className={`group relative flex min-h-18 w-full flex-col gap-1 overflow-hidden rounded-md border border-border bg-card py-2 pl-3 pr-2.5 text-left shadow-xs transition-shadow focus-visible:outline-none focus-visible:shadow-focus ${
        isDragging ? 'opacity-40' : 'hover:shadow-sm'
      } ${canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${closedKind ? 'opacity-70' : ''}`}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${accentClass}`} />
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{title}</span>
        {closedKind ? (
          <span
            className={`shrink-0 rounded-full px-1.5 py-px text-xs font-semibold leading-normal ${
              closedKind === 'won'
                ? 'bg-status-success-bg text-status-success-text'
                : 'bg-status-neutral-bg text-status-neutral-text'
            }`}
          >
            {timelineClosedLabel(t, closedKind)}
          </span>
        ) : probability ? (
          <span className={`shrink-0 rounded-full px-1.5 py-px text-xs font-semibold leading-normal ${probabilityClass}`}>
            {probability}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs leading-normal">
        <span className="whitespace-nowrap font-medium text-foreground">{valueLabel ?? '—'}</span>
        {dateLabel ? (
          <span
            className={`inline-flex shrink-0 items-center gap-1 ${
              overdue ? 'font-semibold text-status-error-text' : 'text-muted-foreground'
            }`}
          >
            {overdue ? (
              <AlertTriangle className="size-3" aria-hidden="true" />
            ) : (
              <Calendar className="size-3" aria-hidden="true" />
            )}
            {dateLabel}
          </span>
        ) : null}
      </div>
      {item.primaryCompany?.label || ownerLabel ? (
        <div className="flex items-center justify-between gap-2 text-xs leading-normal text-muted-foreground">
          <span className="truncate">{item.primaryCompany?.label ?? ''}</span>
          {ownerLabel ? <Avatar label={ownerLabel} size="xs" ariaLabel={ownerLabel} /> : null}
        </div>
      ) : null}
    </div>
  )
}

export const TimelineDealCard = React.memo(TimelineDealCardImpl)

export function TimelineDealCardPreview({
  item,
  todayKey,
  accentClass,
  hint,
}: {
  item: DealTimelineItem
  todayKey: string
  accentClass: string
  hint: string | null
}): React.ReactElement {
  const t = useT()
  const dateLabel = formatTimelineDate(item.expectedCloseAt)
  const overdue = isTimelineDealOverdue(item, todayKey)
  return (
    <div className="flex w-56 flex-col gap-1">
      <div className="relative flex flex-col gap-1 overflow-hidden rounded-md border border-accent-indigo bg-card py-2 pl-3 pr-2.5 shadow-md">
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${accentClass}`} />
        <span className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
          {item.title || translateWithFallback(t, 'customers.deals.pipeline.untitled', 'Untitled deal')}
        </span>
        {dateLabel ? (
          <span className={`text-xs ${overdue ? 'text-status-error-text' : 'text-muted-foreground'}`}>{dateLabel}</span>
        ) : null}
      </div>
      {hint ? (
        <span className="self-start rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md">
          {hint}
        </span>
      ) : null}
    </div>
  )
}
