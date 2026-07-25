"use client"

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Kbd } from '@open-mercato/ui/primitives/kbd'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CALENDAR_SHORTCUTS } from './CalendarFooter'

export type ShortcutsDialogProps = {
  open: boolean
  onOpenChange(open: boolean): void
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onOpenChange(false)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('customers.calendar.shortcuts.title', 'Keyboard shortcuts')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'customers.calendar.shortcuts.description',
              'Navigate the calendar faster with these keys.',
            )}
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {CALENDAR_SHORTCUTS.map((shortcut) => (
            <li key={shortcut.key} className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                {t(shortcut.labelKey, shortcut.fallback)}
              </span>
              <Kbd>{shortcut.key}</Kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
