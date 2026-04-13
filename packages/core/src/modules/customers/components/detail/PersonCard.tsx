'use client'

import * as React from 'react'
import Link from 'next/link'
import { Mail, Phone, Star, MoreHorizontal, ArrowUpRight, Unlink } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@open-mercato/ui/primitives/popover'
import type { CompanyPersonSummary } from './CompanyPeopleSection'
import { formatDate, formatFallbackLabel, getInitials } from './utils'

const sourceColorMap: Record<string, string> = {
  linkedin: 'border-blue-400 text-blue-400',
  email: 'border-emerald-400 text-emerald-400',
  web_form: 'border-purple-400 text-purple-400',
  'web form': 'border-purple-400 text-purple-400',
  referral: 'border-amber-400 text-amber-400',
  customer_referral: 'border-amber-400 text-amber-400',
  'customer referral': 'border-amber-400 text-amber-400',
  partner_referral: 'border-orange-400 text-orange-400',
  'partner referral': 'border-orange-400 text-orange-400',
  event: 'border-pink-400 text-pink-400',
  'conference/event': 'border-pink-400 text-pink-400',
  cold_outreach: 'border-slate-400 text-slate-400',
  'cold outreach': 'border-slate-400 text-slate-400',
  facebook: 'border-blue-500 text-blue-500',
  typeform: 'border-violet-400 text-violet-400',
  other: 'border-slate-400 text-slate-400',
}

const temperatureConfig = {
  hot: { filled: 5, dotClassName: 'bg-red-500', labelKey: 'customers.temperature.hot', fallback: 'Hot Client' },
  warm: { filled: 4, dotClassName: 'bg-orange-500', labelKey: 'customers.temperature.warm', fallback: 'High Interest' },
  high: { filled: 4, dotClassName: 'bg-orange-500', labelKey: 'customers.temperature.high', fallback: 'High Interest' },
  neutral: { filled: 3, dotClassName: 'bg-yellow-500', labelKey: 'customers.temperature.neutral', fallback: 'Engaged' },
  medium: { filled: 3, dotClassName: 'bg-yellow-500', labelKey: 'customers.temperature.medium', fallback: 'Engaged' },
  cool: { filled: 2, dotClassName: 'bg-slate-500', labelKey: 'customers.temperature.cool', fallback: 'Low Activity' },
  low: { filled: 2, dotClassName: 'bg-slate-500', labelKey: 'customers.temperature.low', fallback: 'Low Activity' },
  cold: { filled: 1, dotClassName: 'bg-slate-400', labelKey: 'customers.temperature.cold', fallback: 'At Risk' },
} as const

function splitSourceTags(source: string | null | undefined): string[] {
  if (typeof source !== 'string') return []
  return source
    .split(/[;,|]/)
    .map((entry) => entry.trim())
    .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)
}

interface PersonCardProps {
  person: CompanyPersonSummary
  isStarred?: boolean
  onToggleStar?: (personId: string) => void
  onUnlink?: (personId: string) => void
}

export function PersonCard({ person, isStarred, onToggleStar, onUnlink }: PersonCardProps) {
  const t = useT()
  const sourceTags = React.useMemo(() => splitSourceTags(person.source), [person.source])
  const temperature = React.useMemo(() => {
    const value = typeof person.temperature === 'string' ? person.temperature.trim().toLowerCase() : ''
    return value in temperatureConfig ? temperatureConfig[value as keyof typeof temperatureConfig] : null
  }, [person.temperature])
  const linkedDate = React.useMemo(() => formatDate(person.linkedAt ?? person.createdAt), [person.createdAt, person.linkedAt])

  return (
    <div className="overflow-hidden rounded-[10px] border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-bold text-muted-foreground">
            {getInitials(person.displayName)}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[15px] font-bold text-foreground">{person.displayName}</span>
              {onToggleStar && (
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onToggleStar(person.id)}
                  className="h-auto shrink-0 p-0 text-muted-foreground hover:text-amber-500"
                  aria-label={t('customers.people.card.toggleStar', 'Toggle star')}
                >
                  <Star className={cn('size-3.5', isStarred && 'fill-amber-400 text-amber-400')} />
                </IconButton>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {person.jobTitle && (
                <Badge variant="secondary" className="max-w-full truncate px-2 py-0.5 text-[10px] font-semibold">
                  {person.jobTitle}
                </Badge>
              )}
              {person.status && (
                <Badge variant="outline" className="shrink-0 px-2 py-0.5 text-[10px] font-medium">
                  <span className="mr-1 inline-block size-1.5 rounded-full bg-emerald-500" />
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

      <div className="mt-3 space-y-2 border-t pt-3 text-[11px] text-foreground">
        {person.primaryEmail && (
          <div className="flex min-w-0 items-center gap-1.5">
            <Mail className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{person.primaryEmail}</span>
          </div>
        )}
        {person.primaryPhone && (
          <div className="flex min-w-0 items-center gap-1.5">
            <Phone className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{person.primaryPhone}</span>
          </div>
        )}
        {(person.lifecycleStage || linkedDate) && (
          <div className="flex min-w-0 flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
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
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3 border-t pt-3">
          <div className="min-w-0 flex-1 space-y-1">
            {sourceTags.length > 0 ? (
              <>
                <p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
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
                          'max-w-full truncate px-2 py-0.5 text-[9px] font-semibold',
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
            <div className="space-y-1 sm:text-right">
              <div className="flex items-center gap-1 text-[9px] font-bold text-muted-foreground sm:justify-end">
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

      <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
        <Button
          asChild
          type="button"
          variant="outline"
          size="sm"
          className="h-8 min-w-[9rem] flex-1 text-[11px] font-semibold"
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
            className="h-8 min-w-[7rem] flex-1 border-destructive/30 text-[11px] font-semibold text-destructive hover:bg-destructive/10 sm:flex-none"
            onClick={() => onUnlink(person.id)}
          >
            {t('customers.people.card.unlink', 'Unlink')}
          </Button>
        )}
      </div>
    </div>
  )
}
