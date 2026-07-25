"use client"

import * as React from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import type { CalendarHeaderProps } from './types'

export function CalendarHeader({ view, anchor, onNewEvent }: CalendarHeaderProps) {
  const t = useT()
  const locale = useLocale()

  const title = React.useMemo(() => {
    if (view === 'agenda') return t('customers.calendar.header.titleAgenda', 'Upcoming')
    if (view === 'month') {
      return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(anchor)
    }
    return new Intl.DateTimeFormat(locale, { month: 'short', day: '2-digit', year: 'numeric' }).format(anchor)
  }, [view, anchor, locale, t])

  return (
    <header className="flex items-center gap-3 border-b py-4">
      <h1 className="min-w-0 truncate text-xl font-semibold text-foreground">{title}</h1>
      {onNewEvent ? (
        <div className="ml-auto flex shrink-0 items-center">
          <Button
            type="button"
            onClick={onNewEvent}
            aria-label={t('customers.calendar.actions.newEvent', 'New event')}
          >
            <Plus aria-hidden="true" />
            <span className="hidden sm:inline">
              {t('customers.calendar.actions.newEvent', 'New event')}
            </span>
          </Button>
        </div>
      ) : null}
    </header>
  )
}
