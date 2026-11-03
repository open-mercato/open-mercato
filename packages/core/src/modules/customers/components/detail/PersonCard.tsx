'use client'

import * as React from 'react'
import Link from 'next/link'
import { Star } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { TableCell, TableRow } from '@open-mercato/ui/primitives/table'
import type { LinkedPersonSummary } from './LinkedPeopleSection'
import type { Translator } from './types'
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

const emptyCell = <span className="text-muted-foreground">&mdash;</span>

function buildPersonHref(personId: string): string {
  return `/backend/customers/people-v2/${personId}`
}

type PersonCellProps = {
  person: LinkedPersonSummary
}

type PersonNameCellProps = PersonCellProps & {
  isStarred?: boolean
  onToggleStar?: (personId: string) => void
}

export function PersonNameCell({ person, isStarred, onToggleStar }: PersonNameCellProps) {
  const t = useT()
  const statusLabel = typeof person.status === 'string' && person.status.trim() ? formatFallbackLabel(person.status) : null
  const statusActive = typeof person.status === 'string' && person.status.trim().toLowerCase() === 'active'

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar label={person.displayName} size="sm" variant="monochrome" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <Link href={buildPersonHref(person.id)} className="min-w-0 truncate text-sm font-medium text-foreground hover:underline">
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
              className={cn('shrink-0 text-muted-foreground hover:text-status-warning-icon', !isStarred && 'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100')}
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
  )
}

export function PersonEmailCell({ person }: PersonCellProps) {
  return person.primaryEmail ? (
    <a href={`mailto:${person.primaryEmail}`} className="block truncate text-foreground hover:underline">{person.primaryEmail}</a>
  ) : emptyCell
}

export function PersonPhoneCell({ person }: PersonCellProps) {
  return person.primaryPhone ? (
    <a href={`tel:${person.primaryPhone.replace(/[^+\d]/g, '')}`} className="block whitespace-nowrap text-foreground hover:underline">{person.primaryPhone}</a>
  ) : emptyCell
}

export function PersonLifecycleStageCell({ person }: PersonCellProps) {
  return (
    <span className="block truncate text-muted-foreground">
      {person.lifecycleStage ? formatFallbackLabel(person.lifecycleStage) : emptyCell}
    </span>
  )
}

export function PersonSourceCell({ person }: PersonCellProps) {
  const t = useT()
  const sourceTags = React.useMemo(() => splitSourceTags(person.source), [person.source])
  const temperature = React.useMemo(() => {
    const value = typeof person.temperature === 'string' ? person.temperature.trim().toLowerCase() : ''
    return value in temperatureConfig ? temperatureConfig[value as keyof typeof temperatureConfig] : null
  }, [person.temperature])

  return (
    <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
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
  )
}

export function PersonLinkedDateCell({ person }: PersonCellProps) {
  return (
    <span className="block whitespace-nowrap text-muted-foreground">
      {formatDate(person.linkedAt ?? person.createdAt) ?? emptyCell}
    </span>
  )
}

export function buildPersonRowActionItems(
  person: LinkedPersonSummary,
  translate: Translator,
  onUnlink?: (personId: string) => void,
): RowActionItem[] {
  const items: RowActionItem[] = [
    {
      id: 'open',
      label: translate('customers.people.card.open', 'Open person'),
      href: buildPersonHref(person.id),
    },
  ]
  if (onUnlink) {
    items.push({
      id: 'unlink',
      label: translate('customers.people.card.unlink', 'Unlink'),
      destructive: true,
      onSelect: () => onUnlink(person.id),
    })
  }
  return items
}

interface PersonCardProps {
  person: LinkedPersonSummary
  isStarred?: boolean
  onToggleStar?: (personId: string) => void
  onUnlink?: (personId: string) => void
  /**
   * Render the "Linked {date}" cell. Defaults to `true`; a host whose `linkedAt` is not
   * durable passes `false` rather than showing a date that is wrong after the first write.
   */
  showLinkedDate?: boolean
}

/**
 * One linked person as a table row. Secondary cells collapse with the `@container` of the host.
 *
 * @deprecated `LinkedPeopleSection` renders through `DataTable`; compose the exported `Person*Cell`
 * components and `buildPersonRowActionItems` as `DataTable` columns and row actions instead.
 */
export function PersonCard({ person, isStarred, onToggleStar, onUnlink, showLinkedDate = true }: PersonCardProps) {
  const t = useT()

  return (
    <TableRow className="group/row">
      <TableCell className="py-2">
        <PersonNameCell person={person} isStarred={isStarred} onToggleStar={onToggleStar} />
      </TableCell>
      <TableCell className="hidden py-2 @xl:table-cell">
        <PersonEmailCell person={person} />
      </TableCell>
      <TableCell className="hidden py-2 @3xl:table-cell">
        <PersonPhoneCell person={person} />
      </TableCell>
      <TableCell className="hidden py-2 @4xl:table-cell">
        <PersonLifecycleStageCell person={person} />
      </TableCell>
      <TableCell className="hidden py-2 @5xl:table-cell">
        <PersonSourceCell person={person} />
      </TableCell>
      {showLinkedDate ? (
        <TableCell className="hidden py-2 @xl:table-cell">
          <PersonLinkedDateCell person={person} />
        </TableCell>
      ) : null}
      <TableCell className="py-2 text-right">
        <RowActions items={buildPersonRowActionItems(person, t, onUnlink)} />
      </TableCell>
    </TableRow>
  )
}
