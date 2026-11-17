"use client"

import * as React from 'react'
import { CalendarClock } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatTimelineDate } from './TimelineDealCard'
import {
  endOfMonth,
  endOfQuarter,
  isValidDateKey,
  shiftCloseDate,
  toUtcDateKey,
} from '../../../../../lib/dealsTimeline'

export type ChangeCloseDateDialogProps = {
  open: boolean
  currentDate: string | null
  onCancel: () => void
  onSubmit: (dateKey: string) => Promise<void>
}

type QuickChip = {
  id: string
  label: string
  value: string
}

export function formatUtcDateKey(key: string | null, locale?: string): string | null {
  if (!key) return null
  return formatTimelineDate(key, locale) ?? key
}

export function dateKeyToLocalDate(key: string | null): Date | null {
  if (!key || !isValidDateKey(key)) return null
  const [year, month, day] = key.split('-').map((part) => Number(part))
  return new Date(year, month - 1, day)
}

export function localDateToDateKey(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function buildQuickDateChips(
  currentDate: string | null,
  today: Date = new Date(),
): Array<{ id: 'plusWeek' | 'plusTwoWeeks' | 'endOfMonth' | 'endOfQuarter'; value: string }> {
  const base = toUtcDateKey(currentDate) ?? toUtcDateKey(today)
  if (!base) return []
  return [
    { id: 'plusWeek', value: shiftCloseDate(base, 'week', 1) },
    { id: 'plusTwoWeeks', value: shiftCloseDate(base, 'week', 2) },
    { id: 'endOfMonth', value: endOfMonth(base) },
    { id: 'endOfQuarter', value: endOfQuarter(base) },
  ]
}

export function ChangeCloseDateDialog({
  open,
  currentDate,
  onCancel,
  onSubmit,
}: ChangeCloseDateDialogProps): React.ReactElement {
  const t = useT()
  const locale = useLocale()
  const currentKey = toUtcDateKey(currentDate)
  const [draft, setDraft] = React.useState<string>(currentKey ?? '')
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setDraft(currentKey ?? '')
      setIsSubmitting(false)
    }
  }, [currentKey, open])

  const chips = React.useMemo<QuickChip[]>(() => {
    const labels: Record<string, string> = {
      plusWeek: t('customers.deals.timeline.reschedule.dialog.quick.plusWeek', '+1 week'),
      plusTwoWeeks: t('customers.deals.timeline.reschedule.dialog.quick.plusTwoWeeks', '+2 weeks'),
      endOfMonth: t('customers.deals.timeline.reschedule.dialog.quick.endOfMonth', 'End of month'),
      endOfQuarter: t('customers.deals.timeline.reschedule.dialog.quick.endOfQuarter', 'End of quarter'),
    }
    return buildQuickDateChips(currentKey).map((chip) => ({ ...chip, label: labels[chip.id] }))
  }, [currentKey, t])

  const isDraftValid = isValidDateKey(draft)
  const isUnchanged = draft === currentKey
  const submitDisabled = isSubmitting || !isDraftValid || isUnchanged

  const handleSubmit = React.useCallback(async () => {
    if (submitDisabled) return
    setIsSubmitting(true)
    try {
      await onSubmit(draft)
    } finally {
      setIsSubmitting(false)
    }
  }, [draft, onSubmit, submitDisabled])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: () => void handleSubmit(),
    onCancel: () => {
      if (!isSubmitting) onCancel()
    },
    disabled: submitDisabled,
  })

  const currentLabel = formatUtcDateKey(currentKey, locale)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isSubmitting) onCancel()
      }}
    >
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4" aria-hidden="true" />
            {t('customers.deals.timeline.reschedule.dialog.title', 'Change close date')}
          </DialogTitle>
          <DialogDescription>
            {currentLabel
              ? t('customers.deals.timeline.reschedule.dialog.current', 'Current close date: {date}', { date: currentLabel })
              : t('customers.deals.timeline.reschedule.dialog.noCurrent', 'This deal has no close date yet.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">
              {t('customers.deals.timeline.reschedule.dialog.inputLabel', 'New close date')}
            </span>
            <DatePicker
              id="timeline-close-date-input"
              value={dateKeyToLocalDate(draft)}
              onChange={(date) => setDraft(localDateToDateKey(date))}
              footer="none"
              aria-label={t('customers.deals.timeline.reschedule.dialog.inputLabel', 'New close date')}
              placeholder={t('customers.deals.timeline.reschedule.dialog.placeholder', 'Pick a date')}
              disabled={isSubmitting}
            />
          </div>
          {chips.length ? (
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label={t('customers.deals.timeline.reschedule.dialog.quick.label', 'Quick picks')}
            >
              {chips.map((chip) => (
                <Button
                  key={chip.id}
                  type="button"
                  size="sm"
                  variant={draft === chip.value ? 'secondary' : 'outline'}
                  aria-pressed={draft === chip.value}
                  onClick={() => setDraft(chip.value)}
                  title={formatUtcDateKey(chip.value, locale) ?? chip.value}
                >
                  {chip.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {t('customers.deals.timeline.reschedule.dialog.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitDisabled}>
            {t('customers.deals.timeline.reschedule.dialog.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ChangeCloseDateDialog
