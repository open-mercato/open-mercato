"use client"

import * as React from 'react'
import { Play, Plus, Square } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DurationInput, type DurationInputState } from './DurationInput'

export type TaskQuickLogProps = {
  /** Resolves `true` when the entry was written, which is when the field clears. */
  onLog: (minutes: number) => Promise<boolean>
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
}

/**
 * The one-field quick log of screen 7 (note 1, US-C5).
 *
 * The field is the shared `DurationInput`, so it understands exactly the formats
 * the full entry form does and keeps unparseable text in place instead of
 * swallowing it. There is no date, no person and no billable switch: the entry is
 * written for today, for the signed-in person, billable — the defaults the note
 * names — and anything else is a job for the full form.
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
}: TaskQuickLogProps) {
  const t = useT()
  const [minutes, setMinutes] = React.useState<number | null>(null)
  const [status, setStatus] = React.useState<DurationInputState['status']>('empty')

  const handleChange = React.useCallback((next: number | null, state: DurationInputState) => {
    setMinutes(next)
    setStatus(state.status)
  }, [])

  const submit = React.useCallback(async () => {
    if (minutes === null || minutes <= 0 || logging || disabled) return
    const saved = await onLog(minutes)
    if (saved) setMinutes(null)
  }, [disabled, logging, minutes, onLog])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      void submit()
    },
    [submit],
  )

  return (
    <div className="flex flex-wrap items-start gap-2" data-testid="task-drawer-quick-log">
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
        disabled={disabled || logging || status !== 'valid' || minutes === null || minutes <= 0}
        onClick={() => { void submit() }}
        data-testid="task-drawer-quick-log-submit"
      >
        <Plus className="size-3.5" aria-hidden="true" />
        {t('staff.time_tracking.taskDrawer.quickLog.cta', 'Log')}
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
  )
}

export default TaskQuickLog
