"use client"

import * as React from 'react'
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays'
import { format } from 'date-fns/format'
import { AlertTriangle, ChevronDown, Clock } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '@open-mercato/ui/primitives/popover'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CalendarItem, UpcomingCard, UpcomingCardsProps } from './types'

function formatTimeRange(item: CalendarItem, allDayLabel: string): string {
  if (item.allDay) return allDayLabel
  return `${format(item.start, 'h:mm a')} – ${format(item.end, 'h:mm a')}`
}

function canJoin(item: CalendarItem): boolean {
  return item.locationKind === 'url' || item.locationKind === 'platform'
}

type CardCallbacks = Pick<UpcomingCardsProps, 'canManage' | 'onJoin' | 'onSeeConflict' | 'onOpen' | 'onEdit' | 'onCancel'>

function UpcomingCardStatus({
  card,
  onJoin,
  onSeeConflict,
}: {
  card: UpcomingCard
  onJoin: UpcomingCardsProps['onJoin']
  onSeeConflict: UpcomingCardsProps['onSeeConflict']
}) {
  const t = useT()
  const { item, kind, conflictCount } = card

  if (kind === 'today') {
    return (
      <div className="flex w-full items-center gap-1.5 rounded-lg bg-status-success-bg py-2 pl-2 pr-3">
        <Clock className="size-4 shrink-0 text-status-success-icon" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {t('customers.calendar.cards.today', 'Today')}
        </span>
        {canJoin(item) ? (
          <LinkButton
            variant="gray"
            size="sm"
            underline="always"
            onClick={() => onJoin(item)}
            className="shrink-0"
          >
            {t('customers.calendar.cards.join', 'Join Meeting')}
          </LinkButton>
        ) : null}
      </div>
    )
  }

  if (kind === 'conflicted') {
    return (
      <div className="flex w-full items-center gap-1.5 rounded-lg bg-status-warning-bg py-2 pl-2 pr-3">
        <AlertTriangle className="size-4 shrink-0 text-status-warning-icon" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {t('customers.calendar.cards.conflictedCount', '{count} Conflicted', {
            count: conflictCount,
          })}
        </span>
        <LinkButton
          variant="gray"
          size="sm"
          underline="always"
          onClick={() => onSeeConflict(item)}
          className="shrink-0"
        >
          {t('customers.calendar.cards.seeConflict', 'See Conflict')}
        </LinkButton>
      </div>
    )
  }

  if (kind === 'cancelled') {
    return (
      <div className="flex w-full items-center gap-1.5 rounded-lg bg-status-error-bg py-2 pl-2 pr-3">
        <Clock className="size-4 shrink-0 text-status-error-icon" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {t('customers.calendar.cards.cancelled', 'Cancelled')}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {format(item.start, 'MMM dd, yyyy')}
        </span>
      </div>
    )
  }

  const daysLater = Math.max(0, differenceInCalendarDays(item.start, new Date()))
  return (
    <div className="flex w-full items-center gap-1.5 rounded-lg bg-muted py-2 pl-2 pr-3">
      <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {daysLater === 1
          ? t('customers.calendar.cards.dayLater', '1 day later')
          : t('customers.calendar.cards.daysLater', '{days} days later', { days: daysLater })}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {format(item.start, 'MMM dd, yyyy')}
      </span>
    </div>
  )
}

function UpcomingCardItem({
  card,
  canManage,
  onJoin,
  onSeeConflict,
  onOpen,
  onEdit,
  onCancel,
}: { card: UpcomingCard } & CardCallbacks) {
  const t = useT()
  const { item } = card

  return (
    <article className="flex w-[260px] shrink-0 snap-start flex-col gap-3 rounded-xl border bg-card px-2 pb-2 pt-4 shadow-xs sm:w-auto sm:shrink">
      <div className="flex items-start gap-2 px-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {formatTimeRange(item, t('customers.calendar.cards.allDay', 'All day'))}
          </p>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              variant="outline"
              size="xs"
              fullRadius
              aria-label={t('customers.calendar.cards.menu.label', 'Event actions')}
            >
              <ChevronDown aria-hidden="true" />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-40 min-w-0 p-1">
            <PopoverClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => onOpen(item)}
              >
                {t('customers.calendar.cards.menu.open', 'Open')}
              </Button>
            </PopoverClose>
            {canManage ? (
              <PopoverClose asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => onEdit(item)}
                >
                  {t('customers.calendar.cards.menu.edit', 'Edit')}
                </Button>
              </PopoverClose>
            ) : null}
            {canManage ? (
              <PopoverClose asChild>
                <Button
                  type="button"
                  variant="destructive-ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => onCancel(item)}
                >
                  {t('customers.calendar.cards.menu.cancel', 'Cancel')}
                </Button>
              </PopoverClose>
            ) : null}
          </PopoverContent>
        </Popover>
      </div>
      <UpcomingCardStatus card={card} onJoin={onJoin} onSeeConflict={onSeeConflict} />
    </article>
  )
}

export function UpcomingCards({
  cards,
  canManage = true,
  onJoin,
  onSeeConflict,
  onOpen,
  onEdit,
  onCancel,
}: UpcomingCardsProps) {
  if (cards.length === 0) return null
  return (
    <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:pb-0 xl:grid-cols-4">
      {cards.map((card) => (
        <UpcomingCardItem
          key={card.item.id}
          card={card}
          canManage={canManage}
          onJoin={onJoin}
          onSeeConflict={onSeeConflict}
          onOpen={onOpen}
          onEdit={onEdit}
          onCancel={onCancel}
        />
      ))}
    </div>
  )
}
