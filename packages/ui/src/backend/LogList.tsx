"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@open-mercato/ui/primitives/accordion'
import { Badge, type BadgeProps } from '@open-mercato/ui/primitives/badge'

export type LogListLevel = 'info' | 'warn' | 'warning' | 'error' | 'debug' | string

export type LogListEntry = {
  id: string
  /** Pre-formatted timestamp (consumer formats with `formatDateTime()` / locale). */
  time: React.ReactNode
  /** Raw level value — drives the badge color via the built-in map. */
  level: LogListLevel
  /** Optional translated label override; falls back to `level` verbatim. */
  levelLabel?: React.ReactNode
  /** Trigger message (one-liner — truncates in the trigger row, full text available inside `body`). */
  message: React.ReactNode
  /** Body content rendered inside `AccordionContent` when expanded — typically a metadata grid + JSON payload. */
  body: React.ReactNode
}

type LogLevelBadgeVariant = NonNullable<BadgeProps['variant']>

const LOG_LEVEL_BADGE_VARIANT: Record<string, LogLevelBadgeVariant> = {
  info: 'info',
  warn: 'warning',
  warning: 'warning',
  error: 'error',
  debug: 'neutral',
}

export type LogLevelBadgeProps = {
  level: LogListLevel
  label?: React.ReactNode
  className?: string
}

export function LogLevelBadge({ level, label, className }: LogLevelBadgeProps) {
  const key = typeof level === 'string' ? level.toLowerCase() : ''
  const variant = LOG_LEVEL_BADGE_VARIANT[key] ?? 'secondary'
  return (
    <Badge variant={variant} className={className} data-log-level={key || undefined}>
      {label ?? level}
    </Badge>
  )
}

export type LogListProps = {
  entries: LogListEntry[]
  /** Optional message rendered when the list is empty. Pass through `useT()` for i18n. */
  emptyMessage?: React.ReactNode
  className?: string
}

/**
 * Unified `Accordion`-driven log list for admin "logs" tabs (integrations,
 * data sync runs, payment gateway transactions, …). Replaces the per-module
 * `<table>` + `expandedLogId` row-expand pattern with a Figma-aligned card
 * list that uses the DS `Accordion` primitive under the hood. Each row
 * shows time + level badge + message in the trigger; the consumer controls
 * the expanded body content (metadata grid, JSON payload, etc.).
 *
 * `type='single' collapsible` matches the previous "one expanded row at a
 * time" behaviour. Switch to `Accordion` directly if you need multi-open.
 */
export function LogList({ entries, emptyMessage, className }: LogListProps) {
  if (entries.length === 0) {
    return emptyMessage ? (
      <p className={cn('py-4 text-sm text-muted-foreground', className)} data-slot="log-list-empty">
        {emptyMessage}
      </p>
    ) : null
  }

  return (
    <Accordion
      type="single"
      collapsible
      className={cn('space-y-2', className)}
      data-slot="log-list"
    >
      {entries.map((entry) => (
        <AccordionItem key={entry.id} value={entry.id} data-log-entry-id={entry.id}>
          <AccordionTrigger triggerIcon="chevron">
            <span className="grid w-full items-center gap-3 sm:grid-cols-[10rem_5rem_minmax(0,1fr)]">
              <span className="truncate whitespace-nowrap text-xs text-muted-foreground sm:text-sm">
                {entry.time}
              </span>
              <span className="justify-self-start">
                <LogLevelBadge level={entry.level} label={entry.levelLabel} />
              </span>
              <span className="min-w-0 truncate text-left text-sm font-normal">
                {entry.message}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>{entry.body}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  )
}
