"use client"

import * as React from 'react'
import { Globe, MapPin } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Avatar, AvatarStack } from '@open-mercato/ui/primitives/avatar'
import { Button } from '@open-mercato/ui/primitives/button'
import { formatTimeRangeLabel } from '../../lib/calendar/format'
import type { CalendarItem, CalendarPlatform } from './types'

const SHOW_TIME_MIN_HEIGHT_PX = 44
const SHOW_META_MIN_HEIGHT_PX = 96
const WRAP_TITLE_MIN_HEIGHT_PX = 128
const MAX_VISIBLE_AVATARS = 3

const PLATFORM_LABELS: Record<CalendarPlatform, { key: string; fallback: string }> = {
  zoom: { key: 'customers.calendar.platform.zoom', fallback: 'Zoom' },
  meet: { key: 'customers.calendar.platform.meet', fallback: 'Meet' },
  slack: { key: 'customers.calendar.platform.slack', fallback: 'Slack' },
  teams: { key: 'customers.calendar.platform.teams', fallback: 'Teams' },
}

export type EventTone = {
  surfaceClassName: string
  titleClassName: string
  subClassName: string
  style?: React.CSSProperties
}

function softTintStyle(color: string): React.CSSProperties {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return { backgroundColor: `${color}1A` }
  return { backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)` }
}

export function resolveEventTone(item: CalendarItem, nowMs: number): EventTone {
  if (item.status === 'canceled') {
    return {
      surfaceClassName: 'bg-muted/60',
      titleClassName: 'text-muted-foreground line-through',
      subClassName: 'text-muted-foreground/70',
    }
  }
  if (item.status === 'done' || item.end.getTime() < nowMs) {
    return {
      surfaceClassName: 'bg-muted',
      titleClassName: 'text-muted-foreground',
      subClassName: 'text-muted-foreground',
    }
  }
  if (item.color) {
    return {
      surfaceClassName: '',
      titleClassName: 'text-foreground',
      subClassName: 'text-muted-foreground',
      style: softTintStyle(item.color),
    }
  }
  return {
    surfaceClassName: 'bg-muted/60',
    titleClassName: 'text-foreground',
    subClassName: 'text-muted-foreground',
  }
}

export function formatTimeRange(locale: string, start: Date, end: Date): string {
  return formatTimeRangeLabel(locale, start, end)
}

function participantLabel(participant: CalendarItem['participants'][number]): string {
  return participant.name ?? participant.email ?? '?'
}

type LocationMetaProps = {
  item: CalendarItem
  subClassName: string
  accentColor: string | null
}

function LocationMeta({ item, subClassName, accentColor }: LocationMetaProps) {
  const t = useT()
  if (!item.location || !item.locationKind) return null
  const iconStyle = accentColor ? { color: accentColor } : undefined
  if (item.locationKind === 'platform' && item.platform) {
    const platform = PLATFORM_LABELS[item.platform]
    return (
      <span className={cn('truncate text-xs', subClassName)}>
        {t('customers.calendar.grid.onPlatform', 'on {platform}', { platform: t(platform.key, platform.fallback) })}
      </span>
    )
  }
  if (item.locationKind === 'url') {
    return (
      <>
        <Globe className={cn('size-4 shrink-0', !accentColor && subClassName)} style={iconStyle} aria-hidden />
        <span className="truncate text-xs text-foreground">{item.location}</span>
      </>
    )
  }
  return (
    <>
      <MapPin className={cn('size-4 shrink-0', !accentColor && subClassName)} style={iconStyle} aria-hidden />
      <span className="truncate text-xs text-foreground">
        {t('customers.calendar.grid.venue', 'Venue: {name}', { name: item.location })}
      </span>
    </>
  )
}

export type EventBlockProps = {
  item: CalendarItem
  top: number
  height: number
  insetInlineStart: string
  width: string
  conflicted: boolean
  highlighted: boolean
  selected?: boolean
  nowMs: number
} & Omit<React.ComponentProps<typeof Button>, 'style' | 'children'>

export const EventBlock = React.forwardRef<HTMLButtonElement, EventBlockProps>(function EventBlock(
  {
    item,
    top,
    height,
    insetInlineStart,
    width,
    conflicted,
    highlighted,
    selected,
    nowMs,
    className,
    ...buttonProps
  },
  ref,
) {
  const t = useT()
  const locale = useLocale()
  const tone = resolveEventTone(item, nowMs)
  const title = item.title || t('customers.calendar.grid.untitled', 'Untitled')
  const timeRange = formatTimeRange(locale, item.start, item.end)
  const showTime = height >= SHOW_TIME_MIN_HEIGHT_PX
  const wrapTitle = height >= WRAP_TITLE_MIN_HEIGHT_PX
  const hasMetaContent = item.participants.length > 0 || (item.location !== null && item.locationKind !== null)
  const showMeta = height >= SHOW_META_MIN_HEIGHT_PX && hasMetaContent
  const visibleParticipants = item.participants.slice(0, MAX_VISIBLE_AVATARS)
  const overflowCount = item.participants.length - visibleParticipants.length

  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      aria-label={`${title}, ${timeRange}`}
      className={cn(
        'pointer-events-auto absolute h-auto flex-col items-start justify-start gap-1 whitespace-normal overflow-hidden rounded-md px-1.5 text-start outline-none hover:bg-muted/70 sm:px-3',
        height >= SHOW_TIME_MIN_HEIGHT_PX ? 'py-1 sm:py-2' : 'py-0.5 sm:py-1',
        tone.surfaceClassName,
        conflicted && 'ring-1 ring-status-warning-icon',
        selected && 'shadow-md ring-2 ring-foreground',
        highlighted && 'motion-safe:animate-pulse',
        conflicted || highlighted || selected ? 'z-30' : 'z-10',
        'focus-visible:z-30 focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      style={{ top, height, insetInlineStart, width, ...tone.style }}
      {...buttonProps}
    >
      <span className={cn('w-full text-xs font-medium leading-4', wrapTitle ? 'line-clamp-2' : 'truncate', tone.titleClassName)}>
        {title}
      </span>
      {showTime ? (
        <span className={cn('w-full truncate text-overline uppercase tracking-wide', tone.subClassName)}>
          {timeRange}
        </span>
      ) : null}
      {showMeta ? (
        <span className="mt-auto flex w-full min-w-0 items-center gap-1.5">
          {visibleParticipants.length > 0 ? (
            <>
              <AvatarStack size="xs" max={MAX_VISIBLE_AVATARS} className="shrink-0 gap-px [&>*:not(:first-child)]:-ml-1">
                {visibleParticipants.map((participant) => (
                  <Avatar key={participant.userId} size="xs" label={participantLabel(participant)} />
                ))}
              </AvatarStack>
              {overflowCount > 0 ? (
                <span className={cn('shrink-0 text-xs', tone.subClassName)}>+{overflowCount}</span>
              ) : null}
            </>
          ) : null}
          <span className="ms-auto flex min-w-0 items-center gap-1.5">
            <LocationMeta item={item} subClassName={tone.subClassName} accentColor={item.color} />
          </span>
        </span>
      ) : null}
    </Button>
  )
})

EventBlock.displayName = 'EventBlock'
