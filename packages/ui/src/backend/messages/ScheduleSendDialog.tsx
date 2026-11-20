"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { resolveBrowserTimezone, wallTimeToInstant } from '@open-mercato/shared/lib/time/wall-time'
import { Button } from '../../primitives/button'
import { DatePicker } from '../../primitives/date-picker'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../primitives/dialog'
import { useDialogKeyHandler } from '../../hooks/useDialogKeyHandler'

export type ScheduleSendDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  maxDays: number
  initialValue?: Date | null
  submitting?: boolean
  onConfirm: (scheduledAt: string) => void | Promise<void>
}

const pad = (value: number) => String(value).padStart(2, '0')

function nextFullHour(): Date {
  const date = new Date()
  date.setHours(date.getHours() + 1, 0, 0, 0)
  return date
}

/** Converts the picked local wall time to a UTC instant in the browser time zone; `null` for a DST-gap time. */
export function scheduledInstantFromPicker(value: Date, timezone: string): Date | null {
  const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  const time = `${pad(value.getHours())}:${pad(value.getMinutes())}`
  return wallTimeToInstant(date, time, timezone)
}

export function ScheduleSendDialog({ open, onOpenChange, maxDays, initialValue, submitting, onConfirm }: ScheduleSendDialogProps) {
  const t = useT()
  const timezone = React.useMemo(() => resolveBrowserTimezone(), [])
  const [value, setValue] = React.useState<Date | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setValue(initialValue && initialValue.getTime() > Date.now() ? initialValue : nextFullHour())
    setError(null)
  }, [initialValue, open])

  const now = Date.now()
  const minDate = new Date(now + 60_000)
  const maxDate = new Date(now + maxDays * 86_400_000)

  const confirm = React.useCallback(() => {
    if (!value || submitting) return
    const instant = scheduledInstantFromPicker(value, timezone)
    if (!instant) {
      setError(t('messages.errors.scheduleTimeDoesNotExist', 'This time does not exist in your time zone because of a daylight saving change. Pick another time.'))
      return
    }
    const current = Date.now()
    if (instant.getTime() <= current) {
      setError(t('messages.errors.scheduleInPast', 'Pick a send time in the future.'))
      return
    }
    if (instant.getTime() > current + maxDays * 86_400_000) {
      setError(t('messages.errors.scheduleTooFar', 'The send time is too far ahead.'))
      return
    }
    setError(null)
    void onConfirm(instant.toISOString())
  }, [maxDays, onConfirm, submitting, t, timezone, value])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: confirm,
    onCancel: () => onOpenChange(false),
    disabled: submitting,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('messages.compose.sendLater', 'Send later…')}</DialogTitle>
          <DialogDescription>
            {t('messages.compose.scheduleDescription', 'The message is sent automatically at the chosen time. You can edit or cancel it until then.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="messages-schedule-at">
            {t('messages.compose.scheduleAt', 'Send at')}
          </label>
          <DatePicker
            id="messages-schedule-at"
            value={value}
            onChange={(next) => {
              setValue(next)
              setError(null)
            }}
            withTime
            minuteStep={1}
            minDate={minDate}
            maxDate={maxDate}
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground">
            {t('messages.compose.scheduleHint', 'Time zone: {timezone}', { timezone })}
          </p>
          {error ? <p className="text-sm text-status-error-text" role="alert">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('ui.forms.actions.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={confirm} disabled={submitting || !value}>
            {t('messages.compose.schedule', 'Schedule')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
