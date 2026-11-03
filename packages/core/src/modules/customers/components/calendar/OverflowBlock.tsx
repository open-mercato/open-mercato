"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Video } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { formatTimeRange, readableTypeColor, resolveEventTone } from './EventBlock'
import { EventPeekPopover, resolveEventTypeIcon } from './EventPeekPopover'
import type { CalendarItem } from './types'

const HEADER_HEIGHT_PX = 24
const ROW_HEIGHT_PX = 18
const STACK_EDGE_HEIGHT_PX = 8

export type OverflowBlockProps = {
  items: CalendarItem[]
  start: Date
  end: Date
  top: number
  height: number
  insetInlineStart: string
  width: string
  open: boolean
  conflictIds: Set<string>
  showConflicts: boolean
  highlightItemId?: string | null
  typeIcons?: Record<string, string | null>
  canManage: boolean
  aiSummaries?: boolean
  nowMs: number
  resolveJoinUrl(location: string | null): string | null
  onOpenChange(open: boolean): void
  onJoin(item: CalendarItem): void
  /** Opens the event editor for a listed meeting. A row is that action directly; a viewer's row opens the peek instead. */
  onEdit(item: CalendarItem): void
}

type TypeIconProps = { item: CalendarItem; typeIcons?: Record<string, string | null>; className?: string }

/** Dictionary icon of the interaction type in its color: names the kind of event, not just its hue. */
function TypeIcon({ item, typeIcons, className }: TypeIconProps) {
  const Icon = resolveEventTypeIcon(item, typeIcons?.[item.interactionType])
  return (
    <Icon
      aria-hidden
      className={cn('shrink-0', !item.color && 'text-muted-foreground', className)}
      style={item.color ? { color: readableTypeColor(item.color) } : undefined}
    />
  )
}

export function OverflowBlock({
  items,
  start,
  end,
  top,
  height,
  insetInlineStart,
  width,
  open,
  conflictIds,
  showConflicts,
  highlightItemId,
  typeIcons,
  canManage,
  aiSummaries = false,
  nowMs,
  resolveJoinUrl,
  onOpenChange,
  onJoin,
  onEdit,
}: OverflowBlockProps) {
  const t = useT()
  const locale = useLocale()
  const count = items.length
  const rangeLabel = formatTimeRange(locale, start, end)
  const conflicted = showConflicts && items.some((item) => conflictIds.has(item.id))
  const highlighted = Boolean(highlightItemId) && items.some((item) => item.id === highlightItemId)
  const untitled = t('customers.calendar.grid.untitled', 'Untitled')
  // Rows that fit under the "+N more" header; the rest stays behind the disclosure.
  const visibleRows = Math.max(0, Math.floor((height - HEADER_HEIGHT_PX - STACK_EDGE_HEIGHT_PX) / ROW_HEIGHT_PX))
  const previewItems = items.slice(0, visibleRows)
  const [peekItemId, setPeekItemId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) setPeekItemId(null)
  }, [open])

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('customers.calendar.grid.overflowAria', '{count} more events, {range}', {
            count,
            range: rangeLabel,
          })}
          className={cn(
            'pointer-events-auto absolute h-auto flex-col items-start justify-start gap-0.5 overflow-hidden rounded-md border border-border bg-muted px-2 pt-1 pb-2 text-start outline-none hover:border-foreground/30',
            conflicted && 'ring-1 ring-status-warning-icon',
            open && 'z-30 shadow-md ring-2 ring-primary/40',
            highlighted && 'motion-safe:animate-pulse',
            conflicted || highlighted || open ? 'z-30' : 'z-10',
            'focus-visible:z-30',
          )}
          style={{ top, height, insetInlineStart, width }}
        >
          <span className="w-full truncate text-xs font-semibold leading-4 text-foreground">
            {t('customers.calendar.grid.more', '+{count} more', { count })}
          </span>
          {previewItems.map((item) => (
            <span key={item.id} className="flex w-full min-w-0 items-center gap-1.5">
              <TypeIcon item={item} typeIcons={typeIcons} className="size-3" />
              <span className={cn('min-w-0 flex-1 truncate text-overline leading-4', resolveEventTone(item, nowMs).subClassName)}>
                {item.title || untitled}
              </span>
            </span>
          ))}
          <span aria-hidden className="pointer-events-none absolute inset-x-1.5 bottom-1 h-px bg-border" />
          <span aria-hidden className="pointer-events-none absolute inset-x-3 bottom-0.5 h-px bg-border" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" sideOffset={8} className="w-72 p-2">
        <p className="px-2 text-sm font-semibold leading-5 text-foreground">
          {t('customers.calendar.grid.overflowTitle', '{count} overlapping events', { count })}
        </p>
        <p className="px-2 pb-2 text-xs leading-4 text-muted-foreground">{rangeLabel}</p>
        <ul className="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
          {items.map((item) => {
            const rowTone = resolveEventTone(item, nowMs)
            const title = item.title || untitled
            const timeRange = formatTimeRange(locale, item.start, item.end)
            const joinUrl = resolveJoinUrl(item.location)
            const rowClassName = cn(
              'flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-start',
              showConflicts && conflictIds.has(item.id) && 'ring-1 ring-status-warning-icon',
            )
            const rowContent = (
              <>
                <span className="flex w-full min-w-0 items-start gap-2">
                  <span className="flex h-4 shrink-0 items-center">
                    <TypeIcon item={item} typeIcons={typeIcons} className="size-3.5" />
                  </span>
                  <span className={cn('min-w-0 flex-1 break-words text-xs font-medium leading-4', rowTone.titleClassName)}>
                    {title}
                  </span>
                </span>
                <span className={cn('ps-5 text-overline tracking-wide', rowTone.subClassName)}>{timeRange}</span>
              </>
            )
            return (
              <li key={item.id} className="flex items-stretch gap-1">
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`${title}, ${timeRange}`}
                    className={cn('h-auto whitespace-normal', rowClassName)}
                    onClick={() => {
                      onOpenChange(false)
                      onEdit(item)
                    }}
                  >
                    {rowContent}
                  </Button>
                ) : (
                  <EventPeekPopover
                    item={item}
                    open={peekItemId === item.id}
                    joinUrl={joinUrl}
                    aiSummaries={aiSummaries}
                    canManage={false}
                    typeIcon={typeIcons?.[item.interactionType]}
                    onOpenChange={(next) => setPeekItemId(next ? item.id : null)}
                    onJoin={onJoin}
                    onEdit={onEdit}
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`${title}, ${timeRange}`}
                      className={cn('h-auto whitespace-normal', rowClassName)}
                    >
                      {rowContent}
                    </Button>
                  </EventPeekPopover>
                )}
                {joinUrl ? (
                  <IconButton
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`${t('customers.calendar.peek.join', 'Join')}: ${title}`}
                    className="self-center"
                    onClick={() => onJoin(item)}
                  >
                    <Video aria-hidden />
                  </IconButton>
                ) : null}
              </li>
            )
          })}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
