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
import { getInitials } from './utils'

const sourceColorMap: Record<string, string> = {
  linkedin: 'border-blue-400 text-blue-400',
  email: 'border-emerald-400 text-emerald-400',
  'web form': 'border-purple-400 text-purple-400',
  referral: 'border-amber-400 text-amber-400',
  'customer referral': 'border-amber-400 text-amber-400',
  'partner referral': 'border-orange-400 text-orange-400',
  'conference/event': 'border-pink-400 text-pink-400',
  'cold outreach': 'border-slate-400 text-slate-400',
  facebook: 'border-blue-500 text-blue-500',
  typeform: 'border-violet-400 text-violet-400',
}

const temperatureColorMap: Record<string, string> = {
  hot: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
  cold: 'bg-slate-400',
}

interface PersonCardProps {
  person: CompanyPersonSummary
  isStarred?: boolean
  onToggleStar?: (personId: string) => void
  onUnlink?: (personId: string) => void
}

export function PersonCard({ person, isStarred, onToggleStar, onUnlink }: PersonCardProps) {
  const t = useT()

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* Header: avatar + name + star + menu */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
            {getInitials(person.displayName)}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold">{person.displayName}</span>
              {onToggleStar && (
                <IconButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onToggleStar(person.id)}
                  className="h-auto text-muted-foreground hover:text-amber-500 p-0"
                  aria-label={t('customers.people.card.toggleStar', 'Toggle star')}
                >
                  <Star className={cn('size-3.5', isStarred && 'fill-amber-400 text-amber-400')} />
                </IconButton>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {person.jobTitle && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {person.jobTitle}
                </Badge>
              )}
              {person.status && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                  <span className="mr-1 inline-block size-1.5 rounded-full bg-emerald-500" />
                  {person.status}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <IconButton type="button" variant="ghost" size="xs" aria-label={t('customers.people.card.more', 'More')}>
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

      {/* Contact info */}
      <div className="space-y-1 text-xs text-muted-foreground">
        {person.primaryEmail && (
          <div className="flex items-center gap-1.5 truncate">
            <Mail className="size-3 shrink-0" />
            <span className="truncate">{person.primaryEmail}</span>
          </div>
        )}
        {person.primaryPhone && (
          <div className="flex items-center gap-1.5">
            <Phone className="size-3 shrink-0" />
            {person.primaryPhone}
          </div>
        )}
        {person.createdAt && (
          <div className="text-[10px]">
            {person.lifecycleStage ?? t('customers.people.card.defaultStage', 'customer')} · {t('customers.people.card.linkedOn', 'Linked {{date}}', { date: new Date(person.createdAt).toLocaleDateString() })}
          </div>
        )}
      </div>

      {/* Temperature + source badges */}
      {(person.temperature || person.source) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {person.temperature && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className={cn('inline-block size-2 rounded-full', temperatureColorMap[person.temperature.toLowerCase()] ?? 'bg-slate-400')} />
              {person.temperature}
            </span>
          )}
          {person.source && (
            <Badge
              variant="outline"
              className={cn('text-[10px] px-1.5 py-0', sourceColorMap[person.source.toLowerCase()])}
            >
              {person.source}
            </Badge>
          )}
        </div>
      )}

      {/* Actions footer */}
      <div className="flex items-center gap-2 pt-1 border-t">
        <Button asChild type="button" variant="ghost" size="sm" className="flex-1 h-7 text-xs">
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
            className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => onUnlink(person.id)}
          >
            {t('customers.people.card.unlink', 'Unlink')}
          </Button>
        )}
      </div>
    </div>
  )
}
