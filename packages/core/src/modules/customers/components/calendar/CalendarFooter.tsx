"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Kbd } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CalendarFooterProps } from './types'

export const CALENDAR_SHORTCUTS: ReadonlyArray<{
  key: string
  labelKey: string
  fallback: string
}> = [
  { key: 'T', labelKey: 'customers.calendar.shortcuts.today', fallback: 'Today' },
  { key: 'D', labelKey: 'customers.calendar.shortcuts.dayView', fallback: 'Day view' },
  { key: 'W', labelKey: 'customers.calendar.shortcuts.week', fallback: 'Week' },
  { key: 'M', labelKey: 'customers.calendar.shortcuts.month', fallback: 'Month' },
  { key: 'A', labelKey: 'customers.calendar.shortcuts.agenda', fallback: 'Agenda' },
  { key: 'N', labelKey: 'customers.calendar.shortcuts.newEvent', fallback: 'New event' },
  { key: '/', labelKey: 'customers.calendar.shortcuts.search', fallback: 'Search' },
  { key: '?', labelKey: 'customers.calendar.shortcuts.help', fallback: 'Shortcuts' },
]

export function CalendarFooter({ timezoneLabel, onOpenShortcuts }: CalendarFooterProps) {
  const t = useT()
  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t bg-muted/40 px-4 py-2">
      {CALENDAR_SHORTCUTS.map((shortcut) => {
        const legend = (
          <>
            <Kbd>{shortcut.key}</Kbd>
            <span className="text-xs text-muted-foreground">
              {t(shortcut.labelKey, shortcut.fallback)}
            </span>
          </>
        )
        if (shortcut.key === '?' && onOpenShortcuts) {
          return (
            <Button
              key={shortcut.key}
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto gap-1.5 p-0 font-normal hover:bg-transparent"
              aria-label={t('customers.calendar.shortcuts.title', 'Keyboard shortcuts')}
              onClick={onOpenShortcuts}
            >
              {legend}
            </Button>
          )
        }
        return (
          <span key={shortcut.key} className="inline-flex items-center gap-1.5">
            {legend}
          </span>
        )
      })}
      <span className="ml-auto text-xs text-muted-foreground">{timezoneLabel}</span>
    </footer>
  )
}
