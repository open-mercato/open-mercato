"use client"

import * as React from 'react'
import { Phone, Mail, Users, StickyNote, Clock, ArrowUpRight, ChevronRight } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { formatRelativeTime } from '@open-mercato/shared/lib/time'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { InteractionSummary } from '../../formConfig'

function interactionIcon(type: string) {
  switch (type) {
    case 'call': return <Phone className="size-4" />
    case 'email': return <Mail className="size-4" />
    case 'meeting': return <Users className="size-4" />
    case 'note': return <StickyNote className="size-4" />
    default: return <Clock className="size-4" />
  }
}

export function RecentActivityWidget({ interactions, t }: { interactions: InteractionSummary[]; t: TranslateFn }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Clock className="size-4" />
          {t('customers.companies.dashboard.recentActivity', 'Recent activity')}
          <span className="text-xs font-normal text-muted-foreground">
            {t('customers.companies.dashboard.last7days', 'last 7 days')}
          </span>
        </h3>
      </div>
      <div className="mt-3 divide-y">
        {interactions.map((interaction) => {
          const date = interaction.occurredAt ?? interaction.scheduledAt
          return (
            <div key={interaction.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                {interactionIcon(interaction.interactionType)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">{interaction.title || interaction.interactionType}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {interaction.authorName && <span>{interaction.authorName}</span>}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-muted-foreground">
                  {date ? formatRelativeTime(date) : '—'}
                </p>
                <ArrowUpRight className="ml-auto mt-1 size-3.5 text-muted-foreground" />
              </div>
            </div>
          )
        })}
        {interactions.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">{t('customers.companies.dashboard.noActivity', 'No recent activity')}</p>
        )}
      </div>
      {interactions.length > 0 && (
        <div className="mt-3 border-t pt-3">
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs">
            {t('customers.companies.dashboard.seeAllActivity', 'See all {{count}} activities', { count: String(interactions.length) })}
            <ChevronRight className="ml-0.5 size-3" />
          </Button>
        </div>
      )}
    </div>
  )
}
