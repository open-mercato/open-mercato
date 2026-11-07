"use client"

import * as React from 'react'
import {
  Calendar,
  CalendarDays,
  CalendarX,
  CheckSquare,
  Clock,
  Globe,
  Mail,
  MapPin,
  Maximize2,
  Notebook,
  Pencil,
  PhoneCall,
  Repeat,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import { formatTimeRange, readableTypeColor } from './EventBlock'
import type { CalendarCategory, CalendarItem, CalendarPlatform } from './types'

const PLATFORM_FULL_LABELS: Record<CalendarPlatform, { key: string; fallback: string }> = {
  zoom: { key: 'customers.calendar.platformFull.zoom', fallback: 'Zoom' },
  meet: { key: 'customers.calendar.platformFull.meet', fallback: 'Google Meet' },
  slack: { key: 'customers.calendar.platformFull.slack', fallback: 'Slack' },
  teams: { key: 'customers.calendar.platformFull.teams', fallback: 'Microsoft Teams' },
}

const CATEGORY_ICONS: Record<CalendarCategory, LucideIcon> = {
  meeting: Users,
  event: Calendar,
  task: CheckSquare,
  other: CalendarDays,
}

const TYPE_FALLBACK_ICONS: Record<string, LucideIcon> = {
  call: PhoneCall,
  email: Mail,
  note: Notebook,
}

const MAX_VISIBLE_AVATARS = 3

/** Dictionary icon of the interaction type (`lucide:*`), falling back to the category icon. */
export function resolveEventTypeIcon(item: CalendarItem, typeIcon: string | null | undefined): LucideIcon {
  return (
    resolveRegisteredLucideIcon(typeIcon ?? undefined) ??
    TYPE_FALLBACK_ICONS[item.interactionType] ??
    CATEGORY_ICONS[item.category]
  )
}

function participantLabel(participant: CalendarItem['participants'][number]): string {
  return participant.name ?? participant.email ?? '?'
}

export type EventPeekPopoverProps = {
  item: CalendarItem
  open: boolean
  joinUrl: string | null
  /** Shows the platform and attendee rows. Join stays available either way. */
  aiSummaries?: boolean
  canManage?: boolean
  side?: React.ComponentProps<typeof PopoverContent>['side']
  /** Dictionary icon name for the item's interaction type (`lucide:*`). */
  typeIcon?: string | null
  onOpenChange(open: boolean): void
  onJoin(item: CalendarItem): void
  onEdit(item: CalendarItem): void
  /** Cancels the event in place; offered for planned events only. */
  onCancel?(item: CalendarItem): void | Promise<void>
  children: React.ReactNode
}

type MetaRowProps = { icon: LucideIcon; children: React.ReactNode }

function MetaRow({ icon: Icon, children }: MetaRowProps) {
  return (
    <li className="flex items-start gap-3 text-xs leading-5 text-foreground">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">{children}</span>
    </li>
  )
}

export function EventPeekPopover({
  item,
  open,
  joinUrl,
  aiSummaries = true,
  canManage = true,
  side = 'right',
  typeIcon,
  onOpenChange,
  onJoin,
  onEdit,
  onCancel,
  children,
}: EventPeekPopoverProps) {
  const t = useT()
  const locale = useLocale()
  const title = item.title || t('customers.calendar.grid.untitled', 'Untitled')
  const dateLabel = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(item.start),
    [locale, item.start],
  )
  const timeRange = item.allDay
    ? t('customers.calendar.grid.allDay', 'All day')
    : formatTimeRange(locale, item.start, item.end)
  const TypeIcon = resolveEventTypeIcon(item, typeIcon)

  const attendeeCount = item.participants.length
  const attendeesLabel =
    attendeeCount === 1
      ? t('customers.calendar.peek.attendee', '1 attendee')
      : t('customers.calendar.peek.attendees', '{count} attendees', { count: attendeeCount })

  const locationRow = (() => {
    if (!item.location || !item.locationKind) return null
    if (item.locationKind === 'platform' && item.platform) {
      if (!aiSummaries) return null
      const platform = PLATFORM_FULL_LABELS[item.platform]
      return { icon: Video, label: t(platform.key, platform.fallback) }
    }
    if (item.locationKind === 'url') return { icon: Globe, label: item.location }
    return { icon: MapPin, label: item.location }
  })()

  const showJoin = Boolean(joinUrl)
  const canCancel = canManage && Boolean(onCancel) && item.status === 'planned'
  const editLabel = t('customers.calendar.peek.edit', 'Edit')

  const close = () => onOpenChange(false)

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" side={side} sideOffset={8} className="w-80 p-0">
        <div className="flex items-start gap-3 px-4 pb-3 pt-4">
          <span
            aria-hidden
            className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted', !item.color && 'text-muted-foreground')}
            style={item.color ? { color: readableTypeColor(item.color), backgroundColor: `color-mix(in srgb, ${item.color} 18%, transparent)` } : undefined}
          >
            <TypeIcon className="size-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className={cn('text-sm font-semibold leading-5 text-foreground', item.status === 'canceled' && 'line-through text-muted-foreground')}>
              {title}
            </p>
            {item.status === 'canceled' ? (
              <StatusBadge variant="neutral" dot>{t('customers.calendar.peek.canceled', 'Canceled')}</StatusBadge>
            ) : item.status === 'done' ? (
              <StatusBadge variant="success" dot>{t('customers.calendar.peek.done', 'Done')}</StatusBadge>
            ) : null}
          </div>
          {canManage ? (
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t('customers.calendar.peek.open', 'Open event')}
              onClick={() => {
                close()
                onEdit(item)
              }}
            >
              <Maximize2 aria-hidden />
            </IconButton>
          ) : null}
        </div>

        {showJoin ? (
          <div className="px-4 pb-3">
            <Button type="button" size="sm" onClick={() => onJoin(item)}>
              <Video className="size-4" aria-hidden />
              {t('customers.calendar.peek.join', 'Join')}
            </Button>
          </div>
        ) : null}

        <ul className="flex flex-col gap-2 border-t border-border px-4 py-3">
          <MetaRow icon={Clock}>
            <span>{dateLabel}</span>
            <span>{timeRange}</span>
            {item.isRecurringOccurrence ? (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Repeat className="size-3.5" aria-hidden />
                {t('customers.calendar.peek.series', 'Series')}
              </span>
            ) : null}
          </MetaRow>
          {locationRow ? (
            <MetaRow icon={locationRow.icon}>
              <span className="truncate">{locationRow.label}</span>
            </MetaRow>
          ) : null}
          {aiSummaries && attendeeCount > 0 ? (
            <MetaRow icon={Users}>
              <AvatarStack size="xs" max={MAX_VISIBLE_AVATARS} className="shrink-0 gap-px [&>*:not(:first-child)]:-ml-1">
                {item.participants.slice(0, MAX_VISIBLE_AVATARS).map((participant, index) => (
                  <Avatar key={participant.userId ?? participant.email ?? index} size="xs" label={participantLabel(participant)} />
                ))}
              </AvatarStack>
              <span className="text-muted-foreground">{attendeesLabel}</span>
            </MetaRow>
          ) : null}
        </ul>

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          {canManage ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                close()
                onEdit(item)
              }}
            >
              <Pencil className="size-4" aria-hidden />
              {editLabel}
            </Button>
          ) : (
            <SimpleTooltip content={t('customers.calendar.peek.editForbidden', "You don't have permission to edit events")}>
              <span className="inline-flex">
                <Button type="button" size="sm" variant="outline" disabled className="pointer-events-none">
                  <Pencil className="size-4" aria-hidden />
                  {editLabel}
                </Button>
              </span>
            </SimpleTooltip>
          )}
          {canCancel ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => {
                close()
                void onCancel?.(item)
              }}
            >
              <CalendarX className="size-4" aria-hidden />
              {t('customers.calendar.peek.cancel', 'Cancel event')}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
