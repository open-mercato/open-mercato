'use client'
import * as React from 'react'
import { Phone, Mail, Handshake, StickyNote, Pin, PinOff } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import type { InteractionSummary } from './types'

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  meeting: Handshake,
  note: StickyNote,
}

interface ActivityTimelineProps {
  activities: InteractionSummary[]
  onPin: (id: string, pinned: boolean) => void
}

export function ActivityTimeline({ activities, onPin }: ActivityTimelineProps) {
  const t = useT()

  const pinned = activities.filter((a) => a.pinned)
  const unpinned = activities.filter((a) => !a.pinned)

  const groupedByYear = React.useMemo(() => {
    const groups: Array<{ year: number; items: InteractionSummary[] }> = []
    let currentYear: number | null = null
    let currentGroup: InteractionSummary[] = []

    for (const activity of unpinned) {
      const dateStr = activity.occurredAt ?? activity.createdAt
      const year = new Date(dateStr).getFullYear()
      if (currentYear !== null && year !== currentYear) {
        groups.push({ year: currentYear, items: currentGroup })
        currentGroup = []
      }
      currentYear = year
      currentGroup.push(activity)
    }
    if (currentYear !== null && currentGroup.length > 0) {
      groups.push({ year: currentYear, items: currentGroup })
    }
    return groups
  }, [unpinned])

  if (activities.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        {t('customers.timeline.empty', 'No activities match the current filters.')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {pinned.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground px-1">
            <Pin className="size-3" />
            {t('customers.timeline.pinned', 'Pinned')}
          </div>
          {pinned.map((activity) => (
            <TimelineEntry key={activity.id} activity={activity} onPin={onPin} t={t} />
          ))}
        </div>
      )}

      {groupedByYear.map(({ year, items }) => (
        <div key={year} className="space-y-1">
          <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b py-1 px-1">
            <span className="text-xs font-medium text-muted-foreground">{year}</span>
          </div>
          {items.map((activity) => (
            <TimelineEntry key={activity.id} activity={activity} onPin={onPin} t={t} />
          ))}
        </div>
      ))}
    </div>
  )
}

function TimelineEntry({
  activity,
  onPin,
  t,
}: {
  activity: InteractionSummary
  onPin: (id: string, pinned: boolean) => void
  t: (key: string, fallback?: string) => string
}) {
  const dateStr = activity.occurredAt ?? activity.createdAt
  const TypeIcon = TYPE_ICONS[activity.interactionType]

  return (
    <div className="group flex items-start gap-3 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <span className="text-xs text-muted-foreground min-w-[60px] pt-0.5 shrink-0">
        {formatShortDate(dateStr)}
      </span>
      <div className="flex items-center justify-center size-5 rounded-full bg-muted shrink-0 mt-0.5">
        {TypeIcon ? <TypeIcon className="size-3 text-muted-foreground" /> : null}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-sm truncate block">
          {activity.title ?? activity.body ?? activity.interactionType}
        </span>
        {activity.authorName && (
          <span className="text-xs text-muted-foreground">{activity.authorName}</span>
        )}
      </div>
      <IconButton
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => onPin(activity.id, !activity.pinned)}
        aria-label={activity.pinned ? t('customers.timeline.unpin', 'Unpin') : t('customers.timeline.pin', 'Pin')}
        className={cn(
          'opacity-0 group-hover:opacity-100 transition-opacity',
          activity.pinned && 'opacity-100 text-primary',
        )}
      >
        {activity.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
      </IconButton>
    </div>
  )
}

function formatShortDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}
