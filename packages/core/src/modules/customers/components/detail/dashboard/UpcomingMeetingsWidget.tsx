"use client"

import * as React from 'react'
import { Calendar, ChevronRight } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { InteractionSummary } from '../../formConfig'

export function UpcomingMeetingsWidget({ meetings, t }: { meetings: InteractionSummary[]; t: TranslateFn }) {
  if (meetings.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Calendar className="size-4" />
          {t('customers.companies.dashboard.upcomingMeetings', 'Upcoming meetings')}
        </h3>
        <p className="mt-3 text-sm text-muted-foreground">{t('customers.companies.dashboard.noMeetings', 'No upcoming meetings')}</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Calendar className="size-4" />
          {t('customers.companies.dashboard.upcomingMeetings', 'Upcoming meetings')}
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            {meetings.length}
          </span>
        </h3>
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs">
          {t('customers.companies.dashboard.seeAll', 'See all')}
          <ChevronRight className="ml-0.5 size-3" />
        </Button>
      </div>
      <div className="mt-3 divide-y">
        {meetings.map((meeting) => {
          const date = meeting.scheduledAt ? new Date(meeting.scheduledAt) : null
          return (
            <div key={meeting.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {date ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '—'}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-sm font-medium text-foreground">{meeting.title || meeting.interactionType}</p>
                {meeting.authorName && (
                  <p className="text-xs text-muted-foreground">{meeting.authorName}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
                  {t('customers.companies.dashboard.details', 'Details')}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
