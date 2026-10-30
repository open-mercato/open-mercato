'use client'

import * as React from 'react'
import Link from 'next/link'
import { Mail, Phone, Star, MoreHorizontal, ArrowUpRight, Unlink } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { TableCell, TableRow } from '@open-mercato/ui/primitives/table'
import type { LinkedPersonSummary } from './LinkedPeopleSection'
import { formatDate, formatFallbackLabel } from './utils'

const temperatureConfig = {
  hot: { filled: 5, dotClassName: 'bg-status-error-icon', labelKey: 'customers.temperature.hot', fallback: 'Hot Client' },
  warm: { filled: 4, dotClassName: 'bg-status-warning-icon', labelKey: 'customers.temperature.warm', fallback: 'High Interest' },
  high: { filled: 4, dotClassName: 'bg-status-warning-icon', labelKey: 'customers.temperature.high', fallback: 'High Interest' },
  neutral: { filled: 3, dotClassName: 'bg-status-info-icon', labelKey: 'customers.temperature.neutral', fallback: 'Engaged' },
  medium: { filled: 3, dotClassName: 'bg-status-info-icon', labelKey: 'customers.temperature.medium', fallback: 'Engaged' },
  cool: { filled: 2, dotClassName: 'bg-status-neutral-icon', labelKey: 'customers.temperature.cool', fallback: 'Low Activity' },
  low: { filled: 2, dotClassName: 'bg-status-neutral-icon', labelKey: 'customers.temperature.low', fallback: 'Low Activity' },
  cold: { filled: 1, dotClassName: 'bg-status-neutral-icon', labelKey: 'customers.temperature.cold', fallback: 'At Risk' },
} as const

function splitSourceTags(source: string | null | undefined): string[] {
  if (typeof source !== 'string') return []
  return source
    .split(/[;,|]/)
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)
}

interface PersonCardProps {
  person: LinkedPersonSummary
  isStarred?: boolean
  onToggleStar?: (personId: string) => void
  onUnlink?: (personId: string) => void
  /**
   * Render the "Linked {date}" line in the card menu. Defaults to `true`; a host whose
   * `linkedAt` is not durable passes `false` rather than showing a date that is wrong
   * after the first write.
   */
  showLinkedDate?: boolean
}

// Table row (#7493 follow-up): the linked-people list reads like every CRM
// contact table (HubSpot, Pipedrive, Attio): one line per person, name as the
// link, email and phone as links, qualifiers in their own columns, actions in a
// trailing menu. Columns collapse from the right on narrow screens.
export function PersonCard({ person, isStarred, onToggleStar, onUnlink, showLinkedDate = true }: PersonCardProps) {
  const t = useT()
  const sourceTags = React.useMemo(() => splitSourceTags(person.source), [person.source])
  const temperature = React.useMemo(() => {
    const value = typeof person.temperature === 'string' ? person.temperature.trim().toLowerCase() : ''
    return value in temperatureConfig ? temperatureConfig[value as keyof typeof temperatureConfig] : null
  }, [person.temperature])
  const linkedDate = React.useMemo(
    () => (showLinkedDate ? formatDate(person.linkedAt ?? person.createdAt) : null),
    [person.createdAt, person.linkedAt, showLinkedDate],
  )
  const personHref = `/backend/customers/people-v2/${person.id}`
  const statusLabel = typeof person.status === 'string' && person.status.trim() ? formatFallbackLabel(person.status) : null
  const statusActive = typeof person.status === 'string' && person.status.trim().toLowerCase() === 'active'
  const emptyCell = <span className="text-muted-foreground">&mdash;</span>

  return (
    <TableRow className="group">
      <TableCell className="py-2">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar label={person.displayName} size="sm" variant="monochrome" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <Link href={personHref} className="min-w-0 truncate text-sm font-medium text-foreground hover:underline">
                {person.displayName}
              </Link>
              {statusLabel ? (
                <span
                  className={cn('inline-block size-1.5 shrink-0 rounded-full', statusActive ? 'bg-status-success-icon' : 'bg-status-neutral-icon')}
                  title={statusLabel}
                  role="img"
                  aria-label={statusLabel}
                />
              ) : null}
              {onToggleStar && (
                <IconButton
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => onToggleStar(person.id)}
                  className={cn('shrink-0 text-muted-foreground hover:text-status-warning-icon', !isStarred && 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100')}
                  aria-label={isStarred
                    ? t('customers.people.card.unstar', 'Remove star')
                    : t('customers.people.card.star', 'Star')}
                >
                  <Star className={cn('size-3.5', isStarred && 'fill-status-warning-icon text-status-warning-icon')} />
                </IconButton>
              )}
            </div>
            {person.jobTitle ? (
              <div className="truncate text-xs text-muted-foreground">{person.jobTitle}</div>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden py-2 @xl:table-cell">
        {person.primaryEmail ? (
          <a href={`mailto:${person.primaryEmail}`} className="block truncate text-foreground hover:underline">{person.primaryEmail}</a>
        ) : emptyCell}
      </TableCell>
      <TableCell className="hidden py-2 @3xl:table-cell">
        {person.primaryPhone ? (
          <a href={`tel:${person.primaryPhone.replace(/[^+\d]/g, '')}`} className="block whitespace-nowrap text-foreground hover:underline">{person.primaryPhone}</a>
        ) : emptyCell}
      </TableCell>
      <TableCell className="hidden py-2 text-muted-foreground @4xl:table-cell">
        <span className="block truncate">{person.lifecycleStage ? formatFallbackLabel(person.lifecycleStage) : emptyCell}</span>
      </TableCell>
      <TableCell className="hidden py-2 text-muted-foreground @5xl:table-cell">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{sourceTags.length > 0 ? sourceTags.map((sourceTag) => formatFallbackLabel(sourceTag)).join(', ') : emptyCell}</span>
          {temperature ? (
            <span
              className="inline-flex shrink-0 items-center gap-1"
              title={t(temperature.labelKey, temperature.fallback)}
              aria-label={t(temperature.labelKey, temperature.fallback)}
            >
              {Array.from({ length: 5 }).map((_, index) => (
                <span
                  key={index}
                  className={cn('inline-block size-1.5 rounded-full', index < temperature.filled ? temperature.dotClassName : 'bg-border')}
                  aria-hidden
                />
              ))}
            </span>
          ) : null}
        </span>
      </TableCell>
      {showLinkedDate ? (
        <TableCell className="hidden py-2 text-muted-foreground @4xl:table-cell">
          <span className="block whitespace-nowrap">{linkedDate ?? emptyCell}</span>
        </TableCell>
      ) : null}
      <TableCell className="py-2 text-right">
        <Popover>
          <PopoverTrigger asChild>
            <IconButton type="button" variant="ghost" size="xs" aria-label={t('customers.people.card.more', 'More')}>
              <MoreHorizontal className="size-4" />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-44 p-1">
            <PopoverClose asChild>
              <Button asChild type="button" variant="ghost" size="sm" className="w-full justify-start">
                <Link href={personHref}>
                  <ArrowUpRight className="mr-1.5 size-3.5" />
                  {t('customers.people.card.open', 'Open person')}
                </Link>
              </Button>
            </PopoverClose>
            {onUnlink && (
              <PopoverClose asChild>
                <Button
                  type="button"
                  variant="destructive-ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => onUnlink(person.id)}
                >
                  <Unlink className="mr-1.5 size-3.5" />
                  {t('customers.people.card.unlink', 'Unlink')}
                </Button>
              </PopoverClose>
            )}
          </PopoverContent>
        </Popover>
      </TableCell>
    </TableRow>
  )
}
