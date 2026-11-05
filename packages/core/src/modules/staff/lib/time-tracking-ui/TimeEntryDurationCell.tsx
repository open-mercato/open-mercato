"use client"

import * as React from 'react'
import { Lock } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { DurationInput, type DurationInputStatus } from './DurationInput'
import { formatDuration } from '../time-tracking/duration'

/**
 * Screen 10 note 1: the `Czas` cell edits in place — `Enter` or losing focus
 * saves, `esc` puts the previous value back (US-D5).
 *
 * Three decisions:
 *
 *  1. **The field is `DurationInput`'s compact variant, not a bespoke input.**
 *     `1h 40m`, `1.5h`, `90m` and `1:40` must mean the same thing in this cell
 *     as they do in the entry dialog and the timesheet grid, and unparseable
 *     text must behave the same way too. A second parser would drift.
 *  2. **`esc` remounts the field rather than assigning to it.** `DurationInput`
 *     owns the typed text so that garbage is never rewritten mid-keystroke; the
 *     only honest way to discard that text from the outside is to give it a new
 *     `key`. The same remount runs after a save so the cell settles on the
 *     canonical `2:30` rather than on whatever spelling was typed.
 *  3. **Text that does not parse is reverted on blur, never saved.** The parent
 *     is only ever handed minutes it can send, so a half-typed duration cannot
 *     leave the row in a state the server has to reject.
 */
export type TimeEntryDurationCellProps = {
  value: number
  /** Locked rows (US-G3) render the duration as text with a lock affordance. */
  readOnly?: boolean
  saving?: boolean
  ariaLabel: string
  lockedTitle?: string
  onCommit: (minutes: number) => void | Promise<void>
}

export function TimeEntryDurationCell({
  value,
  readOnly = false,
  saving = false,
  ariaLabel,
  lockedTitle,
  onCommit,
}: TimeEntryDurationCellProps) {
  const [draft, setDraft] = React.useState<number | null | undefined>(undefined)
  const [status, setStatus] = React.useState<DurationInputStatus>('valid')
  const [fieldKey, setFieldKey] = React.useState(0)
  const revertingRef = React.useRef(false)

  const reset = React.useCallback(() => {
    setDraft(undefined)
    setStatus('valid')
    setFieldKey((key) => key + 1)
  }, [])

  const commit = React.useCallback(async () => {
    const next = draft
    if (next === undefined) return
    if (status !== 'valid' || next === null || next === value) {
      reset()
      return
    }
    reset()
    await onCommit(next)
  }, [draft, onCommit, reset, status, value])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        void commit()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        revertingRef.current = true
        reset()
      }
    },
    [commit, reset],
  )

  const handleBlur = React.useCallback(() => {
    if (revertingRef.current) {
      revertingRef.current = false
      return
    }
    void commit()
  }, [commit])

  if (readOnly) {
    return (
      <span
        className="flex items-center justify-end gap-1.5 font-mono text-sm font-semibold tabular-nums text-muted-foreground"
        title={lockedTitle}
        data-testid="entry-duration-locked"
      >
        <Lock className="h-3 w-3" aria-hidden="true" />
        {formatDuration(value, 'clock')}
      </span>
    )
  }

  return (
    <div className={cn('flex justify-end', saving && 'opacity-60')} onClick={(event) => event.stopPropagation()}>
      <DurationInput
        key={fieldKey}
        variant="compact"
        displayStyle="clock"
        className="w-20"
        inputClassName="text-right"
        ariaLabel={ariaLabel}
        disabled={saving}
        value={draft === undefined ? value : draft}
        onChange={(minutes, state) => {
          setDraft(minutes)
          setStatus(state.status)
        }}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </div>
  )
}
