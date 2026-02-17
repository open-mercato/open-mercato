"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { renderDictionaryColor, renderDictionaryIcon } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import { formatDateTime } from '@open-mercato/ui/backend/detail/ActivitiesSection'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'

type TimelineItemHeaderProps = {
  title: React.ReactNode
  subtitle?: React.ReactNode
  timestamp?: string | Date | null
  fallbackTimestampLabel?: React.ReactNode
  icon?: string | null
  color?: string | null
  iconSize?: 'sm' | 'md'
  className?: string
}

const ICON_WRAPPER_SIZES: Record<'sm' | 'md', string> = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
}

const ICON_SIZES: Record<'sm' | 'md', string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
}

export function TimelineItemHeader({
  title,
  subtitle,
  timestamp,
  fallbackTimestampLabel,
  icon,
  color,
  iconSize = 'md',
  className,
}: TimelineItemHeaderProps) {
  const wrapperSize = ICON_WRAPPER_SIZES[iconSize]
  const iconSizeClass = ICON_SIZES[iconSize]
  const resolvedTimestamp = React.useMemo(() => {
    if (subtitle) return subtitle
    if (!timestamp) return fallbackTimestampLabel ?? null
    const value = typeof timestamp === 'string' ? timestamp : timestamp.toISOString()
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return fallbackTimestampLabel ?? null
    const now = Date.now()
    const diff = Math.abs(now - date.getTime())
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
    const relativeLabel = diff <= THIRTY_DAYS_MS ? formatRelativeTime(value) : null
    const absoluteLabel = formatDateTime(value)
    if (relativeLabel) {
      return (
        <span title={absoluteLabel ?? undefined}>
          {relativeLabel}
        </span>
      )
    }
    return absoluteLabel ?? fallbackTimestampLabel ?? null
  }, [fallbackTimestampLabel, subtitle, timestamp])

  return (
    <div className={cn('flex items-start gap-3', className)}>
      {icon ? (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded border border-border bg-muted/40',
            wrapperSize,
          )}
        >
          {renderDictionaryIcon(icon, iconSizeClass)}
        </span>
      ) : null}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {color ? renderDictionaryColor(color, 'h-3 w-3 rounded-full border border-border') : null}
        </div>
        {resolvedTimestamp ? <div className="text-xs text-muted-foreground">{resolvedTimestamp}</div> : null}
      </div>
    </div>
  )
}
