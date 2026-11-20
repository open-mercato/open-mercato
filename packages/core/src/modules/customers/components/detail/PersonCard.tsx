'use client'

import * as React from 'react'
import Link from 'next/link'
import { Mail, Phone, Star, MoreHorizontal, ArrowUpRight, Unlink } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import { RowActions, type RowActionItem } from '@open-mercato/ui/backend/RowActions'
import type { LinkedPersonSummary } from './LinkedPeopleSection'
import type { Translator } from './types'
import { formatDate, formatFallbackLabel } from './utils'

const sourceColorMap: Record<string, string> = {
  linkedin: 'border-status-info-icon text-status-info-icon',
  email: 'border-status-success-icon text-status-success-icon',
  web_form: 'border-status-info-icon text-status-info-icon',
  'web form': 'border-status-info-icon text-status-info-icon',
  referral: 'border-status-warning-icon text-status-warning-icon',
  customer_referral: 'border-status-warning-icon text-status-warning-icon',
  'customer referral': 'border-status-warning-icon text-status-warning-icon',
  partner_referral: 'border-status-warning-icon text-status-warning-icon',
  'partner referral': 'border-status-warning-icon text-status-warning-icon',
  event: 'border-status-info-icon text-status-info-icon',
  'conference/event': 'border-status-info-icon text-status-info-icon',
  cold_outreach: 'border-status-neutral-icon text-status-neutral-icon',
  'cold outreach': 'border-status-neutral-icon text-status-neutral-icon',
  facebook: 'border-status-info-icon text-status-info-icon',
  typeform: 'border-status-info-icon text-status-info-icon',
  other: 'border-status-neutral-icon text-status-neutral-icon',
}

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
   * Render the "Linked {date}" line. Defaults to `true`; a host whose `linkedAt` is not
   * durable passes `false` rather than showing a date that is wrong after the first write.
   */
  showLinkedDate?: boolean
}

/**
 * Standalone card for one linked person, rendered in any block or grid context.
 *
 * @deprecated `LinkedPeopleSection` renders through `DataTable`; compose the exported `Person*Cell`
 * components and `buildPersonRowActionItems` as `DataTable` columns and row actions instead.
 * This export stays for at least one minor release.
 */
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

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <Avatar label={person.displayName} size="lg" variant="monochrome" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="min-w-0 break-words text-sm font-bold leading-5 text-foreground">{person.displayName}</span>
              {onToggleStar && (
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onToggleStar(person.id)}
                  className="h-auto shrink-0 p-0 text-muted-foreground hover:text-status-warning-icon"
                  aria-label={t('customers.people.card.toggleStar', 'Toggle star')}
                >
                  <Star className={cn('size-3.5', isStarred && 'fill-status-warning-icon text-status-warning-icon')} />
                </IconButton>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {person.jobTitle && (
                <Badge variant="secondary" className="max-w-full truncate px-2 py-0.5 text-xs font-semibold">
                  {person.jobTitle}
                </Badge>
              )}
              {person.status && (
                <Badge variant="outline" className="shrink-0 px-2 py-0.5 text-xs font-medium">
                  <span className="mr-1 inline-block size-1.5 rounded-full bg-status-success-icon" />
                  {person.status}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <IconButton
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0"
              aria-label={t('customers.people.card.more', 'More')}
            >
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-36 p-1">
            {onUnlink && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start text-xs text-destructive hover:text-destructive"
                onClick={() => onUnlink(person.id)}
              >
                <Unlink className="mr-1.5 size-3" />
                {t('customers.people.card.unlink', 'Unlink')}
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div className="mt-3 space-y-2 border-t pt-3 text-xs text-foreground">
        {person.primaryEmail && (
          <div className="flex min-w-0 items-center gap-1.5">
            <Mail className="size-3 shrink-0 text-muted-foreground" />
            <span className="break-all">{person.primaryEmail}</span>
          </div>
        )}
        {person.primaryPhone && (
          <div className="flex min-w-0 items-center gap-1.5">
            <Phone className="size-3 shrink-0 text-muted-foreground" />
            <span className="break-all">{person.primaryPhone}</span>
          </div>
        )}
        {(person.lifecycleStage || linkedDate) && (
          <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span className="truncate">{person.lifecycleStage ?? t('customers.people.card.defaultStage', 'customer')}</span>
            {linkedDate ? (
              <>
                <span aria-hidden>&middot;</span>
                <span className="truncate">{t('customers.people.card.linkedOn', 'Linked {{date}}', { date: linkedDate })}</span>
              </>
            ) : null}
          </div>
        )}
      </div>

      {(temperature || sourceTags.length > 0) && (
        <div className="mt-3 flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            {sourceTags.length > 0 ? (
              <>
                <p className="text-overline font-bold uppercase tracking-wide text-muted-foreground">
                  {t('customers.people.card.source', 'Source')}
                </p>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {sourceTags.map((sourceTag) => {
                    const normalized = sourceTag.toLowerCase().replace(/\s+/g, '_')
                    return (
                      <Badge
                        key={sourceTag}
                        variant="outline"
                        className={cn(
                          'max-w-full truncate px-2 py-0.5 text-xs font-semibold',
                          sourceColorMap[normalized] ?? sourceColorMap[sourceTag.toLowerCase()] ?? 'border-border text-muted-foreground',
                        )}
                      >
                        {formatFallbackLabel(sourceTag)}
                      </Badge>
                    )
                  })}
                </div>
              </>
            ) : null}
          </div>
          {temperature ? (
            <div className="space-y-1 sm:ml-auto sm:text-right">
              <div className="flex items-center gap-1 text-overline font-bold text-muted-foreground sm:justify-end">
                <span>{t(temperature.labelKey, temperature.fallback)}</span>
              </div>
              <div className="flex items-center gap-1 sm:justify-end">
                {Array.from({ length: 5 }).map((_, index) => (
                  <span
                    key={index}
                    className={cn(
                      'inline-block size-2 rounded-full border border-border/70',
                      index < temperature.filled ? temperature.dotClassName : 'bg-muted',
                    )}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:flex-row sm:flex-wrap">
        <Button
          asChild
          type="button"
          variant="outline"
          size="sm"
          className="h-8 w-full text-xs font-semibold sm:min-w-[9rem] sm:flex-1"
        >
          <Link href={`/backend/customers/people-v2/${person.id}`}>
            <ArrowUpRight className="mr-1 size-3" />
            {t('customers.people.card.open', 'Open person')}
          </Link>
        </Button>
        {onUnlink && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full border-destructive/30 text-xs font-semibold text-destructive hover:bg-destructive/10 sm:min-w-[7rem] sm:flex-none"
            onClick={() => onUnlink(person.id)}
          >
            {t('customers.people.card.unlink', 'Unlink')}
          </Button>
        )}
      </div>
    </div>
  )
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
