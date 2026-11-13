"use client"

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDuration, parseDuration, type DurationFormatStyle } from '../time-tracking/duration'

export type DurationInputStatus = 'valid' | 'empty' | 'invalid'

export type DurationInputState = {
  minutes: number | null
  raw: string
  status: DurationInputStatus
}

export type DurationInputProps = {
  /** Parsed value in minutes. `null` means the field is empty. */
  value: number | null
  /**
   * Fired on every keystroke with the parsed minutes (`null` while the text is
   * empty or unparseable) and the validity signal, so a parent can disable Save
   * without parsing the text again.
   */
  onChange: (minutes: number | null, state: DurationInputState) => void
  /** Fired whenever the validity signal changes (mount included). */
  onStatusChange?: (state: DurationInputState) => void
  /**
   * `compact` drops the format hint and moves the error into the input's
   * `title` (plus a screen-reader-only message) — for the timesheet grid cells,
   * where no hint fits.
   */
  variant?: 'default' | 'compact'
  /** Canonical display style used once the text parses. Defaults to `hm`. */
  displayStyle?: DurationFormatStyle
  /** Overrides `displayStyle` entirely — lets a surface keep its own look. */
  formatValue?: (minutes: number) => string
  /** Replaces the default "Understands 1h 40m, …" hint. */
  hint?: string
  /** External error (server/form level) shown when the text itself parses. */
  error?: string
  id?: string
  name?: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
  autoFocus?: boolean
  inputSize?: 'sm' | 'default' | 'lg'
  className?: string
  inputClassName?: string
  ariaLabel?: string
  onBlur?: (event: React.FocusEvent<HTMLInputElement>) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
}

/**
 * The timesheet grid renders `120` minutes as `2`, not as `2.00` — trailing
 * zeros stripped and an empty cell for zero. `formatDuration(…, 'decimal')` is
 * fixed 2dp, so the grid keeps its look by passing this formatter.
 */
export function formatTrimmedDecimalDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return ''
  const hours = minutes / 60
  if (hours % 1 === 0) return String(hours)
  return hours.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function readStatus(raw: string): DurationInputState {
  const parsed = parseDuration(raw)
  if (parsed.ok) return { minutes: parsed.minutes, raw, status: 'valid' }
  if (parsed.reason === 'empty') return { minutes: null, raw, status: 'empty' }
  return { minutes: null, raw, status: 'invalid' }
}

export function DurationInput({
  value,
  onChange,
  onStatusChange,
  variant = 'default',
  displayStyle = 'hm',
  formatValue,
  hint,
  error,
  id,
  name,
  placeholder,
  disabled,
  required,
  autoFocus,
  inputSize,
  className,
  inputClassName,
  ariaLabel,
  onBlur,
  onKeyDown,
}: DurationInputProps) {
  const t = useT()
  const generatedId = React.useId()
  const inputId = id ?? `duration-${generatedId}`
  const messageId = `${inputId}-message`

  /**
   * `draft` holds exactly what the user typed and is the authority while it is
   * a string; `null` hands the display back to the parsed `value`. Unparseable
   * text therefore survives every re-render — it is never rewritten or dropped.
   */
  const [draft, setDraft] = React.useState<string | null>(null)

  const format = React.useCallback(
    (minutes: number) => (formatValue ? formatValue(minutes) : formatDuration(minutes, displayStyle)),
    [displayStyle, formatValue],
  )

  const display = draft ?? (value === null || value === undefined ? '' : format(value))
  const state = React.useMemo(() => readStatus(display), [display])
  const invalid = state.status === 'invalid'

  const statusRef = React.useRef<DurationInputStatus | null>(null)
  React.useEffect(() => {
    if (statusRef.current === state.status) return
    statusRef.current = state.status
    onStatusChange?.(state)
  }, [onStatusChange, state])

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value
      setDraft(raw)
      const next = readStatus(raw)
      onChange(next.minutes, next)
    },
    [onChange],
  )

  const handleBlur = React.useCallback(
    (event: React.FocusEvent<HTMLInputElement>) => {
      const next = readStatus(event.target.value)
      // Only text that parsed may be rewritten; unparseable text stays put.
      if (next.status !== 'invalid') setDraft(null)
      onBlur?.(event)
    },
    [onBlur],
  )

  const hintText = hint ?? t(
    'staff.time_tracking.duration.hint',
    'Understands 1h 40m, 1.5h, 90m, 1:40.',
  )
  const parseErrorText = t(
    'staff.time_tracking.duration.invalid',
    "I don't understand that format. Try 1h 40m, 1.5h, 90m or 1:40.",
  )
  const message = invalid ? parseErrorText : error ?? null
  const compact = variant === 'compact'
  const showHint = !compact && !message
  const describedBy = message || showHint ? messageId : undefined

  return (
    <div className={cn('flex w-full flex-col gap-1', className)}>
      <Input
        id={inputId}
        name={name}
        size={inputSize ?? (compact ? 'sm' : 'default')}
        type="text"
        inputMode="text"
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        required={required}
        value={display}
        placeholder={placeholder ?? t('staff.time_tracking.duration.placeholder', '1h 30m')}
        aria-label={ariaLabel}
        aria-invalid={Boolean(message)}
        aria-describedby={describedBy}
        title={compact && message ? message : undefined}
        inputClassName={cn('font-mono tabular-nums', inputClassName)}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={onKeyDown}
      />
      {message ? (
        <p id={messageId} className={cn('text-xs text-status-error-text', compact && 'sr-only')} role="alert">
          {message}
        </p>
      ) : showHint ? (
        <p id={messageId} className="text-xs text-muted-foreground">
          {hintText}
        </p>
      ) : null}
    </div>
  )
}
