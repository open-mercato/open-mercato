"use client"

import * as React from 'react'
import { ChevronDown, Play, Plus, Square } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DurationInput, type DurationInputState } from './DurationInput'

export type QuickLogSubmission = {
  minutes: number
  description: string | null
  date: string
  isBillable: boolean
  /** `HH:MM` local clock, or null when the entry carries a duration only. */
  startClock: string | null
  endClock: string | null
}

export type TaskQuickLogProps = {
  /** Resolves `true` when the entry was written, which is when the fields clear. */
  onLog: (submission: QuickLogSubmission) => Promise<boolean>
  logging: boolean
  /** The one running timer belongs to this task, so the control offers Stop. */
  timerRunningHere: boolean
  /** `01:14:02` while a timer runs here. */
  elapsed: string | null
  timerBusy: boolean
  onStartTimer: () => void
  onStopTimer: () => void
  /** `?panel=time` — "Add time" on a board card lands with the field focused. */
  autoFocus?: boolean
  disabled?: boolean
  /** Today in the viewer's own timezone, so the default date is the day they see. */
  today: string
  /** `false` when the project bills nothing by default. */
  billableByDefault?: boolean
}

/**
 * The quick log of screen 7 (note 1, US-C5), plus the details that note left out.
 *
 * The collapsed form is unchanged and deliberately so: one duration field and
 * **Log**, defaulting to today, the signed-in person and billable. That is the
 * two-second path and the common one, and making it slower to serve the
 * exceptions would be the wrong trade.
 *
 * The exceptions are real, though — yesterday's forgotten hour and any
 * non-billable hour could not be logged here at all, and nothing logged from the
 * drawer could say what the time went on. **Details** reveals description, date
 * and billable in the same block; the person stays fixed, because logging time
 * for somebody else is a different act with different permissions and belongs to
 * the full form.
 */
export function TaskQuickLog({
  onLog,
  logging,
  timerRunningHere,
  elapsed,
  timerBusy,
  onStartTimer,
  onStopTimer,
  autoFocus,
  disabled,
  today,
  billableByDefault = true,
}: TaskQuickLogProps) {
  const t = useT()
  const [minutes, setMinutes] = React.useState<number | null>(null)
  const [status, setStatus] = React.useState<DurationInputState['status']>('empty')
  const [expanded, setExpanded] = React.useState(false)
  const [description, setDescription] = React.useState('')
  const [date, setDate] = React.useState(today)
  const [startClock, setStartClock] = React.useState('')
  const [endClock, setEndClock] = React.useState('')
  const [isBillable, setIsBillable] = React.useState(billableByDefault)

  // The drawer keeps this component mounted across tasks, so a project whose
  // billing default differs has to be picked up rather than assumed once.
  React.useEffect(() => { setIsBillable(billableByDefault) }, [billableByDefault])
  React.useEffect(() => { setDate(today) }, [today])

  const handleChange = React.useCallback((next: number | null, state: DurationInputState) => {
    setMinutes(next)
    setStatus(state.status)
  }, [])

  const submit = React.useCallback(async () => {
    if (minutes === null || minutes <= 0 || logging || disabled) return
    if (!date) return
    const saved = await onLog({
      minutes,
      description: description.trim() || null,
      date,
      isBillable,
      startClock: startClock.trim() || null,
      endClock: endClock.trim() || null,
    })
    if (!saved) return
    // The date and the billable flag survive a save: logging three lines against
    // yesterday should not mean re-picking yesterday three times. The clocks do
    // not — the next block starts somewhere else.
    setMinutes(null)
    setDescription('')
    setStartClock('')
    setEndClock('')
  }, [date, description, disabled, endClock, isBillable, logging, minutes, onLog, startClock])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      void submit()
    },
    [submit],
  )

  const canSubmit =
    !disabled && !logging && status === 'valid' && minutes !== null && minutes > 0 && date.length > 0

  return (
    <div className="flex flex-col gap-2" data-testid="task-drawer-quick-log">
      <div className="flex flex-wrap items-start gap-2">
        <div className="w-28">
          <DurationInput
            value={minutes}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            autoFocus={autoFocus}
            disabled={disabled || logging}
            inputSize="sm"
            placeholder={t('staff.time_tracking.taskDrawer.quickLog.placeholder', '1h 40m')}
            ariaLabel={t('staff.time_tracking.taskDrawer.quickLog.label', 'Time to log')}
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={!canSubmit}
          onClick={() => { void submit() }}
          data-testid="task-drawer-quick-log-submit"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          {t('staff.time_tracking.taskDrawer.quickLog.cta', 'Log')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-expanded={expanded}
          onClick={() => { setExpanded((value) => !value) }}
          data-testid="task-drawer-quick-log-toggle"
        >
          <ChevronDown
            className={`size-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
          {t('staff.time_tracking.taskDrawer.quickLog.details', 'Details')}
        </Button>
        <span className="flex-1" />
        {timerRunningHere ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={timerBusy}
            onClick={onStopTimer}
            data-testid="task-drawer-timer-stop"
          >
            <Square className="size-3.5" aria-hidden="true" />
            {t('staff.time_tracking.taskDrawer.timer.stop', 'Stop {elapsed}', { elapsed: elapsed ?? '' })}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || timerBusy}
            onClick={onStartTimer}
            data-testid="task-drawer-timer-start"
          >
            <Play className="size-3.5" aria-hidden="true" />
            {t('staff.time_tracking.taskDrawer.timer.start', 'Start')}
          </Button>
        )}
      </div>

      {expanded ? (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-2">
          <div className="flex flex-col gap-1">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor="task-drawer-quick-log-description"
            >
              {t('staff.time_tracking.entryDialog.description', 'Description')}
            </label>
            <Input
              id="task-drawer-quick-log-description"
              value={description}
              onChange={(event) => { setDescription(event.target.value) }}
              onKeyDown={handleKeyDown}
              disabled={disabled || logging}
              size="sm"
              maxLength={2000}
              placeholder={t(
                'staff.time_tracking.taskDrawer.quickLog.descriptionPlaceholder',
                'What did the time go on?',
              )}
              data-testid="task-drawer-quick-log-description"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="task-drawer-quick-log-date"
              >
                {t('staff.time_tracking.entryDialog.date', 'Date')}
              </label>
              <Input
                id="task-drawer-quick-log-date"
                type="date"
                value={date}
                onChange={(event) => { setDate(event.target.value) }}
                disabled={disabled || logging}
                size="sm"
                className="w-40"
                data-testid="task-drawer-quick-log-date"
              />
            </div>
            {/*
              * The clocks are optional here, unlike the full form's 2-of-3
              * arithmetic: the duration field above is already authoritative, so
              * these record *when* the block happened without competing to
              * recompute it. Left blank, the entry carries a duration only.
              */}
            <div className="flex flex-col gap-1">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="task-drawer-quick-log-start"
              >
                {t('staff.time_tracking.entryDialog.start', 'Start')}
              </label>
              <Input
                id="task-drawer-quick-log-start"
                type="time"
                value={startClock}
                onChange={(event) => { setStartClock(event.target.value) }}
                disabled={disabled || logging}
                size="sm"
                className="w-28"
                inputClassName="font-mono tabular-nums"
                data-testid="task-drawer-quick-log-start"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                className="text-xs font-medium text-muted-foreground"
                htmlFor="task-drawer-quick-log-end"
              >
                {t('staff.time_tracking.entryDialog.end', 'End')}
              </label>
              <Input
                id="task-drawer-quick-log-end"
                type="time"
                value={endClock}
                onChange={(event) => { setEndClock(event.target.value) }}
                disabled={disabled || logging}
                size="sm"
                className="w-28"
                inputClassName="font-mono tabular-nums"
                data-testid="task-drawer-quick-log-end"
              />
            </div>
            <div className="flex items-center gap-2 pb-1">
              <Switch
                checked={isBillable}
                onCheckedChange={setIsBillable}
                disabled={disabled || logging}
                aria-label={t('staff.time_tracking.entryDialog.billable', 'Billable')}
                data-testid="task-drawer-quick-log-billable"
              />
              <span className="text-xs text-foreground">
                {t('staff.time_tracking.entryDialog.billable', 'Billable')}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default TaskQuickLog
